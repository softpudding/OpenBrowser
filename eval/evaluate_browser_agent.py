#!/usr/bin/env python3
"""
OpenBrowser Agent Evaluation System

Evaluates AI agents on browser automation tasks using the OpenBrowser server.
Records SSE events (including images) and browser tracking events for analysis.
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import time
import yaml
import requests
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import subprocess
import signal
import atexit
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
OPENBROWSER_API_URL = "http://localhost:8765"
OPENBROWSER_WS_URL = "ws://localhost:8766"
EVAL_SERVER_URL = "http://localhost:16605"
EVAL_SERVER_PORT = 16605
OPENBROWSER_PORT = 8765

# Paths
EVAL_DIR = Path(__file__).parent
DATASET_DIR = EVAL_DIR / "dataset"
OUTPUT_DIR = EVAL_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"

# Ensure directories exist
OUTPUT_DIR.mkdir(exist_ok=True)
IMAGES_DIR.mkdir(exist_ok=True)
DATASET_DIR.mkdir(exist_ok=True)


@dataclass
class TestCase:
    """A test case definition"""
    id: str
    name: str
    description: str
    instruction: str
    start_url: str
    criteria: List[Dict[str, Any]]
    difficulty: str = "medium"


@dataclass
class TestResult:
    """Test execution result"""
    test_case: TestCase
    passed: bool
    score: float
    max_score: float
    events: List[Dict[str, Any]]
    sse_events: List[Dict[str, Any]]
    track_events: List[Dict[str, Any]]
    images: List[str]  # image file paths
    error: Optional[str] = None
    conversation_id: Optional[str] = None


class OpenBrowserClient:
    """Client for OpenBrowser server API"""
    
    def __init__(self, base_url: str = OPENBROWSER_API_URL):
        self.base_url = base_url
        self.session = requests.Session()
    
    def health_check(self) -> bool:
        """Check if OpenBrowser server is running"""
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=2)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False
    
    def create_conversation(self) -> Optional[str]:
        """Create a new conversation and return its ID"""
        try:
            response = self.session.post(
                f"{self.base_url}/agent/conversations",
                json={},
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("conversation_id")
        except Exception as e:
            logger.error(f"Failed to create conversation: {e}")
        return None
    
    def send_message(self, conversation_id: str, message: str, cwd: str = ".") -> List[Dict[str, Any]]:
        """Send a message to the agent and collect SSE events"""
        events = []
        try:
            response = self.session.post(
                f"{self.base_url}/agent/conversations/{conversation_id}/messages",
                json={"text": message, "cwd": cwd},
                stream=True,
                headers={"Accept": "text/event-stream"},
                timeout=60  # Initial timeout for connection
            )
            response.raise_for_status()
            
            # Parse SSE events manually
            buffer = ""
            completed = False
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=True):
                if not chunk:
                    continue
                buffer += chunk
                # Split on double newlines
                while "\n\n" in buffer:
                    event_str, buffer = buffer.split("\n\n", 1)
                    event_lines = event_str.strip().split('\n')
                    event_type = None
                    data = {}
                    for line in event_lines:
                        line = line.strip()
                        if line.startswith('event:'):
                            event_type = line[6:].strip()
                        elif line.startswith('data:'):
                            data_str = line[5:].strip()
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                data = data_str
                    if event_type:
                        events.append({
                            "type": event_type,
                            "data": data,
                            "timestamp": time.time()
                        })
                        logger.debug(f"SSE event: {event_type}")
                        if event_type == "complete":
                            completed = True
                if completed:
                    break
            
            # Process any remaining buffer (incomplete event)
            if buffer.strip():
                logger.debug(f"Incomplete SSE event remaining: {buffer[:100]}")
            
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
        
        return events
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation"""
        try:
            response = self.session.delete(
                f"{self.base_url}/agent/conversations/{conversation_id}",
                timeout=5
            )
            return response.status_code == 200
        except Exception:
            return False


class EvalServerClient:
    """Client for evaluation server tracking API"""
    
    def __init__(self, base_url: str = EVAL_SERVER_URL):
        self.base_url = base_url
    
    def health_check(self) -> bool:
        """Check if eval server is running"""
        try:
            response = requests.get(f"{self.base_url}/api/events", timeout=2)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False
    
    def clear_events(self) -> bool:
        """Clear all tracked events"""
        try:
            response = requests.get(f"{self.base_url}/api/events/clear", timeout=2)
            return response.status_code == 200
        except Exception:
            return False
    
    def get_events(self) -> List[Dict[str, Any]]:
        """Get all tracked events"""
        try:
            response = requests.get(f"{self.base_url}/api/events", timeout=5)
            if response.status_code == 200:
                data = response.json()
                return data.get("events", [])
        except Exception as e:
            logger.error(f"Failed to get events: {e}")
        return []
    
    def get_sites(self) -> List[str]:
        """Get available sites"""
        try:
            response = requests.get(f"{self.base_url}/api/sites", timeout=2)
            if response.status_code == 200:
                data = response.json()
                return data.get("sites", [])
        except Exception:
            return []


class ServiceManager:
    """Manage OpenBrowser and eval server processes"""
    
    def __init__(self):
        self.openbrowser_proc = None
        self.eval_server_proc = None
    
    def start_openbrowser(self) -> bool:
        """Start OpenBrowser server"""
        try:
            # Check if already running
            client = OpenBrowserClient()
            if client.health_check():
                logger.info("OpenBrowser server already running")
                return True
            
            logger.info("Starting OpenBrowser server...")
            # Assuming uv run local-chrome-server serve
            cmd = ["uv", "run", "local-chrome-server", "serve"]
            self.openbrowser_proc = subprocess.Popen(
                cmd,
                cwd=EVAL_DIR.parent,  # OpenBrowser root
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            # Wait a bit for server to start
            time.sleep(5)
            
            # Verify it's running
            for _ in range(10):
                if client.health_check():
                    logger.info("OpenBrowser server started successfully")
                    return True
                time.sleep(2)
            
            logger.error("OpenBrowser server failed to start")
            return False
            
        except Exception as e:
            logger.error(f"Failed to start OpenBrowser server: {e}")
            return False
    
    def start_eval_server(self) -> bool:
        """Start eval server"""
        try:
            client = EvalServerClient()
            if client.health_check():
                logger.info("Eval server already running")
                return True
            
            logger.info("Starting eval server...")
            cmd = [sys.executable, str(EVAL_DIR / "server.py")]
            self.eval_server_proc = subprocess.Popen(
                cmd,
                cwd=EVAL_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            time.sleep(2)
            
            for _ in range(10):
                if client.health_check():
                    logger.info("Eval server started successfully")
                    return True
                time.sleep(2)
            
            logger.error("Eval server failed to start")
            return False
            
        except Exception as e:
            logger.error(f"Failed to start eval server: {e}")
            return False
    
    def stop_services(self):
        """Stop all services"""
        if self.openbrowser_proc:
            try:
                os.killpg(os.getpgid(self.openbrowser_proc.pid), signal.SIGTERM)
                self.openbrowser_proc.wait(timeout=5)
                logger.info("OpenBrowser server stopped")
            except Exception as e:
                logger.error(f"Error stopping OpenBrowser server: {e}")
            self.openbrowser_proc = None
        
        if self.eval_server_proc:
            try:
                os.killpg(os.getpgid(self.eval_server_proc.pid), signal.SIGTERM)
                self.eval_server_proc.wait(timeout=5)
                logger.info("Eval server stopped")
            except Exception as e:
                logger.error(f"Error stopping eval server: {e}")
            self.eval_server_proc = None


class Evaluator:
    """Main evaluator class"""
    
    def __init__(self):
        self.openbrowser = OpenBrowserClient()
        self.eval_server = EvalServerClient()
        self.service_manager = ServiceManager()
        self.results: List[TestResult] = []
    
    def ensure_services(self) -> bool:
        """Ensure required services are running"""
        logger.info("Checking services...")
        
        # Start eval server if needed
        if not self.eval_server.health_check():
            if not self.service_manager.start_eval_server():
                logger.error("Failed to start eval server")
                return False
        
        # Start OpenBrowser if needed
        if not self.openbrowser.health_check():
            if not self.service_manager.start_openbrowser():
                logger.error("Failed to start OpenBrowser server")
                return False
        
        return True
    
    def load_test_cases(self) -> List[TestCase]:
        """Load all test cases from dataset directory"""
        test_cases = []
        
        if not DATASET_DIR.exists():
            logger.warning(f"Dataset directory not found: {DATASET_DIR}")
            return test_cases
        
        for yaml_file in DATASET_DIR.glob("*.yaml"):
            try:
                with open(yaml_file, 'r') as f:
                    data = yaml.safe_load(f)
                
                test_case = TestCase(
                    id=data.get("id", yaml_file.stem),
                    name=data.get("name", yaml_file.stem),
                    description=data.get("description", ""),
                    instruction=data.get("instruction", ""),
                    start_url=data.get("start_url", ""),
                    criteria=data.get("criteria", []),
                    difficulty=data.get("difficulty", "medium")
                )
                test_cases.append(test_case)
                logger.info(f"Loaded test case: {test_case.name}")
                
            except Exception as e:
                logger.error(f"Failed to load test case from {yaml_file}: {e}")
        
        return test_cases
    
    def run_test(self, test_case: TestCase) -> TestResult:
        """Run a single test case"""
        logger.info(f"Running test: {test_case.name}")
        
        # Clear previous events
        self.eval_server.clear_events()
        
        # Create new conversation
        conversation_id = self.openbrowser.create_conversation()
        if not conversation_id:
            return TestResult(
                test_case=test_case,
                passed=False,
                score=0,
                max_score=len(test_case.criteria),
                events=[],
                sse_events=[],
                track_events=[],
                images=[],
                error="Failed to create conversation"
            )
        
        # Initialize with start URL if provided
        if test_case.start_url:
            init_message = f"Open {test_case.start_url}"
            self.openbrowser.send_message(conversation_id, init_message)
            time.sleep(2)  # Wait for page load
        
        # Send the main instruction
        sse_events = self.openbrowser.send_message(conversation_id, test_case.instruction)
        
        # Wait a bit for any pending actions
        time.sleep(3)
        
        # Get tracking events
        track_events = self.eval_server.get_events()
        
        # Extract and save images from SSE events
        images = self._extract_images(sse_events, test_case.id, conversation_id)
        
        # Evaluate against criteria
        passed, score, max_score = self._evaluate_criteria(test_case, track_events, sse_events)
        
        # Clean up conversation
        self.openbrowser.delete_conversation(conversation_id)
        
        return TestResult(
            test_case=test_case,
            passed=passed,
            score=score,
            max_score=max_score,
            events=[],  # Combined events if needed
            sse_events=sse_events,
            track_events=track_events,
            images=images,
            conversation_id=conversation_id
        )
    
    def _extract_images(self, sse_events: List[Dict[str, Any]], test_id: str, conversation_id: str) -> List[str]:
        """Extract and save images from SSE events"""
        images = []
        image_count = 0
        
        for event in sse_events:
            if event["type"] == "screenshot" or "image" in event.get("data", {}):
                data = event.get("data", {})
                image_data = data.get("image") or data.get("screenshot") or data.get("data", {}).get("image")
                
                if image_data:
                    try:
                        # Handle base64 image data
                        if isinstance(image_data, str) and image_data.startswith("data:image"):
                            # data:image/png;base64,...
                            parts = image_data.split(",")
                            if len(parts) == 2:
                                image_data = parts[1]
                        
                        # Decode and save
                        image_bytes = base64.b64decode(image_data)
                        image_filename = f"{test_id}_{conversation_id}_{image_count:03d}.png"
                        image_path = IMAGES_DIR / image_filename
                        
                        with open(image_path, "wb") as f:
                            f.write(image_bytes)
                        
                        images.append(str(image_path))
                        image_count += 1
                        logger.info(f"Saved image: {image_filename}")
                        
                    except Exception as e:
                        logger.error(f"Failed to extract image: {e}")
        
        return images
    
    def _evaluate_criteria(self, test_case: TestCase, track_events: List[Dict], sse_events: List[Dict]) -> Tuple[bool, float, float]:
        """Evaluate test against criteria"""
        max_score = sum(criterion.get("points", 1) for criterion in test_case.criteria)
        score = 0
        
        for criterion in test_case.criteria:
            criterion_type = criterion.get("type")
            expected = criterion.get("expected")
            points = criterion.get("points", 1)
            alternative = criterion.get("alternative")
            
            if self._check_criterion(expected, track_events, sse_events) or \
               (alternative and self._check_criterion(alternative, track_events, sse_events)):
                score += points
        
        passed = score >= max_score * 0.8  # 80% threshold
        return passed, score, max_score
    
    def _check_criterion(self, expected: Dict, track_events: List[Dict], sse_events: List[Dict]) -> bool:
        """Check if a single criterion is met"""
        # Check each track event for match
        for event in track_events:
            if self._event_matches_expected(event, expected):
                logger.debug(f"Criterion matched by event: {event.get('eventType')}")
                return True
        
        # Also check SSE events if needed
        for event in sse_events:
            # SSE events have 'type' and 'data'
            if self._sse_event_matches_expected(event, expected):
                logger.debug(f"Criterion matched by SSE event: {event.get('type')}")
                return True
        
        logger.debug(f"Criterion not met")
        return False
    
    def _event_matches_expected(self, event: Dict, expected: Dict) -> bool:
        """Check if a track event matches expected criteria"""
        # List of reserved keys that have special handling
        reserved_keys = {
            "event_type", "page", "page_contains", "element_id", "element_class",
            "element_text", "element_href", "value_contains", "value_length_min", "check"
        }
        
        # First check event type (mapping from event_type to eventType)
        expected_event_type = expected.get("event_type")
        if expected_event_type and event.get("eventType") != expected_event_type:
            return False
        
        # Check page condition
        expected_page = expected.get("page")
        if expected_page and event.get("page") != expected_page:
            return False
        
        expected_page_contains = expected.get("page_contains")
        if expected_page_contains and expected_page_contains not in event.get("page", ""):
            return False
        
        # Check element conditions
        expected_element_id = expected.get("element_id")
        if expected_element_id and event.get("elementId") != expected_element_id:
            return False
        
        expected_element_class = expected.get("element_class")
        if expected_element_class and event.get("elementClass") != expected_element_class:
            return False
        
        expected_element_text = expected.get("element_text")
        if expected_element_text and expected_element_text not in (event.get("elementText") or ""):
            return False
        
        expected_element_href = expected.get("element_href")
        if expected_element_href and expected_element_href not in (event.get("elementHref") or ""):
            # elementHref may not be tracked, we can check selector
            pass
        
        # Check input value
        expected_value_contains = expected.get("value_contains")
        if expected_value_contains:
            # For input events, value may be in data
            value = event.get("value") or event.get("inputValue")
            if not value or expected_value_contains not in value:
                return False
        
        expected_value_length_min = expected.get("value_length_min")
        if expected_value_length_min is not None:
            value_length = event.get("valueLength")
            if value_length is None or value_length < expected_value_length_min:
                return False
        
        # Additional custom checks
        expected_check = expected.get("check")
        if expected_check == "upvote_count_changed":
            # Placeholder for custom logic
            # Could check if upvote count increased in subsequent events
            pass
        
        # Check all other expected fields directly against event
        for key, expected_value in expected.items():
            if key in reserved_keys:
                continue
            # Handle nested keys? Not needed for now
            if key not in event:
                return False
            if event[key] != expected_value:
                return False
        
        # All conditions satisfied
        return True
    
    def _sse_event_matches_expected(self, event: Dict, expected: Dict) -> bool:
        """Check if an SSE event matches expected criteria"""
        # Currently not using SSE events for criteria
        return False
    
    def generate_report(self):
        """Generate evaluation report"""
        report_path = OUTPUT_DIR / f"evaluation_report_{time.strftime('%Y%m%d_%H%M%S')}.json"
        
        report = {
            "timestamp": time.time(),
            "total_tests": len(self.results),
            "passed_tests": sum(1 for r in self.results if r.passed),
            "total_score": sum(r.score for r in self.results),
            "max_score": sum(r.max_score for r in self.results),
            "results": [
                {
                    "test_id": r.test_case.id,
                    "test_name": r.test_case.name,
                    "passed": r.passed,
                    "score": r.score,
                    "max_score": r.max_score,
                    "conversation_id": r.conversation_id,
                    "error": r.error,
                    "image_count": len(r.images),
                    "track_event_count": len(r.track_events),
                    "sse_event_count": len(r.sse_events)
                }
                for r in self.results
            ]
        }
        
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        logger.info(f"Report saved to: {report_path}")
        
        # Print summary
        print("\n" + "="*60)
        print("EVALUATION SUMMARY")
        print("="*60)
        print(f"Total tests: {report['total_tests']}")
        print(f"Passed tests: {report['passed_tests']}")
        print(f"Total score: {report['total_score']}/{report['max_score']}")
        print(f"Success rate: {report['passed_tests']/report['total_tests']*100:.1f}%")
        print("="*60)
        
        for result in self.results:
            status = "PASS" if result.passed else "FAIL"
            print(f"{result.test_case.name:30} {status:10} {result.score:.1f}/{result.max_score:.1f}")
        
        return report_path
    
    def run_all(self):
        """Run all test cases"""
        if not self.ensure_services():
            logger.error("Cannot run tests: services unavailable")
            return False
        
        test_cases = self.load_test_cases()
        if not test_cases:
            logger.warning("No test cases found")
            return False
        
        logger.info(f"Running {len(test_cases)} test cases")
        
        for test_case in test_cases:
            result = self.run_test(test_case)
            self.results.append(result)
            
            status = "PASSED" if result.passed else "FAILED"
            logger.info(f"Test '{test_case.name}' {status}: {result.score:.1f}/{result.max_score:.1f}")
        
        self.generate_report()
        return True


def main():
    parser = argparse.ArgumentParser(description="Evaluate OpenBrowser agent")
    parser.add_argument("--test", help="Run specific test by ID")
    parser.add_argument("--list", action="store_true", help="List available tests")
    parser.add_argument("--no-services", action="store_true", help="Don't start services")
    parser.add_argument("--keep-alive", action="store_true", help="Keep services running after evaluation")
    
    args = parser.parse_args()
    
    evaluator = Evaluator()
    
    # Register cleanup
    if not args.keep_alive:
        atexit.register(evaluator.service_manager.stop_services)
    
    if args.list:
        test_cases = evaluator.load_test_cases()
        print(f"\nAvailable tests ({len(test_cases)}):")
        for tc in test_cases:
            print(f"  {tc.id:20} {tc.name:30} ({tc.difficulty})")
            print(f"    {tc.description[:80]}...")
        return
    
    if args.test:
        # Run single test
        test_cases = evaluator.load_test_cases()
        test_case = next((tc for tc in test_cases if tc.id == args.test), None)
        if not test_case:
            logger.error(f"Test not found: {args.test}")
            return
        
        if not args.no_services and not evaluator.ensure_services():
            logger.error("Services unavailable")
            return
        
        result = evaluator.run_test(test_case)
        print(f"\nTest result for {test_case.name}:")
        print(f"  Status: {'PASS' if result.passed else 'FAIL'}")
        print(f"  Score: {result.score:.1f}/{result.max_score:.1f}")
        print(f"  Conversation ID: {result.conversation_id}")
        print(f"  Track events: {len(result.track_events)}")
        print(f"  SSE events: {len(result.sse_events)}")
        print(f"  Images saved: {len(result.images)}")
        
    else:
        # Run all tests
        success = evaluator.run_all()
        if not success:
            sys.exit(1)


if __name__ == "__main__":
    main()