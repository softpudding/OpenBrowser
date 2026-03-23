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
import shutil
import signal
import atexit
import logging
import datetime
import threading
import fcntl
from contextlib import AbstractContextManager

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
OUTPUT_BASE_DIR = EVAL_DIR / "output"
LOCK_DIR = EVAL_DIR / ".locks"

# Ensure base directory exists
OUTPUT_BASE_DIR.mkdir(exist_ok=True)
DATASET_DIR.mkdir(exist_ok=True)
LOCK_DIR.mkdir(exist_ok=True)


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
    time_limit: float = 600.0  # default 10 minutes in seconds
    cost_limit: float = 1.0  # default 1 RMB


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
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    duration: Optional[float] = None
    cost: Optional[float] = None  # cost in RMB
    efficiency_score: Optional[float] = None  # score based on time efficiency (0-1)
    usage_score: Optional[float] = None  # score based on cost efficiency (0-1)
    total_score: Optional[float] = None  # combined score (task + efficiency + usage)
    sse_events_file: Optional[str] = None  # path to saved SSE events JSON file
    track_events_file: Optional[str] = None  # path to saved track events JSON file
    model: Optional[str] = None  # LLM model used for this test


@dataclass
class LLMTarget:
    """One configured LLM alias passed from the CLI."""

    name: str
    alias: str
    model_name: str | None = None


@dataclass
class MessageRunResult:
    """Result of sending a message to the agent."""

    events: List[Dict[str, Any]]
    timed_out: bool = False
    error: Optional[str] = None


class OpenBrowserClient:
    """Client for OpenBrowser server API"""

    def __init__(
        self, base_url: str = OPENBROWSER_API_URL, chrome_uuid: Optional[str] = None
    ):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.trust_env = False
        self.chrome_uuid = chrome_uuid

    def health_check(self) -> bool:
        """Check if OpenBrowser server is running"""
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=2)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def get_llm_configs(self) -> List[Dict[str, Any]]:
        """Fetch configured LLM entries from the server."""
        try:
            response = self.session.get(f"{self.base_url}/api/config", timeout=5)
            if response.status_code != 200:
                return []
            data = response.json()
            config = data.get("config", {})
            llm_configs = config.get("llm_configs", [])
            return llm_configs if isinstance(llm_configs, list) else []
        except Exception as e:
            logger.error(f"Failed to fetch LLM configs: {e}")
            return []

    def is_browser_valid(self) -> Optional[bool]:
        """Check whether the configured browser UUID is currently registered."""
        if not self.chrome_uuid:
            return None

        try:
            response = self.session.get(
                f"{self.base_url}/browsers/{self.chrome_uuid}/valid", timeout=3
            )
            if response.status_code != 200:
                logger.warning(
                    "Browser validity check failed: status=%s body=%s",
                    response.status_code,
                    response.text,
                )
                return None

            data = response.json()
            valid = data.get("valid")
            return bool(valid) if isinstance(valid, bool) else None
        except Exception as e:
            logger.warning(f"Browser validity check failed: {e}")
            return None

    def wait_for_browser_validity(
        self,
        timeout_seconds: float = 60.0,
        poll_interval_seconds: float = 3.0,
    ) -> bool:
        """Wait for the configured browser UUID to become valid."""
        if not self.chrome_uuid:
            return True

        deadline = time.time() + timeout_seconds
        logged_wait = False

        while time.time() < deadline:
            is_valid = self.is_browser_valid()
            if is_valid:
                if logged_wait:
                    logger.info("Browser UUID %s is valid again", self.chrome_uuid)
                return True

            if not logged_wait:
                logger.warning(
                    "Browser UUID %s is not currently valid; waiting up to %.0fs "
                    "for the extension to reconnect",
                    self.chrome_uuid,
                    timeout_seconds,
                )
                logged_wait = True

            time.sleep(poll_interval_seconds)

        logger.error(
            "Browser UUID %s did not become valid within %.0fs",
            self.chrome_uuid,
            timeout_seconds,
        )
        return False

    def create_conversation(
        self,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        model_alias: Optional[str] = None,
    ) -> Optional[str]:
        """Create a new conversation and return its ID

        Args:
            model: Optional model name (e.g., "dashscope/qwen3.5-plus")
            base_url: Optional base URL override
            model_alias: Optional configured model alias
        """
        if self.chrome_uuid and not self.wait_for_browser_validity(
            timeout_seconds=30.0
        ):
            return None

        request_json: Dict[str, Any] = {}
        if model:
            request_json["model"] = model
        if base_url:
            request_json["base_url"] = base_url
        if model_alias:
            request_json["model_alias"] = model_alias
        if self.chrome_uuid:
            request_json["browser_id"] = self.chrome_uuid

        max_attempts = 4
        for attempt in range(1, max_attempts + 1):
            try:
                response = self.session.post(
                    f"{self.base_url}/agent/conversations",
                    json=request_json,
                    timeout=5,
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get("conversation_id")

                response_text = response.text
                logger.error(
                    "Failed to create conversation (attempt %s/%s): status=%s body=%s",
                    attempt,
                    max_attempts,
                    response.status_code,
                    response_text,
                )

                should_wait_for_browser = (
                    self.chrome_uuid is not None
                    and response.status_code == 400
                    and "Invalid or expired browser_id" in response_text
                )
                if should_wait_for_browser and attempt < max_attempts:
                    if self.wait_for_browser_validity(timeout_seconds=90.0):
                        continue
                    return None

            except Exception as e:
                logger.error(
                    "Failed to create conversation (attempt %s/%s): %s",
                    attempt,
                    max_attempts,
                    e,
                )
                if attempt < max_attempts:
                    time.sleep(3.0)
        return None

    def send_message(
        self,
        conversation_id: str,
        message: str,
        cwd: str = ".",
        timeout_seconds: Optional[float] = None,
    ) -> MessageRunResult:
        """Send a message to the agent and collect SSE events."""
        if timeout_seconds is not None and timeout_seconds <= 0:
            return MessageRunResult(events=[], timed_out=True)

        events: List[Dict[str, Any]] = []
        error: Optional[str] = None
        timed_out = False
        response_holder: Dict[str, Any] = {"response": None, "aborted": False}

        def _collect_events() -> None:
            nonlocal error
            response = None
            local_session = requests.Session()
            local_session.trust_env = False
            try:
                response = local_session.post(
                    f"{self.base_url}/agent/conversations/{conversation_id}/messages",
                    json={
                        "text": message,
                        "cwd": cwd,
                        "browser_id": self.chrome_uuid,
                    },
                    stream=True,
                    headers={"Accept": "text/event-stream"},
                    timeout=90,  # Per-read timeout; test-level timeout is handled outside.
                )
                response_holder["response"] = response
                response.raise_for_status()

                # Parse SSE events manually
                buffer = ""

                # Simply iterate until iter_content returns empty (connection closed)
                for chunk in response.iter_content(
                    chunk_size=1024, decode_unicode=True
                ):
                    if not chunk:
                        # Empty chunk means end of stream
                        break

                    buffer += chunk
                    # Split on double newlines
                    while "\n\n" in buffer:
                        event_str, buffer = buffer.split("\n\n", 1)
                        event_lines = event_str.strip().split("\n")
                        event_type = None
                        data = {}
                        for line in event_lines:
                            line = line.strip()
                            if line.startswith("event:"):
                                event_type = line[6:].strip()
                            elif line.startswith("data:"):
                                data_str = line[5:].strip()
                                try:
                                    data = json.loads(data_str)
                                except json.JSONDecodeError:
                                    data = data_str
                        if event_type:
                            events.append(
                                {
                                    "type": event_type,
                                    "data": data,
                                    "timestamp": time.time(),
                                }
                            )
                            logger.debug(f"SSE event: {event_type}")

                # Process any remaining buffer (incomplete event)
                if buffer.strip():
                    logger.debug(f"Processing trailing buffer: {buffer[:200]}")
                    # Try to parse as event even without \n\n delimiter
                    event_lines = buffer.strip().split("\n")
                    event_type = None
                    data = {}
                    for line in event_lines:
                        line = line.strip()
                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("data:"):
                            data_str = line[5:].strip()
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                data = data_str
                    if event_type:
                        events.append(
                            {
                                "type": event_type,
                                "data": data,
                                "timestamp": time.time(),
                            }
                        )
                        logger.debug(f"Processed trailing SSE event: {event_type}")

                # Check if we have complete and usage_metrics events
                has_complete = any(e["type"] == "complete" for e in events)
                has_usage_metrics = any(e["type"] == "usage_metrics" for e in events)

                logger.debug(
                    f"Event summary - Complete: {has_complete}, Usage Metrics: {has_usage_metrics}"
                )

                if has_complete and not has_usage_metrics:
                    logger.warning(
                        "Conversation completed but no usage_metrics event received"
                    )

            except Exception as e:
                if response_holder["aborted"]:
                    logger.info(
                        "Stopped SSE collection after hitting the test time limit"
                    )
                else:
                    error = f"Failed to send message: {e}"
                    logger.error(error)
            finally:
                if response is not None:
                    response.close()
                local_session.close()

        worker = threading.Thread(target=_collect_events, daemon=True)
        worker.start()
        worker.join(timeout=timeout_seconds)

        if worker.is_alive():
            timed_out = True
            response_holder["aborted"] = True
            response = response_holder.get("response")
            if response is not None:
                response.close()
            worker.join(timeout=5)
            if worker.is_alive():
                logger.warning(
                    "SSE collector thread did not exit promptly after timeout"
                )

        # Log all event types for debugging
        event_types = [e["type"] for e in events]
        logger.debug(f"Total SSE events collected: {len(events)}, types: {event_types}")

        return MessageRunResult(
            events=list(events),
            timed_out=timed_out,
            error=error,
        )

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation"""
        try:
            response = self.session.delete(
                f"{self.base_url}/agent/conversations/{conversation_id}", timeout=5
            )
            return response.status_code == 200
        except Exception:
            return False

    def get_managed_tabs(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Return managed tabs for a conversation."""
        if not self.chrome_uuid:
            return []

        try:
            response = self.session.get(
                f"{self.base_url}/tabs",
                params={
                    "browser_id": self.chrome_uuid,
                    "conversation_id": conversation_id,
                    "managed_only": "true",
                },
                timeout=5,
            )
            if response.status_code != 200:
                logger.warning(
                    "Failed to fetch managed tabs for %s: status=%s body=%s",
                    conversation_id,
                    response.status_code,
                    response.text,
                )
                return []

            data = response.json()
            if not data.get("success"):
                logger.warning(
                    "Managed tab fetch was unsuccessful for %s: %s",
                    conversation_id,
                    data,
                )
                return []

            tabs = data.get("data", {}).get("tabs", [])
            return tabs if isinstance(tabs, list) else []
        except Exception as e:
            logger.warning(
                "Failed to fetch managed tabs for %s: %s", conversation_id, e
            )
            return []

    def close_tab(self, conversation_id: str, tab_id: int) -> bool:
        """Close a managed tab for a conversation."""
        if not self.chrome_uuid:
            return False

        try:
            response = self.session.post(
                f"{self.base_url}/tabs",
                params={
                    "action": "close",
                    "browser_id": self.chrome_uuid,
                    "conversation_id": conversation_id,
                    "tab_id": tab_id,
                },
                timeout=5,
            )
            if response.status_code != 200:
                logger.warning(
                    "Failed to close tab %s for %s: status=%s body=%s",
                    tab_id,
                    conversation_id,
                    response.status_code,
                    response.text,
                )
                return False

            data = response.json()
            success = bool(data.get("success"))
            if not success:
                logger.warning(
                    "Close tab command failed for tab %s in %s: %s",
                    tab_id,
                    conversation_id,
                    data,
                )
            return success
        except Exception as e:
            logger.warning(
                "Failed to close tab %s for %s: %s",
                tab_id,
                conversation_id,
                e,
            )
            return False

    def cleanup_managed_tabs(self, conversation_id: str) -> bool:
        """Close all managed tabs opened for a conversation."""
        tabs = self.get_managed_tabs(conversation_id)
        if not tabs:
            return True

        all_closed = True
        for tab in tabs:
            tab_id = tab.get("tabId")
            if not isinstance(tab_id, int):
                tab_id = tab.get("tab_id")
            if not isinstance(tab_id, int):
                logger.warning(
                    "Skipping managed tab cleanup for %s due to missing tab id: %s",
                    conversation_id,
                    tab,
                )
                all_closed = False
                continue

            if not self.close_tab(conversation_id, tab_id):
                all_closed = False

        return all_closed

class EvalServerClient:
    """Client for evaluation server tracking API"""

    def __init__(self, base_url: str = EVAL_SERVER_URL):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.trust_env = False

    def health_check(self) -> bool:
        """Check if eval server is running"""
        try:
            response = self.session.get(f"{self.base_url}/api/events", timeout=2)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def clear_events(self) -> bool:
        """Clear all tracked events"""
        try:
            response = self.session.get(f"{self.base_url}/api/events/clear", timeout=2)
            return response.status_code == 200
        except Exception:
            return False

    def get_events(self) -> List[Dict[str, Any]]:
        """Get all tracked events"""
        try:
            response = self.session.get(f"{self.base_url}/api/events", timeout=5)
            if response.status_code == 200:
                data = response.json()
                return data.get("events", [])
        except Exception as e:
            logger.error(f"Failed to get events: {e}")
        return []

    def get_sites(self) -> List[str]:
        """Get available sites"""
        try:
            response = self.session.get(f"{self.base_url}/api/sites", timeout=2)
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
        """Check if OpenBrowser server is running, prompt user to start if not"""
        try:
            # Check if already running
            client = OpenBrowserClient()
            if client.health_check():
                logger.info("OpenBrowser server is running ✓")
                return True

            root_dir = EVAL_DIR.parent
            logger.error(f"""
❌ OpenBrowser server is not running!
   Please start the OpenBrowser server manually with:

   cd {root_dir}
   uv run local-chrome-server serve

   The server should start on port 8765 (REST API) and 8766 (WebSocket).
""")
            return False

        except Exception as e:
            logger.error(f"Failed to check OpenBrowser server status: {e}")
            return False

    def start_eval_server(self) -> bool:
        """Check if eval server is running, prompt user to start if not"""
        try:
            client = EvalServerClient()
            if client.health_check():
                logger.info("Eval server is running ✓")
                return True

            eval_dir = EVAL_DIR
            root_dir = EVAL_DIR.parent
            logger.error(f"""
❌ Eval server is not running!
   Please start the eval server manually with:

   cd {eval_dir}
   python server.py

   Or in another terminal:
   cd {root_dir}
   uv run python eval/server.py

   The server should start on port 16605.
""")
            return False

        except Exception as e:
            logger.error(f"Failed to check eval server status: {e}")
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


class EvaluationRunLock(AbstractContextManager["EvaluationRunLock"]):
    """Prevent concurrent evaluation runs from reusing the same browser UUID."""

    def __init__(self, browser_uuid: str):
        safe_uuid = browser_uuid.replace("/", "_")
        self.browser_uuid = browser_uuid
        self.path = LOCK_DIR / f"evaluation_{safe_uuid}.lock"
        self._handle: Optional[Any] = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.seek(0)
            existing = handle.read().strip()
            handle.close()
            detail = f" Existing lock info: {existing}" if existing else ""
            raise RuntimeError(
                "Another evaluation run is already using browser UUID "
                f"{self.browser_uuid}.{detail}"
            )

        handle.seek(0)
        handle.truncate()
        payload = {
            "pid": os.getpid(),
            "browser_uuid": self.browser_uuid,
            "started_at": datetime.datetime.now().isoformat(),
        }
        handle.write(json.dumps(payload))
        handle.flush()
        self._handle = handle

    def release(self) -> None:
        if self._handle is None:
            return

        try:
            self._handle.seek(0)
            self._handle.truncate()
            fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None

    def __enter__(self) -> "EvaluationRunLock":
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()
        return None


class Evaluator:
    """Main evaluator class"""

    def __init__(self, chrome_uuid: Optional[str] = None):
        self.chrome_uuid = chrome_uuid
        self.openbrowser = OpenBrowserClient(chrome_uuid=chrome_uuid)
        self.eval_server = EvalServerClient()
        self.service_manager = ServiceManager()
        self.results: List[TestResult] = []
        self.output_dir: Optional[Path] = None  # Will be set per run
        self.current_model: Optional[str] = None  # Current model being tested
        self.current_target: Optional[LLMTarget] = None  # Current CLI target

    def resolve_targets(self, targets: List[LLMTarget]) -> List[LLMTarget]:
        """Resolve configured aliases to raw model names."""
        llm_configs = self.openbrowser.get_llm_configs()
        alias_to_model = {
            config.get("alias"): config.get("model")
            for config in llm_configs
            if isinstance(config, dict) and config.get("alias") and config.get("model")
        }

        resolved_targets: List[LLMTarget] = []
        missing_aliases: List[str] = []

        for target in targets:
            model_name = alias_to_model.get(target.alias)
            if not isinstance(model_name, str) or not model_name:
                missing_aliases.append(target.alias)
                continue
            resolved_targets.append(
                LLMTarget(
                    name=model_name,
                    alias=target.alias,
                    model_name=model_name,
                )
            )

        if missing_aliases:
            raise ValueError(
                "Unknown model alias(es): "
                + ", ".join(missing_aliases)
                + ". Configure them first in the OpenBrowser frontend."
            )

        return resolved_targets

    def ensure_services(
        self, skip_services: bool = False, manual: bool = False
    ) -> bool:
        """Ensure required services are running, or skip check if requested

        Args:
            skip_services: If True, skip all service checks
            manual: If True, only check eval server (manual mode doesn't need OpenBrowser)
        """
        if skip_services:
            logger.info("Skipping service checks (--no-services flag used)")
            return True

        logger.info("Checking services...")

        # Check eval server
        if not self.eval_server.health_check():
            if not self.service_manager.start_eval_server():
                logger.error("Eval server check failed")
                return False

        # Check OpenBrowser server (skip in manual mode)
        if not manual:
            if not self.openbrowser.health_check():
                if not self.service_manager.start_openbrowser():
                    logger.error("OpenBrowser server check failed")
                    return False
            logger.info("All services are running ✓")
        else:
            logger.info("Eval server is running (manual mode) ✓")

        return True

    def _cleanup_openbrowser_conversation(self, conversation_id: Optional[str]) -> None:
        """Close managed tabs and delete the OpenBrowser conversation."""
        if not conversation_id:
            return

        cleaned_up = self.openbrowser.cleanup_managed_tabs(conversation_id)
        if not cleaned_up:
            logger.warning(
                "Managed tab cleanup did not fully succeed for conversation %s",
                conversation_id,
            )
        self.openbrowser.delete_conversation(conversation_id)

    def load_test_cases(self) -> List[TestCase]:
        """Load all test cases from dataset directory"""
        test_cases = []

        if not DATASET_DIR.exists():
            logger.warning(f"Dataset directory not found: {DATASET_DIR}")
            return test_cases

        for yaml_file in DATASET_DIR.glob("*.yaml"):
            try:
                with open(yaml_file, "r") as f:
                    data = yaml.safe_load(f)

                test_case = TestCase(
                    id=data.get("id", yaml_file.stem),
                    name=data.get("name", yaml_file.stem),
                    description=data.get("description", ""),
                    instruction=data.get("instruction", ""),
                    start_url=data.get("start_url", ""),
                    criteria=data.get("criteria", []),
                    difficulty=data.get("difficulty", "medium"),
                    time_limit=data.get("time_limit", 600.0),
                    cost_limit=data.get("cost_limit", 1.0),
                )
                test_cases.append(test_case)
                logger.info(f"Loaded test case: {test_case.name}")

            except Exception as e:
                logger.error(f"Failed to load test case from {yaml_file}: {e}")

        return test_cases

    def run_test(self, test_case: TestCase) -> TestResult:
        """Run a single test case"""
        logger.info(f"Running test: {test_case.name}")

        # Ensure output directory exists with model subdirectory
        if self.output_dir is None:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            self.output_dir = OUTPUT_BASE_DIR / timestamp
            self.output_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created base output directory: {self.output_dir}")

        # Create model-specific subdirectory if model is set
        model_output_dir = self.output_dir
        if self.current_model:
            # Sanitize model name for filesystem
            model_name_safe = self.current_model.replace("/", "_").replace(":", "_")
            model_output_dir = self.output_dir / model_name_safe
            model_output_dir.mkdir(exist_ok=True)
            logger.info(f"Using model output directory: {model_output_dir}")

        # Clear previous events
        self.eval_server.clear_events()

        # Create new conversation with current model
        conversation_id = self.openbrowser.create_conversation(
            model_alias=self.current_target.alias if self.current_target else None,
        )
        if conversation_id:
            logger.debug(f"Created conversation: {conversation_id}")
        else:
            logger.warning(
                f"Failed to create conversation for model {self.current_model}"
            )
            max_score = sum(
                criterion.get("points", 1) for criterion in test_case.criteria
            )
            return TestResult(
                test_case=test_case,
                passed=False,
                score=0,
                max_score=max_score,
                events=[],
                sse_events=[],
                track_events=[],
                images=[],
                error=(
                    f"Failed to create conversation for target {self.current_model}. "
                    "See logs for server response details."
                ),
                duration=0.0,
                cost=0.0,
                efficiency_score=0.0,
                usage_score=0.0,
                total_score=0.0,
                model=self.current_model,
            )

        start_time = time.time()
        deadline = start_time + test_case.time_limit
        sse_events: List[Dict[str, Any]] = []
        track_events: List[Dict[str, Any]] = []
        timed_out = False
        error: Optional[str] = None

        try:
            # Initialize with start URL if provided
            if test_case.start_url:
                init_message = f"Open {test_case.start_url}"
                init_result = self.openbrowser.send_message(
                    conversation_id,
                    init_message,
                    timeout_seconds=max(0.0, deadline - time.time()),
                )
                sse_events.extend(init_result.events)
                if init_result.error:
                    error = init_result.error
                if init_result.timed_out:
                    timed_out = True
                    error = (
                        f"Test exceeded time limit ({test_case.time_limit:.1f}s) "
                        "while opening the start URL"
                    )
                else:
                    remaining_time = deadline - time.time()
                    if remaining_time <= 0:
                        timed_out = True
                        error = (
                            f"Test exceeded time limit ({test_case.time_limit:.1f}s) "
                            "before running the main instruction"
                        )
                    else:
                        time.sleep(min(2.0, remaining_time))  # Wait for page load

            # Send the main instruction with the remaining test budget
            if not timed_out:
                instruction_result = self.openbrowser.send_message(
                    conversation_id,
                    test_case.instruction,
                    timeout_seconds=max(0.0, deadline - time.time()),
                )
                sse_events.extend(instruction_result.events)
                if instruction_result.error:
                    error = instruction_result.error
                if instruction_result.timed_out:
                    timed_out = True
                    error = (
                        f"Test exceeded time limit ({test_case.time_limit:.1f}s); "
                        "stopped early and scored current progress"
                    )

            end_time = time.time()
            duration = (
                test_case.time_limit if timed_out else max(0.0, end_time - start_time)
            )

            if timed_out and error:
                logger.warning(error)

            # Give the tracker a short moment to flush any in-flight events.
            pending_event_wait = 1.0 if timed_out else 3.0
            time.sleep(min(pending_event_wait, max(0.0, deadline - time.time())))

            # Get tracking events
            track_events = self.eval_server.get_events()

            # Save track events to file
            track_events_file = self._save_track_events(
                track_events, test_case.id, conversation_id, model_output_dir
            )

            # Extract and save images from SSE events
            images = self._extract_images(
                sse_events, test_case.id, conversation_id, model_output_dir
            )

            # Extract and save SSE events (excluding images) to file
            sse_events_file = self._save_sse_events(
                sse_events, test_case.id, conversation_id, model_output_dir
            )

            # Extract usage metrics from SSE events
            cost = self._extract_cost_from_sse_events(sse_events)

            # Evaluate against criteria using current events, even on timeout.
            passed, score, max_score = self._evaluate_criteria(
                test_case, track_events, sse_events
            )

            # Calculate efficiency and usage scores
            efficiency_score = (
                0.0
                if timed_out
                else self._calculate_efficiency_score(duration, test_case.time_limit)
            )
            usage_score = self._calculate_usage_score(cost, test_case.cost_limit)
            total_score = score + efficiency_score + usage_score

            return TestResult(
                test_case=test_case,
                passed=passed,
                score=score,
                max_score=max_score,
                events=[],  # Combined events if needed
                sse_events=sse_events,
                track_events=track_events,
                images=images,
                error=error,
                conversation_id=conversation_id,
                start_time=start_time,
                end_time=end_time,
                duration=duration,
                cost=cost,
                efficiency_score=efficiency_score,
                usage_score=usage_score,
                total_score=total_score,
                sse_events_file=sse_events_file,
                track_events_file=track_events_file,
                model=self.current_model,
            )
        finally:
            self._cleanup_openbrowser_conversation(conversation_id)

    def _extract_images(
        self,
        sse_events: List[Dict[str, Any]],
        test_id: str,
        conversation_id: str,
        output_dir: Optional[Path] = None,
    ) -> List[str]:
        """Extract and save images from SSE events

        Args:
            sse_events: List of SSE events
            test_id: Test case ID
            conversation_id: Conversation ID
            output_dir: Optional output directory (uses self.output_dir if None)
        """
        images = []
        image_count = 0

        # Use provided output_dir or fall back to self.output_dir
        target_dir = output_dir if output_dir is not None else self.output_dir
        if target_dir is None:
            logger.warning("No output directory specified, cannot save images")
            return images

        # Create images subdirectory
        images_dir = target_dir / "images"
        images_dir.mkdir(exist_ok=True)

        for event in sse_events:
            if event["type"] == "screenshot" or "image" in event.get("data", {}):
                data = event.get("data", {})
                image_data = (
                    data.get("image")
                    or data.get("screenshot")
                    or data.get("data", {}).get("image")
                )

                if image_data:
                    try:
                        # Handle base64 image data
                        if isinstance(image_data, str) and image_data.startswith(
                            "data:image"
                        ):
                            # data:image/png;base64,...
                            parts = image_data.split(",")
                            if len(parts) == 2:
                                image_data = parts[1]

                        # Decode and save
                        image_bytes = base64.b64decode(image_data)
                        image_filename = (
                            f"{test_id}_{conversation_id}_{image_count:03d}.png"
                        )
                        image_path = images_dir / image_filename

                        with open(image_path, "wb") as f:
                            f.write(image_bytes)

                        images.append(str(image_path))
                        image_count += 1
                        # logger.info(f"Saved image: {image_filename}")

                    except Exception as e:
                        logger.error(f"Failed to extract image: {e}")

        return images

    def _save_sse_events(
        self,
        sse_events: List[Dict[str, Any]],
        test_id: str,
        conversation_id: str,
        output_dir: Optional[Path] = None,
    ) -> Optional[str]:
        """Save SSE events (excluding image data) to JSON file

        Args:
            sse_events: List of SSE events
            test_id: Test case ID
            conversation_id: Conversation ID
            output_dir: Optional output directory (uses self.output_dir if None)
        """
        try:
            # Use provided output_dir or fall back to self.output_dir
            target_dir = output_dir if output_dir is not None else self.output_dir
            if target_dir is None:
                logger.warning("No output directory specified, cannot save SSE events")
                return None

            # Create events subdirectory
            events_dir = target_dir / "events"
            events_dir.mkdir(exist_ok=True)

            # Prepare events for saving (remove large image data)
            events_to_save = []
            for event in sse_events:
                event_copy = event.copy()
                # Remove image data from data field if present
                if "data" in event_copy and isinstance(event_copy["data"], dict):
                    data_copy = event_copy["data"].copy()
                    # Remove image-related fields
                    for field in ["image", "screenshot"]:
                        if field in data_copy:
                            data_copy[field] = "[IMAGE_DATA_REMOVED]"
                    # Also check nested data field
                    if (
                        "data" in data_copy
                        and isinstance(data_copy["data"], dict)
                        and "image" in data_copy["data"]
                    ):
                        data_copy["data"]["image"] = "[IMAGE_DATA_REMOVED]"
                    event_copy["data"] = data_copy
                events_to_save.append(event_copy)

            # Save to JSON file
            filename = f"{test_id}_{conversation_id}_events.json"
            filepath = events_dir / filename

            with open(filepath, "w") as f:
                json.dump(events_to_save, f, indent=2, default=str)

            # logger.info(f"Saved SSE events to: {filepath}")
            return str(filepath)

        except Exception as e:
            logger.error(f"Failed to save SSE events: {e}")
            return None

    def _save_track_events(
        self,
        track_events: List[Dict[str, Any]],
        test_id: str,
        conversation_id: str,
        output_dir: Optional[Path] = None,
    ) -> Optional[str]:
        """Save browser track events to JSON file

        Args:
            track_events: List of track events (from eval server /api/events)
            test_id: Test case ID
            conversation_id: Conversation ID
            output_dir: Optional output directory (uses self.output_dir if None)
        """
        try:
            # Use provided output_dir or fall back to self.output_dir
            target_dir = output_dir if output_dir is not None else self.output_dir
            if target_dir is None:
                logger.warning(
                    "No output directory specified, cannot save track events"
                )
                return None

            # Create events subdirectory
            events_dir = target_dir / "events"
            events_dir.mkdir(exist_ok=True)

            # Save to JSON file
            filename = f"{test_id}_{conversation_id}_track_events.json"
            filepath = events_dir / filename

            with open(filepath, "w") as f:
                json.dump(track_events, f, indent=2, default=str)

            logger.debug(f"Saved track events to: {filepath}")
            return str(filepath)

        except Exception as e:
            logger.error(f"Failed to save track events: {e}")
            return None

    def _extract_cost_from_sse_events(
        self, sse_events: List[Dict[str, Any]]
    ) -> Optional[float]:
        """Extract cost in RMB from SSE events (usage_metrics event)"""
        usage_metric_events = [
            event for event in sse_events if event.get("type") == "usage_metrics"
        ]

        for event in reversed(usage_metric_events):
            event_type = event.get("type")
            if event_type == "usage_metrics":
                logger.debug(f"Found usage_metrics event: {event}")
                data = event.get("data", {})
                metrics = data.get("metrics", {})
                accumulated_cost = metrics.get("accumulated_cost")

                logger.debug(
                    f"Extracted metrics keys: {list(metrics.keys())}, accumulated_cost: {accumulated_cost}"
                )

                if accumulated_cost is not None:
                    # Check if model is dashscope/qwen3.5 series (cost already in RMB)
                    # Otherwise convert from USD to RMB (exchange rate 7)
                    model_name = metrics.get("model_name", "")
                    token_usage = metrics.get("accumulated_token_usage", {})
                    model_name_from_token = token_usage.get("model", "")

                    logger.debug(
                        f"Model name from metrics: '{model_name}', from token usage: '{model_name_from_token}'"
                    )

                    is_dashscope = (
                        "dashscope/qwen3.5" in model_name
                        or "dashscope/qwen3.5" in model_name_from_token
                    )

                    if is_dashscope:
                        # Already in RMB
                        logger.debug(
                            f"DashScope model detected, cost already in RMB: {accumulated_cost}"
                        )
                        return float(accumulated_cost)
                    else:
                        # Assume USD, convert to RMB
                        logger.debug(
                            f"Non-DashScope model, converting USD to RMB: {accumulated_cost} * 7 = {float(accumulated_cost) * 7.0}"
                        )
                        return float(accumulated_cost) * 7.0
                else:
                    logger.debug(
                        f"No accumulated_cost found in metrics. Available keys: {list(metrics.keys())}"
                    )

        logger.debug(
            f"No valid usage_metrics event found in {len(sse_events)} SSE events"
        )
        # Log event types for debugging
        event_types = [e.get("type") for e in sse_events]
        logger.debug(f"Event types found: {event_types}")
        return None

    def _calculate_efficiency_score(self, duration: float, time_limit: float) -> float:
        """Calculate efficiency score based on duration (0-1)"""
        if duration <= 0:
            return 1.0
        if duration > time_limit:
            return 0.0
        # Linear score: 1 at 0 seconds, 0 at time_limit
        return max(0.0, 1.0 - (duration / time_limit))

    def _calculate_usage_score(self, cost: Optional[float], cost_limit: float) -> float:
        """Calculate usage score based on cost (0-1)"""
        if cost is None or cost <= 0:
            # No cost information or zero cost gets full score
            return 1.0
        if cost > cost_limit:
            return 0.0
        # Linear score: 1 at 0 cost, 0 at cost_limit
        return max(0.0, 1.0 - (cost / cost_limit))

    def _evaluate_criteria(
        self, test_case: TestCase, track_events: List[Dict], sse_events: List[Dict]
    ) -> Tuple[bool, float, float]:
        """Evaluate test against criteria"""
        max_score = sum(criterion.get("points", 1) for criterion in test_case.criteria)
        score = 0

        for criterion in test_case.criteria:
            criterion_type = criterion.get("type")
            expected = criterion.get("expected")
            points = criterion.get("points", 1)
            alternative = criterion.get("alternative")
            optional = criterion.get("optional", False)

            # For optional criteria, we give the points automatically (treat as satisfied)
            if optional:
                score += points
                logger.debug(
                    f"Optional criterion '{criterion_type}' satisfied: +{points} points"
                )
                continue

            if self._check_criterion(expected, track_events, sse_events) or (
                alternative
                and self._check_criterion(alternative, track_events, sse_events)
            ):
                score += points
                logger.debug(
                    f"Criterion '{criterion_type}' satisfied: +{points} points"
                )
            else:
                logger.debug(f"Criterion '{criterion_type}' not satisfied: 0 points")

        passed = score >= max_score * 0.8  # 80% threshold
        return passed, score, max_score

    def _check_criterion(
        self, expected: Dict, track_events: List[Dict], sse_events: List[Dict]
    ) -> bool:
        """Check if a single criterion is met"""
        event_type = expected.get("event_type")

        # Special handling for count_min conditions (not a real event type)
        if event_type == "count_min":
            return self._check_count_min_condition(expected, track_events)

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

    def _check_count_min_condition(
        self, expected: Dict, track_events: List[Dict]
    ) -> bool:
        """Check if a count_min condition is met"""
        condition = expected.get("condition", "")
        required_count = expected.get("count", 0)
        page_filter = expected.get("page")
        page_contains_filter = expected.get("page_contains")

        logger.debug(
            f"Checking count_min condition: {condition}, min count: {required_count}"
        )

        count = 0

        for event in track_events:
            # Apply page filters if specified
            if page_filter and event.get("page") != page_filter:
                continue
            if page_contains_filter and page_contains_filter not in event.get(
                "page", ""
            ):
                continue

            event_type = event.get("eventType")

            # Check condition type
            if condition == "chat_interactions":
                # Count chat input, send button clicks, or Enter key presses
                if event_type == "input" and event.get("elementId") == "chat-input":
                    count += 1
                elif event_type == "click" and event.get("elementId") == "send-btn":
                    count += 1
                elif (
                    event_type == "keydown_enter"
                    and event.get("elementId") == "chat-input"
                ):
                    count += 1
            else:
                # Default: just check event type matches condition
                if event_type == condition:
                    count += 1

        logger.debug(f"Count result: {count} >= {required_count}")
        return count >= required_count

    def _event_matches_expected(self, event: Dict, expected: Dict) -> bool:
        """Check if a track event matches expected criteria"""
        # List of reserved keys that have special handling
        reserved_keys = {
            "event_type",
            "page",
            "page_contains",
            "element_id",
            "element_class",
            "element_text",
            "element_href",
            "value_contains",
            "value_contains_any",
            "value_length_min",
            "check",
            "condition",
            "count",
            "parent_text_contains",
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
        if expected_page_contains and expected_page_contains not in event.get(
            "page", ""
        ):
            return False

        # Check element conditions
        expected_element_id = expected.get("element_id")
        if expected_element_id and event.get("elementId") != expected_element_id:
            return False

        expected_element_class = expected.get("element_class")
        if expected_element_class and expected_element_class not in (
            event.get("elementClass") or ""
        ):
            return False

        expected_element_text = expected.get("element_text")
        if expected_element_text and expected_element_text not in (
            event.get("elementText") or ""
        ):
            return False

        expected_element_href = expected.get("element_href")
        if expected_element_href and expected_element_href not in (
            event.get("elementHref") or ""
        ):
            # elementHref may not be tracked, we can check selector
            pass

        # Check parent text contains (for contextual matching)
        expected_parent_text_contains = expected.get("parent_text_contains")
        if expected_parent_text_contains:
            parent_text = event.get("parentText")
            if not parent_text or expected_parent_text_contains not in parent_text:
                return False

        # Check input value
        expected_value_contains = expected.get("value_contains")
        if expected_value_contains:
            # For input events, value may be in data
            value = event.get("value") or event.get("inputValue")
            if not value or expected_value_contains not in value:
                return False

        expected_value_contains_any = expected.get("value_contains_any")
        if expected_value_contains_any:
            # For input events, value may be in data
            value = event.get("value") or event.get("inputValue")
            if not value:
                return False
            # Check if value contains any of the specified strings
            if isinstance(expected_value_contains_any, list):
                if not any(keyword in value for keyword in expected_value_contains_any):
                    return False
            else:
                # If it's a single string, check containment
                if expected_value_contains_any not in value:
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
        # Use output_dir if set, otherwise fall back to base directory
        if self.output_dir:
            report_dir = self.output_dir
        else:
            report_dir = OUTPUT_BASE_DIR
        report_path = (
            report_dir / f"evaluation_report_{time.strftime('%Y%m%d_%H%M%S')}.json"
        )

        # Calculate aggregated scores
        total_task_score = sum(r.score for r in self.results)
        total_task_max_score = sum(r.max_score for r in self.results)
        total_efficiency_score = sum(r.efficiency_score or 0 for r in self.results)
        total_usage_score = sum(r.usage_score or 0 for r in self.results)
        total_combined_score = sum(r.total_score or r.score for r in self.results)
        total_combined_max_score = (
            total_task_max_score + len(self.results) * 2
        )  # each test has 2 bonus points (efficiency + usage)

        report = {
            "timestamp": time.time(),
            "browser_uuid": self.chrome_uuid,
            "total_tests": len(self.results),
            "passed_tests": sum(1 for r in self.results if r.passed),
            "total_task_score": total_task_score,
            "total_task_max_score": total_task_max_score,
            "total_efficiency_score": total_efficiency_score,
            "total_usage_score": total_usage_score,
            "total_combined_score": total_combined_score,
            "total_combined_max_score": total_combined_max_score,
            "average_duration": (
                sum(r.duration or 0 for r in self.results) / len(self.results)
                if self.results
                else 0
            ),
            "average_cost": (
                sum(r.cost or 0 for r in self.results) / len(self.results)
                if self.results
                else 0
            ),
            "results": [
                {
                    "test_id": r.test_case.id,
                    "test_name": r.test_case.name,
                    "passed": r.passed,
                    "task_score": r.score,
                    "task_max_score": r.max_score,
                    "efficiency_score": r.efficiency_score,
                    "usage_score": r.usage_score,
                    "total_score": r.total_score,
                    "duration": r.duration,
                    "cost": r.cost,
                    "conversation_id": r.conversation_id,
                    "error": r.error,
                    "image_count": len(r.images),
                    "track_event_count": len(r.track_events),
                    "sse_event_count": len(r.sse_events),
                    "sse_events_file": r.sse_events_file,
                    "track_events_file": r.track_events_file,
                    "model": r.model if hasattr(r, "model") else None,
                }
                for r in self.results
            ],
        }

        with open(report_path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        logger.info(f"Report saved to: {report_path}")

        # Print summary
        print("\n" + "=" * 80)
        print("EVALUATION SUMMARY")
        print("=" * 80)
        print(f"Total tests: {report['total_tests']}")
        print(f"Passed tests: {report['passed_tests']}")
        print(f"Task score: {total_task_score:.1f}/{total_task_max_score:.1f}")
        print(f"Efficiency score: {total_efficiency_score:.1f}/{len(self.results):.1f}")
        print(f"Usage score: {total_usage_score:.1f}/{len(self.results):.1f}")
        print(
            f"Combined score: {total_combined_score:.1f}/{total_combined_max_score:.1f}"
        )
        print(f"Average duration: {report['average_duration']:.1f}s")
        print(f"Average cost: {report['average_cost']:.6f} RMB")
        print("=" * 80)

        for result in self.results:
            status = "PASS" if result.passed else "FAIL"
            model_info = (
                f" [{result.model}]"
                if hasattr(result, "model") and result.model
                else ""
            )
            print(
                f"{result.test_case.name:30}{model_info:15} {status:10} Task:{result.score:.1f}/{result.max_score:.1f} "
                f"Eff:{result.efficiency_score or 0:.2f} Usage:{result.usage_score or 0:.2f} "
                f"Total:{result.total_score or result.score:.1f} "
                f"Time:{result.duration or 0:.1f}s Cost:{result.cost or 0:.6f}RMB"
            )

        return report_path

    def run_manual_test(self, test_case: TestCase) -> TestResult:
        """Run a test case in manual mode with human performing the same task as OpenBrowser"""
        logger.info(f"Running manual test: {test_case.name}")

        # Ensure output directory exists
        if self.output_dir is None:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            self.output_dir = OUTPUT_BASE_DIR / timestamp
            self.output_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created output directory: {self.output_dir}")

        # Clear previous events
        self.eval_server.clear_events()

        # Print test information
        print("\n" + "=" * 60)
        print(f"MANUAL TEST: {test_case.name}")
        print(f"Start URL: {test_case.start_url}")
        print("=" * 60)

        if test_case.start_url:
            print(f"\n📋 Please open your browser and navigate to:")
            print(f"   {test_case.start_url}")
            print("Make sure the eval server is running (localhost:16605).")
            print("The browser should load the test page.")
            input("\nPress Enter when ready to continue...")

        # Show the SAME instruction that would be given to OpenBrowser
        print(f"\n📝 Task Instruction (same as given to OpenBrowser):")
        print(f"   {test_case.instruction}")
        print(
            "\nPerform this task in the browser. Events will be tracked from this moment."
        )
        print("When you have completed the task, enter 'ok' below.")

        # Start timing when instruction is shown (same as automated test)
        start_time = time.time()

        # Wait for user to complete the entire task
        while True:
            response = (
                input("\nEnter 'ok' when you have completed the task > ")
                .strip()
                .lower()
            )
            if response == "ok":
                break
            else:
                print("Please enter 'ok' when you have completed the task.")

        end_time = time.time()
        duration = end_time - start_time

        # Wait a moment for any pending events to be tracked
        time.sleep(2)

        # Get tracking events
        track_events = self.eval_server.get_events()

        # Save track events to file (no conversation_id for manual mode, use "manual")
        track_events_file = self._save_track_events(
            track_events, test_case.id, "manual", self.output_dir
        )

        # Evaluate against criteria (no SSE events in manual mode)
        passed, score, max_score = self._evaluate_criteria(test_case, track_events, [])

        # Calculate efficiency score (skip usage score for manual mode)
        efficiency_score = self._calculate_efficiency_score(
            duration, test_case.time_limit
        )
        usage_score = 1.0  # Manual mode gets full usage score (no cost)
        total_score = score + efficiency_score + usage_score

        # No images or SSE events in manual mode
        images = []
        sse_events = []
        sse_events_file = None

        result = TestResult(
            test_case=test_case,
            passed=passed,
            score=score,
            max_score=max_score,
            events=[],
            sse_events=sse_events,
            track_events=track_events,
            images=images,
            conversation_id="manual",
            start_time=start_time,
            end_time=end_time,
            duration=duration,
            cost=None,  # No cost in manual mode
            efficiency_score=efficiency_score,
            usage_score=usage_score,
            total_score=total_score,
            sse_events_file=sse_events_file,
            track_events_file=track_events_file,
            model="manual",
        )

        # Print completion message
        print(f"\n{'=' * 60}")
        print(f"Manual test completed!")
        print(f"Duration: {duration:.1f}s")
        print(f"Track events recorded: {len(track_events)}")
        print(f"Task score: {score:.1f}/{max_score:.1f}")
        print(f"Efficiency score: {efficiency_score:.2f}/1.0")
        print(f"Usage score: {usage_score:.2f}/1.0 (manual)")
        print(f"Total score: {total_score:.1f}")
        print(f"Passed: {'YES' if passed else 'NO'}")
        print(f"Track events saved to: {track_events_file}")
        print("=" * 60)

        return result

    def run_all(
        self,
        targets: Optional[List[LLMTarget]] = None,
        skip_services: bool = False,
        manual: bool = False,
    ):
        """Run all test cases for specified LLM targets.

        Args:
            targets: Explicit LLM targets to test.
            skip_services: If True, skip service availability checks
            manual: If True, only check eval server (manual mode doesn't need OpenBrowser)
        """
        if not self.ensure_services(skip_services=skip_services, manual=manual):
            logger.error("Cannot run tests: services unavailable")
            return False

        if targets is None or len(targets) == 0:
            logger.error("No model aliases provided")
            return False

        # Create timestamped output directory
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.output_dir = OUTPUT_BASE_DIR / timestamp
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Base output directory: {self.output_dir}")

        test_cases = self.load_test_cases()
        if not test_cases:
            logger.warning("No test cases found")
            return False

        # Store overall results for summary report
        all_results = []

        target_names = [target.name for target in targets]

        for target in targets:
            logger.info(f"\n{'=' * 60}")
            logger.info(
                f"Testing target alias: {target.alias} -> model: {target.model_name}"
            )
            logger.info(f"{'=' * 60}")

            self.current_target = target
            self.current_model = target.model_name or target.name

            # Clear results for this model
            self.results = []

            # Run all test cases for this model
            for test_case in test_cases:
                result = self.run_test(test_case)
                self.results.append(result)

                status = "PASSED" if result.passed else "FAILED"
                logger.info(
                    f"Test '{test_case.name}' {status}: {result.score:.1f}/{result.max_score:.1f}"
                )

            # Generate report for this model
            if self.results:
                model_report_path = self.generate_report()
                logger.info(f"Model report saved to: {model_report_path}")

                # Add model information to results and store for summary
                for result in self.results:
                    result.model = target.model_name or target.name
                all_results.extend(self.results)

        # Generate cross-model summary report if we tested multiple models
        if len(targets) > 1 and all_results:
            self._generate_cross_model_summary(all_results, target_names)

        # Restore results for backward compatibility
        self.results = all_results

        return True

    def run_all_manual(self, skip_services: bool = False) -> bool:
        """Run all test cases in manual mode with human performing the tasks

        Args:
            skip_services: If True, skip service availability checks
        """
        if not self.ensure_services(skip_services=skip_services, manual=True):
            logger.error("Cannot run manual tests: eval server unavailable")
            return False

        # Create timestamped output directory
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.output_dir = OUTPUT_BASE_DIR / timestamp
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Manual mode output directory: {self.output_dir}")

        test_cases = self.load_test_cases()
        if not test_cases:
            logger.warning("No test cases found")
            return False

        print(f"\n{'=' * 60}")
        print(f"MANUAL ALL-TESTS MODE")
        print(f"Found {len(test_cases)} test cases to complete")
        print(f"Each test will start when you confirm ready after seeing start URL")
        print(f"{'=' * 60}")

        # Store overall results for summary report
        all_results = []

        for i, test_case in enumerate(test_cases, 1):
            print(f"\n{'=' * 60}")
            print(f"Test {i}/{len(test_cases)}: {test_case.name}")
            print(f"{'=' * 60}")

            result = self.run_manual_test(test_case)
            result.model = "manual"  # Set model to manual for consistency
            all_results.append(result)

            # Print test summary
            status = "PASSED" if result.passed else "FAILED"
            print(f"\n✓ Test '{test_case.name}' completed: {status}")
            print(f"  Task score: {result.score:.1f}/{result.max_score:.1f}")
            print(f"  Duration: {result.duration or 0:.1f}s")

            if i < len(test_cases):
                input("\nPress Enter to continue to next test...")

        # Generate summary report for manual mode
        self._generate_manual_summary(all_results)

        # Restore results for backward compatibility
        self.results = all_results

        return True

    def _generate_manual_summary(self, all_results: List[TestResult]):
        """Generate summary report for manual test run"""
        try:
            # Calculate overall statistics
            total_tests = len(all_results)
            passed_tests = sum(1 for r in all_results if r.passed)
            pass_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0

            total_task_score = sum(r.score for r in all_results)
            total_max_score = sum(r.max_score for r in all_results)
            total_efficiency_score = sum(r.efficiency_score or 0 for r in all_results)
            avg_duration = (
                sum(r.duration or 0 for r in all_results) / total_tests
                if total_tests > 0
                else 0
            )
            avg_efficiency_score = (
                total_efficiency_score / total_tests if total_tests > 0 else 0
            )

            # Generate per-test results
            test_results = {}
            for result in all_results:
                test_id = result.test_case.id
                test_results[test_id] = {
                    "name": result.test_case.name,
                    "description": result.test_case.description,
                    "difficulty": result.test_case.difficulty,
                    "passed": result.passed,
                    "task_score": result.score,
                    "task_max_score": result.max_score,
                    "efficiency_score": result.efficiency_score,
                    "duration": result.duration,
                    "conversation_id": result.conversation_id,
                    "track_events_file": result.track_events_file,
                }

            # Create summary report
            summary = {
                "timestamp": time.time(),
                "mode": "manual",
                "total_tests": total_tests,
                "passed_tests": passed_tests,
                "pass_rate": pass_rate,
                "total_task_score": total_task_score,
                "total_max_score": total_max_score,
                "total_efficiency_score": total_efficiency_score,
                "avg_duration": avg_duration,
                "avg_efficiency_score": avg_efficiency_score,
                "test_results": test_results,
            }

            # Save summary to file
            summary_path = self.output_dir / "manual_summary.json"
            with open(summary_path, "w") as f:
                json.dump(summary, f, indent=2, default=str)

            # Print final summary
            print(f"\n{'=' * 60}")
            print(f"MANUAL TESTING COMPLETE")
            print(f"{'=' * 60}")
            print(f"Total tests: {total_tests}")
            print(f"Passed tests: {passed_tests} ({pass_rate:.1f}%)")
            print(f"Total task score: {total_task_score:.1f}/{total_max_score:.1f}")
            print(f"Average efficiency score: {avg_efficiency_score:.2f}/1.0")
            print(f"Average duration: {avg_duration:.1f}s per test")
            print(f"\nDetailed results saved to: {summary_path}")
            print(f"{'=' * 60}")

            # Print per-test summary table
            print(f"\nTest Results Summary:")
            print(
                f"{'Test Name':40} {'Status':10} {'Task Score':12} {'Efficiency':12} {'Duration':10}"
            )
            print(f"{'-'*40} {'-'*10} {'-'*12} {'-'*12} {'-'*10}")

            for result in all_results:
                status = "PASS" if result.passed else "FAIL"
                task_score = f"{result.score:.1f}/{result.max_score:.1f}"
                efficiency = f"{result.efficiency_score or 0:.2f}"
                duration = f"{result.duration or 0:.1f}s"
                print(
                    f"{result.test_case.name[:40]:40} {status:10} {task_score:12} {efficiency:12} {duration:10}"
                )

        except Exception as e:
            logger.error(f"Failed to generate manual summary: {e}")

    def _build_summary(
        self, all_results: List[TestResult], models: List[str]
    ) -> Dict[str, Any]:
        """Build summary dictionary from test results"""
        # Group results by model
        results_by_model = {}
        for result in all_results:
            model = result.model or "unknown"
            if model not in results_by_model:
                results_by_model[model] = []
            results_by_model[model].append(result)

        # Calculate statistics per model
        model_stats = {}
        for model, results in results_by_model.items():
            task_score = sum(r.score for r in results)
            task_max_score = sum(r.max_score for r in results)
            efficiency_score = sum(r.efficiency_score or 0 for r in results)
            usage_score = sum(r.usage_score or 0 for r in results)
            total_score = sum(r.total_score or r.score for r in results)
            avg_duration = sum(r.duration or 0 for r in results) / len(results)
            avg_cost = sum(r.cost or 0 for r in results) / len(results)
            passed_count = sum(1 for r in results if r.passed)

            # Calculate composite score (3:1:1 weighting of pass rate, efficiency, usage)
            pass_rate = passed_count / len(results) * 100 if len(results) > 0 else 0
            normalized_pass = pass_rate / 100.0
            normalized_eff = efficiency_score / len(results) if len(results) > 0 else 0
            normalized_usage = usage_score / len(results) if len(results) > 0 else 0
            composite_score = (
                normalized_pass * 3 + normalized_eff * 1 + normalized_usage * 1
            ) / 5.0

            model_stats[model] = {
                "task_score": task_score,
                "task_max_score": task_max_score,
                "efficiency_score": efficiency_score,
                "usage_score": usage_score,
                "total_score": total_score,
                "avg_duration": avg_duration,
                "avg_cost": avg_cost,
                "passed_count": passed_count,
                "total_tests": len(results),
                "pass_rate": pass_rate,
                "composite_score": composite_score,
            }

        # Group by test case
        test_cases = {}
        for result in all_results:
            test_id = result.test_case.id
            if test_id not in test_cases:
                test_cases[test_id] = {
                    "test_name": result.test_case.name,
                    "results_by_model": {},
                }
            # Calculate test-level composite score (3:1:1 weighting of passed, efficiency, usage)
            passed_float = 1.0 if result.passed else 0.0
            eff_score = result.efficiency_score or 0.0
            usage_score_val = result.usage_score or 0.0
            test_composite_score = (
                passed_float * 3 + eff_score + usage_score_val
            ) / 5.0

            test_cases[test_id]["results_by_model"][result.model or "unknown"] = {
                "passed": result.passed,
                "task_score": result.score,
                "task_max_score": result.max_score,
                "efficiency_score": result.efficiency_score,
                "usage_score": result.usage_score,
                "total_score": result.total_score,
                "duration": result.duration,
                "cost": result.cost,
                "composite_score": test_composite_score,
            }

        summary = {
            "timestamp": time.time(),
            "browser_uuid": self.chrome_uuid,
            "models_tested": models,
            "model_stats": model_stats,
            "results_by_test": test_cases,
        }

        return summary

    def _generate_cross_model_summary(
        self, all_results: List[TestResult], models: List[str]
    ):
        """Generate cross-model comparison summary report"""
        try:
            # Build summary using helper method
            summary = self._build_summary(all_results, models)
            model_stats = summary.get("model_stats", {})

            # Save to file
            summary_path = self.output_dir / "cross_model_summary.json"
            with open(summary_path, "w") as f:
                json.dump(summary, f, indent=2, default=str)

            logger.info(f"Cross-model summary saved to: {summary_path}")

            # Generate JSON report
            json_path = self._generate_json_report(summary, all_results, models)
            if json_path:
                logger.info(f"JSON report saved to: {json_path}")

            # Print summary table
            print(f"\n{'=' * 90}")
            print("CROSS-MODEL COMPARISON SUMMARY")
            print(f"{'=' * 90}")
            print(
                f"{'Model':30} {'Pass Rate':10} {'Task Score':12} {'Eff Score':10} {'Usage Score':10} {'Avg Time':10} {'Avg Cost':10} {'Composite':10}"
            )
            print(
                f"{'-' * 30} {'-' * 10} {'-' * 12} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10}"
            )

            for model in models:
                if model in model_stats:
                    stats = model_stats[model]
                    print(
                        f"{model:30} {stats['pass_rate']:9.1f}% {stats['task_score']:4.1f}/{stats['task_max_score']:4.1f} "
                        f"{stats['efficiency_score']:9.2f} {stats['usage_score']:9.2f} "
                        f"{stats['avg_duration']:9.1f}s {stats['avg_cost']:9.4f}RMB "
                        f"{stats['composite_score']*100:8.1f}%"
                    )

            print(f"{'=' * 90}")

        except Exception as e:
            logger.error(f"Failed to generate cross-model summary: {e}")

    def _generate_json_report(
        self, summary: Dict[str, Any], all_results: List[TestResult], models: List[str]
    ):
        """Generate a concise JSON evaluation report with timestamp only"""
        try:
            timestamp = summary.get("timestamp", time.time())
            human_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))
            model_stats = summary.get("model_stats", {})
            results_by_test = summary.get("results_by_test", {})

            # Calculate overall statistics
            total_tests = len(all_results)
            passed_tests = sum(1 for r in all_results if r.passed)
            overall_pass_rate = (
                passed_tests / total_tests * 100 if total_tests > 0 else 0
            )

            # Build JSON structure
            report = {
                "evaluation": {
                    "timestamp": human_time,
                    "unix_timestamp": timestamp,
                    "summary": {
                        "total_tests": total_tests,
                        "passed_tests": passed_tests,
                        "pass_rate": round(overall_pass_rate, 2),
                        "models_tested": models,
                    },
                    "model_performance": {},
                    "test_results": {},
                }
            }

            # Add model performance data
            for model in models:
                if model in model_stats:
                    stats = model_stats[model]
                    report["evaluation"]["model_performance"][model] = {
                        "pass_rate": round(stats["pass_rate"], 2),
                        "task_score": round(stats["task_score"], 2),
                        "task_max_score": round(stats["task_max_score"], 2),
                        "efficiency_score": round(stats["efficiency_score"], 4),
                        "usage_score": round(stats["usage_score"], 4),
                        "composite_score": round(stats["composite_score"], 4),
                        "avg_duration": round(stats["avg_duration"], 2),
                        "avg_cost": round(stats["avg_cost"], 6),
                        "passed_count": stats["passed_count"],
                        "total_tests": stats["total_tests"],
                    }

            # Add test results data
            for test_id, test_info in results_by_test.items():
                test_name = test_info.get("test_name", test_id)
                test_result = {"name": test_name, "results_by_model": {}}

                for model in models:
                    if model in test_info.get("results_by_model", {}):
                        result = test_info["results_by_model"][model]
                        test_result["results_by_model"][model] = {
                            "passed": result["passed"],
                            "task_score": round(result["task_score"], 2),
                            "task_max_score": round(result["task_max_score"], 2),
                            "efficiency_score": round(
                                result.get("efficiency_score") or 0, 4
                            ),
                            "usage_score": round(result.get("usage_score") or 0, 4),
                            "composite_score": round(
                                result.get("composite_score") or 0, 4
                            ),
                            "total_score": round(
                                (
                                    result.get("total_score")
                                    if result.get("total_score") is not None
                                    else result["task_score"]
                                ),
                                2,
                            ),
                            "duration": round(result.get("duration") or 0, 2),
                            "cost": (
                                round(result["cost"], 6)
                                if result["cost"] is not None
                                else None
                            ),
                        }

                report["evaluation"]["test_results"][test_id] = test_result

            # Determine output directory
            report_dir = self.output_dir if self.output_dir else OUTPUT_BASE_DIR
            report_path = report_dir / "evaluation_report.json"

            # Write to file
            with open(report_path, "w") as f:
                json.dump(report, f, indent=2, default=str)

            logger.info(f"JSON report saved to: {report_path}")

            # Also create a copy in the eval directory for easy access and version control
            try:
                copy_path = EVAL_DIR / "evaluation_report.json"
                if copy_path.exists():
                    copy_path.unlink()  # Remove if exists (could be symlink or regular file)
                shutil.copy2(report_path, copy_path)
                logger.info(f"Evaluation report copied to: {copy_path}")
            except Exception as e:
                logger.warning(f"Could not copy evaluation report: {e}")

            return report_path

        except Exception as e:
            logger.error(f"Failed to generate JSON report: {e}")
            return None


def _build_llm_targets(model_aliases: List[str]) -> List[LLMTarget]:
    """Build explicit LLM targets from validated alias list."""
    targets: List[LLMTarget] = []
    seen_labels: dict[str, int] = {}

    for alias in model_aliases:
        normalized_alias = alias.strip()
        count = seen_labels.get(normalized_alias, 0) + 1
        seen_labels[normalized_alias] = count
        label = normalized_alias if count == 1 else f"{normalized_alias} #{count}"

        targets.append(
            LLMTarget(
                name=label,
                alias=normalized_alias,
            )
        )

    return targets


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate OpenBrowser agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python eval/evaluate_browser_agent.py --list\n"
            "  python eval/evaluate_browser_agent.py --manual --test techforum\n"
            "  python eval/evaluate_browser_agent.py --test techforum --chrome-uuid YOUR_BROWSER_UUID \\\n"
            "    --model-alias default\n"
            "  OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID python eval/evaluate_browser_agent.py \\\n"
            "    --model-alias plus \\\n"
            "    --model-alias flash"
        ),
    )
    parser.add_argument("--test", help="Run specific test by ID")
    parser.add_argument(
        "--manual",
        action="store_true",
        help="Manual mode: human performs the test steps",
    )
    parser.add_argument("--list", action="store_true", help="List available tests")
    parser.add_argument(
        "--model-alias",
        action="append",
        help="Configured LLM alias to evaluate. Can be passed multiple times.",
    )
    parser.add_argument(
        "--no-services", action="store_true", help="Don't start services"
    )
    parser.add_argument(
        "--keep-alive",
        action="store_true",
        help="Keep services running after evaluation",
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help=(
            "Browser UUID capability token for the Chrome instance to control. "
            "Can also be set via OPENBROWSER_CHROME_UUID."
        ),
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=log_level, format="%(asctime)s - %(levelname)s - %(message)s"
    )

    model_aliases = args.model_alias or []
    llm_targets: List[LLMTarget] = []

    if not args.manual and not args.list:
        if not model_aliases:
            parser.error(
                "Automated evaluation requires at least one configured model alias: "
                "--model-alias"
            )

        llm_targets = _build_llm_targets(model_aliases)
        logger.info(
            f"Model aliases to test: {[target.alias for target in llm_targets]}"
        )

    if not args.manual and not args.list and not args.chrome_uuid:
        parser.error(
            "--chrome-uuid is required for automated browser evaluation "
            "(or set OPENBROWSER_CHROME_UUID)"
        )

    evaluator = Evaluator(chrome_uuid=args.chrome_uuid)

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

    run_lock: Optional[EvaluationRunLock] = None
    if not args.manual and args.chrome_uuid:
        try:
            run_lock = EvaluationRunLock(args.chrome_uuid)
            run_lock.acquire()
        except RuntimeError as e:
            logger.error(str(e))
            sys.exit(1)

    try:
        if args.test:
            # Run single test for all models (or specified models)
            test_cases = evaluator.load_test_cases()
            test_case = next((tc for tc in test_cases if tc.id == args.test), None)
            if not test_case:
                logger.error(f"Test not found: {args.test}")
                return

            if not evaluator.ensure_services(
                skip_services=args.no_services, manual=args.manual
            ):
                logger.error("Services unavailable")
                return

            if not args.manual:
                try:
                    llm_targets = evaluator.resolve_targets(llm_targets)
                except ValueError as e:
                    logger.error(str(e))
                    sys.exit(1)

            # Create output directory for single test
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            evaluator.output_dir = OUTPUT_BASE_DIR / timestamp
            evaluator.output_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Output directory: {evaluator.output_dir}")

            # Manual mode
            if args.manual:
                logger.info(f"Running manual test: {test_case.name}")
                print(f"\n{'=' * 60}")
                print(f"MANUAL MODE ENABLED")
                print(f"Test: {test_case.name}")
                print(f"Model selection ignored (manual human test)")
                print(f"{'=' * 60}")

                result = evaluator.run_manual_test(test_case)
                all_results = [result]

                # Print result for manual test
                print(f"\nTest result for {test_case.name} (manual):")
                print(f"  Status: {'PASS' if result.passed else 'FAIL'}")
                print(f"  Task score: {result.score:.1f}/{result.max_score:.1f}")
                print(f"  Efficiency score: {result.efficiency_score or 0:.2f}/1.0")
                print(f"  Usage score: {result.usage_score or 0:.2f}/1.0 (manual)")
                # Calculate composite score for this test
                passed_float = 1.0 if result.passed else 0.0
                eff_score = result.efficiency_score or 0.0
                usage_score_val = result.usage_score or 0.0
                test_composite = (passed_float * 3 + eff_score + usage_score_val) / 5.0
                print(f"  Composite score: {test_composite:.2f}/1.0")
                print(f"  Total score: {result.total_score or result.score:.1f}")
                print(
                    f"  Duration: {result.duration or 0:.1f}s (limit: {test_case.time_limit}s)"
                )
                print(
                    f"  Cost: {result.cost or 'N/A'} RMB (limit: {test_case.cost_limit}RMB)"
                )
                print(f"  Track events: {len(result.track_events)}")
                if result.track_events_file:
                    print(f"  Track events file: {result.track_events_file}")

            # Normal (automated) mode
            else:
                all_results = []
                target_names = [
                    target.model_name or target.name for target in llm_targets
                ]
                for target in llm_targets:
                    logger.info(f"\n{'=' * 60}")
                    logger.info(
                        f"Testing target alias: {target.alias} -> model: {target.model_name}"
                    )
                    logger.info(f"{'=' * 60}")

                    evaluator.current_target = target
                    evaluator.current_model = target.model_name or target.name

                    result = evaluator.run_test(test_case)
                    result.model = target.model_name or target.name
                    all_results.append(result)

                    print(
                        f"\nTest result for {test_case.name} "
                        f"(alias: {target.alias}, model: {target.model_name}):"
                    )
                    print(f"  Status: {'PASS' if result.passed else 'FAIL'}")
                    print(f"  Task score: {result.score:.1f}/{result.max_score:.1f}")
                    print(f"  Efficiency score: {result.efficiency_score or 0:.2f}/1.0")
                    print(f"  Usage score: {result.usage_score or 0:.2f}/1.0")
                    # Calculate composite score for this test
                    passed_float = 1.0 if result.passed else 0.0
                    eff_score = result.efficiency_score or 0.0
                    usage_score_val = result.usage_score or 0.0
                    test_composite = (
                        passed_float * 3 + eff_score + usage_score_val
                    ) / 5.0
                    print(f"  Composite score: {test_composite:.2f}/1.0")
                    print(f"  Total score: {result.total_score or result.score:.1f}")
                    print(
                        f"  Duration: {result.duration or 0:.1f}s (limit: {test_case.time_limit}s)"
                    )
                    print(
                        f"  Cost: {result.cost or 0:.6f} RMB (limit: {test_case.cost_limit}RMB)"
                    )
                    print(f"  Conversation ID: {result.conversation_id}")
                    print(f"  Track events: {len(result.track_events)}")
                    print(f"  SSE events: {len(result.sse_events)}")
                    print(f"  Images saved: {len(result.images)}")
                    if result.sse_events_file:
                        print(f"  SSE events file: {result.sse_events_file}")
                    if result.track_events_file:
                        print(f"  Track events file: {result.track_events_file}")

                # Generate cross-model summary if we tested multiple models
                if len(llm_targets) > 1 and all_results:
                    evaluator._generate_cross_model_summary(all_results, target_names)

                # Print overall summary
                print(f"\n{'=' * 60}")
                print(f"Overall summary for test '{test_case.name}':")
                for target_name in target_names:
                    model_results = [r for r in all_results if r.model == target_name]
                    if model_results:
                        result = model_results[0]
                        status = "PASS" if result.passed else "FAIL"
                        print(
                            f"  {target_name}: {status} (score: {result.score:.1f}/{result.max_score:.1f})"
                        )

        else:
            # Run all tests for all models (manual mode now supported)
            if args.manual:
                logger.info(f"Running all tests in MANUAL mode")
                print(f"\n{'=' * 60}")
                print(f"ALL TESTS MANUAL MODE")
                print(f"Model selection ignored (manual human test)")
                print(f"{'=' * 60}")

                success = evaluator.run_all_manual(skip_services=args.no_services)
                if not success:
                    sys.exit(1)
            else:
                # Normal automated mode
                try:
                    llm_targets = evaluator.resolve_targets(llm_targets)
                except ValueError as e:
                    logger.error(str(e))
                    sys.exit(1)

                success = evaluator.run_all(
                    targets=llm_targets, skip_services=args.no_services, manual=False
                )
                if not success:
                    sys.exit(1)
    finally:
        if run_lock is not None:
            run_lock.release()


if __name__ == "__main__":
    main()
