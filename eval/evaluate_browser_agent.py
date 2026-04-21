#!/usr/bin/env python3
"""
OpenBrowser Agent Evaluation System

Evaluates AI agents on browser automation tasks using the OpenBrowser server.
Records SSE events (including images) and browser tracking events for analysis.
"""

import argparse
import atexit
import base64
import datetime
import fcntl
import json
import logging
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
import yaml
from requests.exceptions import (
    ChunkedEncodingError,
    ConnectionError as RequestsConnectionError,
    ReadTimeout,
)
from urllib3.exceptions import ProtocolError

logger = logging.getLogger(__name__)

# Configuration
OPENBROWSER_API_URL = "http://localhost:8765"
OPENBROWSER_WS_URL = "ws://localhost:8766"
# Canonical port the YAML test cases reference. Each test now spawns its own
# eval server on an OS-assigned port; URLs in the test case are rewritten to
# point at that per-test port, so this constant is only used for substitution.
EVAL_SERVER_PORT = 16605
EVAL_SERVER_URL = f"http://localhost:{EVAL_SERVER_PORT}"
OPENBROWSER_PORT = 8765
EVAL_SERVER_SCRIPT = Path(__file__).resolve().parent / "server.py"
EVAL_SERVER_BOOT_TIMEOUT = float(
    os.environ.get("OPENBROWSER_EVAL_SERVER_BOOT_TIMEOUT", "10")
)

# SSE streaming timeouts for the agent channel at :8765.
# (connect_timeout, read_timeout) in seconds.
# The read timeout applies per-chunk: we need it longer than the slowest LLM
# turn so a slow turn doesn't abort mid-stream. The test-level wall-clock is
# still enforced by the outer thread-join in send_message.
# Override with OPENBROWSER_SSE_READ_TIMEOUT (seconds).
SSE_CONNECT_TIMEOUT = 30
SSE_READ_TIMEOUT = int(os.environ.get("OPENBROWSER_SSE_READ_TIMEOUT", "600"))

# API-stall detection & retry.  After a test times out, we scan its SSE
# events for observation→action gaps exceeding this threshold.  If found,
# the test is re-queued (up to API_STALL_MAX_RETRIES times).
API_STALL_THRESHOLD = float(os.environ.get("OPENBROWSER_API_STALL_THRESHOLD", "60"))
API_STALL_MAX_RETRIES = int(os.environ.get("OPENBROWSER_API_STALL_MAX_RETRIES", "3"))

# Paths
EVAL_DIR = Path(__file__).parent
DATASET_DIR = EVAL_DIR / "dataset"
OUTPUT_BASE_DIR = EVAL_DIR / "output"
LOCK_DIR = EVAL_DIR / ".locks"

# Ensure base directory exists
OUTPUT_BASE_DIR.mkdir(exist_ok=True)
DATASET_DIR.mkdir(exist_ok=True)
LOCK_DIR.mkdir(exist_ok=True)
DEFAULT_SESSION_DB_PATH = Path.home() / ".openbrowser" / "sessions.db"


def detect_api_stalls(
    sse_events: List[Dict[str, Any]],
    threshold: float = API_STALL_THRESHOLD,
) -> List[float]:
    """Scan SSE events for observation→action gaps that exceed *threshold*.

    Returns a list of gap durations (seconds) where the model API took
    unreasonably long to respond.  An empty list means no stalls detected.

    Also detects the "trailing stall" case: the test timed out while
    waiting for an API response after the last observation, so no
    completed pair exists.  We approximate this by checking if the last
    event is an ObservationEvent and the gap to the final timestamp in
    the stream exceeds the threshold.
    """
    # Build ordered list of (timestamp, kind) for action/observation events.
    pairs: list[tuple[float, str]] = []
    last_ts_overall: float = 0.0
    for ev in sse_events:
        ts = ev.get("timestamp")
        if ts:
            last_ts_overall = max(last_ts_overall, float(ts))
        data = ev.get("data")
        if not isinstance(data, dict):
            continue
        ev_type = data.get("type", "")
        if not ts or ev_type not in ("ActionEvent", "ObservationEvent"):
            continue
        pairs.append((float(ts), ev_type))

    pairs.sort(key=lambda p: p[0])

    stalls: list[float] = []
    for i in range(1, len(pairs)):
        prev_ts, prev_kind = pairs[i - 1]
        curr_ts, curr_kind = pairs[i]
        if prev_kind == "ObservationEvent" and curr_kind == "ActionEvent":
            gap = curr_ts - prev_ts
            if gap >= threshold:
                stalls.append(gap)

    # Trailing stall: last event is an observation and a long time passed
    # before the stream ended (test was killed waiting for model response).
    if pairs and pairs[-1][1] == "ObservationEvent" and last_ts_overall:
        trailing_gap = last_ts_overall - pairs[-1][0]
        if trailing_gap >= threshold:
            stalls.append(trailing_gap)

    return stalls


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
    # Path to a Browser Routine markdown file relative to the repo root.
    # When set, the test runs in routine_replay mode: the conversation is
    # created with mode="routine_replay" and the routine markdown is sent
    # as the message instead of `instruction`. Tracker-based scoring still
    # applies, so the same `criteria` block grades the replayed run.
    routine_file: Optional[str] = None


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


@dataclass(frozen=True)
class ScheduledJob:
    """One scheduled automated evaluation job."""

    target_index: int
    test_index: int
    target: LLMTarget
    test_case: TestCase
    model_key: str
    site_bucket: str


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
        mode: Optional[str] = None,
    ) -> Optional[str]:
        """Create a new conversation and return its ID

        Args:
            model: Optional model name (e.g., "dashscope/qwen3.5-plus")
            base_url: Optional base URL override
            model_alias: Optional configured model alias
            mode: Optional conversation mode tag (e.g., "routine_replay"
                to enable the routine-replay system prompt block).
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
        if mode:
            request_json["mode"] = mode
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

        def _open_stream(sess: requests.Session) -> requests.Response:
            return sess.post(
                f"{self.base_url}/agent/conversations/{conversation_id}/messages",
                json={
                    "text": message,
                    "cwd": cwd,
                    "browser_id": self.chrome_uuid,
                },
                stream=True,
                headers={"Accept": "text/event-stream"},
                # (connect, read). Read timeout gates individual chunks; must be
                # larger than the slowest LLM turn. Outer wall-clock is enforced
                # via thread-join below.
                timeout=(SSE_CONNECT_TIMEOUT, SSE_READ_TIMEOUT),
            )

        def _collect_events() -> None:
            nonlocal error
            response = None
            local_session = requests.Session()
            local_session.trust_env = False
            try:
                try:
                    response = _open_stream(local_session)
                except (RequestsConnectionError, ReadTimeout) as connect_err:
                    # Pre-stream failure (agent server not accepting or slow to
                    # start): one backoff retry before we declare the run dead.
                    logger.warning(
                        "SSE open failed (%s); retrying once after 2s backoff",
                        connect_err,
                    )
                    if response_holder["aborted"]:
                        return
                    time.sleep(2.0)
                    # Outer wall-clock may have fired while we were sleeping.
                    if response_holder["aborted"]:
                        return
                    response = _open_stream(local_session)
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

            except (
                RequestsConnectionError,
                ReadTimeout,
                ChunkedEncodingError,
                ProtocolError,
            ) as e:
                if response_holder["aborted"]:
                    logger.info(
                        "Stopped SSE collection after hitting the test time limit"
                    )
                else:
                    error = (
                        f"SSE transport error on :{OPENBROWSER_PORT} after "
                        f"read_timeout={SSE_READ_TIMEOUT}s: {e}"
                    )
                    logger.error(error)
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

    def get_conversation_events(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Fetch persisted conversation events from the OpenBrowser server."""
        try:
            response = self.session.get(
                f"{self.base_url}/agent/conversations/{conversation_id}/events",
                timeout=5,
            )
            if response.status_code != 200:
                logger.warning(
                    "Failed to fetch conversation events for %s: status=%s body=%s",
                    conversation_id,
                    response.status_code,
                    response.text,
                )
                return []

            data = response.json()
            events = data.get("events", [])
            return events if isinstance(events, list) else []
        except Exception as e:
            logger.warning(
                "Failed to fetch conversation events for %s: %s",
                conversation_id,
                e,
            )
            return []

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
    """Client for one eval server's tracking API.

    Each test spawns its own eval server on a unique port; instantiate one
    client per server and pass the bound port (or full base URL).
    """

    def __init__(
        self,
        port: Optional[int] = None,
        base_url: Optional[str] = None,
    ):
        if base_url is not None:
            self.base_url = base_url
        elif port is not None:
            self.base_url = f"http://localhost:{port}"
        else:
            self.base_url = EVAL_SERVER_URL
        self.session = requests.Session()
        self.session.trust_env = False

    def health_check(self) -> bool:
        """Check if eval server is running"""
        try:
            response = self.session.get(f"{self.base_url}/api/events", timeout=2)
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False

    def get_events(self) -> List[Dict[str, Any]]:
        """Get tracked events from this server.

        Per-test isolation makes the previous ?site= filter unnecessary —
        a dedicated server holds exactly one test's events.
        """
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


class EvalServerProcess:
    """Spawn a single isolated eval server on an OS-assigned port.

    One server per test. The handshake on stdout
    (``EVAL_SERVER_LISTENING_PORT=<n>``) tells us which port the OS picked;
    we then build a per-test client against it. The process group is killed
    on stop() and at interpreter exit so no orphans survive a crash.
    """

    _ALL_INSTANCES: "set[EvalServerProcess]" = set()
    _ATEXIT_REGISTERED = False
    _LOCK = threading.Lock()

    def __init__(self, boot_timeout: float = EVAL_SERVER_BOOT_TIMEOUT):
        self.boot_timeout = boot_timeout
        self.proc: Optional[subprocess.Popen] = None
        self.port: Optional[int] = None
        self._reader: Optional[threading.Thread] = None
        self._stderr_tail: List[str] = []

    @classmethod
    def _ensure_atexit(cls) -> None:
        with cls._LOCK:
            if not cls._ATEXIT_REGISTERED:
                atexit.register(cls._kill_all)
                cls._ATEXIT_REGISTERED = True

    @classmethod
    def _kill_all(cls) -> None:
        with cls._LOCK:
            instances = list(cls._ALL_INSTANCES)
        for inst in instances:
            try:
                inst.stop()
            except Exception:
                pass

    def start(self) -> int:
        """Spawn the server and block until the bound port is reported."""
        if self.proc is not None:
            assert self.port is not None
            return self.port

        env = dict(os.environ)
        # Defensive: prevent inherited PORT env from overriding --port=0.
        env.pop("PORT", None)
        env.pop("MOCK_EVAL_PORT", None)

        cmd = [sys.executable, str(EVAL_SERVER_SCRIPT), "--port=0"]
        # New session so we can SIGTERM the whole process group on stop.
        self.proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            start_new_session=True,
            env=env,
        )
        EvalServerProcess._ensure_atexit()
        with EvalServerProcess._LOCK:
            EvalServerProcess._ALL_INSTANCES.add(self)

        deadline = time.time() + self.boot_timeout
        port: Optional[int] = None
        assert self.proc.stdout is not None
        while time.time() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                if self.proc.poll() is not None:
                    break
                continue
            line = line.strip()
            if line.startswith("EVAL_SERVER_LISTENING_PORT="):
                try:
                    port = int(line.split("=", 1)[1])
                except ValueError:
                    pass
                break

        if port is None:
            stderr_tail = ""
            try:
                if self.proc.stderr is not None:
                    stderr_tail = self.proc.stderr.read() or ""
            except Exception:
                pass
            self.stop()
            raise RuntimeError(
                "eval server did not report a port within "
                f"{self.boot_timeout:.1f}s. stderr: {stderr_tail[:500]}"
            )

        self.port = port
        # Drain remaining stdout/stderr in the background to prevent the
        # child from blocking on a full pipe over a long-running test.
        self._reader = threading.Thread(target=self._drain_streams, daemon=True)
        self._reader.start()
        return port

    def _drain_streams(self) -> None:
        proc = self.proc
        if proc is None:
            return
        try:
            if proc.stdout is not None:
                for _ in iter(proc.stdout.readline, ""):
                    pass
        except Exception:
            pass

    def stop(self) -> None:
        """Terminate the server and its child group."""
        proc = self.proc
        if proc is None:
            return
        try:
            try:
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    pgid = os.getpgid(proc.pid)
                    os.killpg(pgid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    proc.kill()
                proc.wait(timeout=2)
        except Exception:
            pass
        finally:
            self.proc = None
            self.port = None
            with EvalServerProcess._LOCK:
                EvalServerProcess._ALL_INSTANCES.discard(self)

    def __enter__(self) -> "EvalServerProcess":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()


class ServiceManager:
    """Manage the OpenBrowser server process.

    The eval mock-site server is now spawned per-test by EvalServerProcess,
    so this class only owns OpenBrowser lifecycle.
    """

    def __init__(self):
        self.openbrowser_proc = None

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
        self.service_manager = ServiceManager()
        self.results: List[TestResult] = []
        self.output_dir: Optional[Path] = None  # Will be set per run
        self.current_model: Optional[str] = None  # Current model being tested
        self.current_target: Optional[LLMTarget] = None  # Current CLI target

    @staticmethod
    def _rewrite_eval_server_urls(text: str, port: int) -> str:
        """Rewrite localhost:16605 references to the per-test eval-server port."""
        if not text or port == EVAL_SERVER_PORT:
            return text
        return text.replace(
            f"localhost:{EVAL_SERVER_PORT}", f"localhost:{port}"
        ).replace(f"127.0.0.1:{EVAL_SERVER_PORT}", f"127.0.0.1:{port}")

    @staticmethod
    def _sanitize_model_name(model_name: str) -> str:
        """Make a model name safe for filesystem paths."""
        return model_name.replace("/", "_").replace(":", "_")

    @staticmethod
    def _get_model_key(target: LLMTarget) -> str:
        """Return the concurrency key for one target."""
        return target.model_name or target.alias or target.name

    @staticmethod
    def _get_test_site_bucket(test_case: TestCase) -> str:
        """Infer the mock-site bucket from the test start URL."""
        parsed = urlparse(test_case.start_url)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if segments:
            return segments[0]
        return test_case.id

    @staticmethod
    def _usage_event_signature(event: Dict[str, Any]) -> str:
        """Return a stable signature for one usage_metrics event."""
        return json.dumps(event.get("data", {}), sort_keys=True, default=str)

    @staticmethod
    def _usage_event_timestamp(created_at: Optional[str]) -> float:
        """Convert persisted event timestamps to unix seconds."""
        if not created_at:
            return time.time()
        try:
            return datetime.datetime.fromisoformat(created_at).timestamp()
        except ValueError:
            return time.time()

    def _merge_persisted_usage_metrics(
        self,
        sse_events: List[Dict[str, Any]],
        persisted_events: List[Dict[str, Any]],
        source: str,
    ) -> List[Dict[str, Any]]:
        """Inject persisted usage snapshots when the SSE stream missed them."""
        persisted_usage_events = [
            {
                "type": "usage_metrics",
                "data": event.get("event_data", {}),
                "timestamp": self._usage_event_timestamp(event.get("created_at")),
                "recovered_from": source,
                "history_event_index": event.get("event_index"),
            }
            for event in persisted_events
            if event.get("event_type") == "usage_metrics"
            and isinstance(event.get("event_data"), dict)
        ]

        if not persisted_usage_events:
            return list(sse_events)

        local_signatures = {
            self._usage_event_signature(event)
            for event in sse_events
            if event.get("type") == "usage_metrics"
        }
        recovered_events = [
            event
            for event in persisted_usage_events
            if self._usage_event_signature(event) not in local_signatures
        ]

        if not recovered_events:
            return list(sse_events)

        merged_events = list(sse_events)
        complete_index = next(
            (
                index
                for index, event in enumerate(merged_events)
                if event.get("type") == "complete"
            ),
            len(merged_events),
        )
        merged_events[complete_index:complete_index] = recovered_events
        logger.info(
            "Recovered %s usage_metrics event(s) from %s",
            len(recovered_events),
            source,
        )
        return merged_events

    def _recover_usage_metrics_for_run(
        self, conversation_id: str, sse_events: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Backfill usage metrics from persisted conversation history."""
        persisted_events = self.openbrowser.get_conversation_events(conversation_id)
        if not persisted_events:
            return list(sse_events)
        return self._merge_persisted_usage_metrics(
            sse_events,
            persisted_events,
            source="conversation_events",
        )

    def _ensure_model_output_dir(self, model_name: Optional[str]) -> Path:
        """Ensure the per-model output directory exists."""
        if self.output_dir is None:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            self.output_dir = OUTPUT_BASE_DIR / timestamp
            self.output_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created base output directory: {self.output_dir}")

        if not model_name:
            return self.output_dir

        model_output_dir = self.output_dir / self._sanitize_model_name(model_name)
        model_output_dir.mkdir(exist_ok=True)
        return model_output_dir

    def _build_error_result(
        self, test_case: TestCase, model_name: Optional[str], error: str
    ) -> TestResult:
        """Build a failed test result for scheduler/runtime errors."""
        max_score = sum(criterion.get("points", 1) for criterion in test_case.criteria)
        return TestResult(
            test_case=test_case,
            passed=False,
            score=0,
            max_score=max_score,
            events=[],
            sse_events=[],
            track_events=[],
            images=[],
            error=error,
            duration=0.0,
            cost=0.0,
            efficiency_score=0.0,
            usage_score=0.0,
            total_score=0.0,
            model=model_name,
        )

    def _create_worker_evaluator(self) -> "Evaluator":
        """Create a short-lived evaluator with independent HTTP sessions."""
        worker = Evaluator(chrome_uuid=self.chrome_uuid)
        worker.output_dir = self.output_dir
        return worker

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
        """Ensure required services are running, or skip check if requested.

        The mock-site eval server is now spawned per test (see
        EvalServerProcess), so we no longer health-check a global one. Only
        OpenBrowser must be reachable up front.

        Args:
            skip_services: If True, skip all service checks
            manual: If True, skip OpenBrowser check (manual mode doesn't drive it)
        """
        if skip_services:
            logger.info("Skipping service checks (--no-services flag used)")
            return True

        logger.info("Checking services...")

        if not manual:
            if not self.openbrowser.health_check():
                if not self.service_manager.start_openbrowser():
                    logger.error("OpenBrowser server check failed")
                    return False
            logger.info("All services are running ✓")
        else:
            logger.info("Manual mode: per-test eval servers will be spawned on demand")

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
                    routine_file=data.get("routine_file"),
                )
                test_cases.append(test_case)
                logger.info(f"Loaded test case: {test_case.name}")

            except Exception as e:
                logger.error(f"Failed to load test case from {yaml_file}: {e}")

        return test_cases

    def run_test(
        self,
        test_case: TestCase,
        target: Optional[LLMTarget] = None,
        model_name: Optional[str] = None,
    ) -> TestResult:
        """Run a single test case"""
        active_target = target or self.current_target
        active_model_name = model_name or self.current_model
        site_bucket = self._get_test_site_bucket(test_case)

        logger.info(
            "Running test: %s [model=%s site=%s]",
            test_case.name,
            active_model_name,
            site_bucket,
        )

        model_output_dir = self._ensure_model_output_dir(active_model_name)

        # Resolve a routine_file path (if set) up front so we fail fast on a
        # missing file instead of burning a conversation slot. Routine paths
        # in test YAMLs are interpreted relative to the repo root.
        routine_markdown: Optional[str] = None
        if test_case.routine_file:
            routine_path = Path(test_case.routine_file)
            if not routine_path.is_absolute():
                routine_path = EVAL_DIR.parent / routine_path
            try:
                routine_markdown = routine_path.read_text(encoding="utf-8")
            except FileNotFoundError:
                return self._build_error_result(
                    test_case,
                    active_model_name,
                    f"Routine file not found: {routine_path}",
                )
            if not routine_markdown.strip():
                return self._build_error_result(
                    test_case,
                    active_model_name,
                    f"Routine file is empty: {routine_path}",
                )

        # Per-test isolation: spawn a dedicated mock-site server on an
        # OS-assigned port, then rewrite the YAML's localhost:16605 references
        # to that port. Each conversation has its own events_store, so the
        # ?site= filter and "clear before run" dance are no longer needed.
        try:
            eval_server_proc = EvalServerProcess()
            eval_port = eval_server_proc.start()
        except Exception as exc:
            logger.error("Failed to start per-test eval server: %s", exc)
            return self._build_error_result(
                test_case,
                active_model_name,
                f"Failed to start per-test eval server: {exc}",
            )

        eval_server = EvalServerClient(port=eval_port)
        rewritten_start_url = self._rewrite_eval_server_urls(
            test_case.start_url, eval_port
        )
        rewritten_instruction = self._rewrite_eval_server_urls(
            test_case.instruction, eval_port
        )

        # Create new conversation with current model. When replaying a
        # routine, tag the conversation with mode="routine_replay" so the
        # agent picks up the replay system-prompt block and the Keywords
        # unlock for small models.
        conversation_id = self.openbrowser.create_conversation(
            model_alias=active_target.alias if active_target else None,
            mode="routine_replay" if routine_markdown is not None else None,
        )
        if conversation_id:
            logger.debug(f"Created conversation: {conversation_id}")
        else:
            logger.warning(
                f"Failed to create conversation for model {active_model_name}"
            )
            eval_server_proc.stop()
            return self._build_error_result(
                test_case,
                active_model_name,
                (
                    f"Failed to create conversation for target {active_model_name}. "
                    "See logs for server response details."
                ),
            )

        start_time = time.time()
        deadline = start_time + test_case.time_limit
        sse_events: List[Dict[str, Any]] = []
        track_events: List[Dict[str, Any]] = []
        timed_out = False
        error: Optional[str] = None

        try:
            # Initialize with start URL if provided
            if rewritten_start_url:
                init_message = f"Open {rewritten_start_url}"
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

            # Send the main instruction with the remaining test budget. In
            # routine-replay mode the routine markdown IS the instruction —
            # the agent treats it as ground truth per the ROUTINE_REPLAY
            # system-prompt block.
            if not timed_out:
                if routine_markdown is not None:
                    message_text = self._rewrite_eval_server_urls(
                        routine_markdown, eval_port
                    )
                else:
                    message_text = rewritten_instruction
                instruction_result = self.openbrowser.send_message(
                    conversation_id,
                    message_text,
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

            # Get tracking events from this conversation's dedicated server.
            track_events = eval_server.get_events()

            # Save track events to file
            track_events_file = self._save_track_events(
                track_events, test_case.id, conversation_id, model_output_dir
            )

            # Extract and save images from SSE events
            images = self._extract_images(
                sse_events, test_case.id, conversation_id, model_output_dir
            )

            # The live SSE stream can end right after `complete` and miss the
            # persisted usage_metrics snapshots. Recover them before saving
            # artifacts or computing costs.
            sse_events = self._recover_usage_metrics_for_run(
                conversation_id, sse_events
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
                model=active_model_name,
            )
        finally:
            self._cleanup_openbrowser_conversation(conversation_id)
            eval_server_proc.stop()

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
                    # DashScope reports cost in RMB. Other providers still use the
                    # historical USD->RMB conversion in this evaluator.
                    model_name = metrics.get("model_name", "")
                    token_usage = metrics.get("accumulated_token_usage", {})
                    model_name_from_token = token_usage.get("model", "")

                    logger.debug(
                        f"Model name from metrics: '{model_name}', from token usage: '{model_name_from_token}'"
                    )

                    is_dashscope = model_name.startswith(
                        "dashscope/"
                    ) or model_name_from_token.startswith("dashscope/")

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
            alternatives = criterion.get("alternatives", [])
            optional = criterion.get("optional", False)

            # For optional criteria, we give the points automatically (treat as satisfied)
            if optional:
                score += points
                logger.debug(
                    f"Optional criterion '{criterion_type}' satisfied: +{points} points"
                )
                continue

            candidate_expectations = [expected]
            if alternative:
                candidate_expectations.append(alternative)
            if alternatives:
                candidate_expectations.extend(alternatives)

            if any(
                candidate and self._check_criterion(candidate, track_events, sse_events)
                for candidate in candidate_expectations
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

        logger.debug("Criterion not met")
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

        def normalize_text(value: Any) -> str:
            return str(value or "").casefold()

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
        if expected_element_href:
            element_href = event.get("elementHref")
            if not element_href or expected_element_href not in element_href:
                return False

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
            value = normalize_text(event.get("value") or event.get("inputValue"))
            if not value or normalize_text(expected_value_contains) not in value:
                return False

        expected_value_contains_any = expected.get("value_contains_any")
        if expected_value_contains_any:
            # For input events, value may be in data
            value = normalize_text(event.get("value") or event.get("inputValue"))
            if not value:
                return False
            # Check if value contains any of the specified strings
            if isinstance(expected_value_contains_any, list):
                if not any(
                    normalize_text(keyword) in value
                    for keyword in expected_value_contains_any
                ):
                    return False
            else:
                # If it's a single string, check containment
                if normalize_text(expected_value_contains_any) not in value:
                    return False

        expected_value_length_min = expected.get("value_length_min")
        if expected_value_length_min is not None:
            value_length = event.get("valueLength")
            if value_length is None or value_length < expected_value_length_min:
                return False

        # Additional custom checks
        expected_check = expected.get("check")
        if expected_check == "upvote_count_changed":
            if event.get("eventType") == "upvote_toggle":
                if event.get("voted") is not True:
                    return False
            else:
                previous_count = (
                    event.get("previousCount")
                    or event.get("oldCount")
                    or event.get("beforeCount")
                )
                new_count = (
                    event.get("upvoteCount")
                    or event.get("count")
                    or event.get("newCount")
                    or event.get("afterCount")
                )
                if previous_count is None or new_count is None:
                    return False
                try:
                    if int(new_count) <= int(previous_count):
                        return False
                except (TypeError, ValueError):
                    return False

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
        payload = event.get("data")
        normalized_event = payload.copy() if isinstance(payload, dict) else {}
        normalized_event["eventType"] = event.get("type")
        normalized_event.setdefault("timestamp", event.get("timestamp"))
        return self._event_matches_expected(normalized_event, expected)

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

        # Spawn a dedicated eval server for this manual run.
        eval_server_proc = EvalServerProcess()
        try:
            eval_port = eval_server_proc.start()
        except Exception as exc:
            logger.error("Failed to start per-test eval server: %s", exc)
            return self._build_error_result(
                test_case, "manual", f"Failed to start eval server: {exc}"
            )

        eval_server = EvalServerClient(port=eval_port)
        rewritten_start_url = self._rewrite_eval_server_urls(
            test_case.start_url, eval_port
        )
        rewritten_instruction = self._rewrite_eval_server_urls(
            test_case.instruction, eval_port
        )

        try:
            # Print test information
            print("\n" + "=" * 60)
            print(f"MANUAL TEST: {test_case.name}")
            print(f"Start URL: {rewritten_start_url}")
            print("=" * 60)

            if rewritten_start_url:
                print("\n📋 Please open your browser and navigate to:")
                print(f"   {rewritten_start_url}")
                print(f"This run's eval server is on port {eval_port}.")
                print("The browser should load the test page.")
                input("\nPress Enter when ready to continue...")

            # Show the SAME instruction that would be given to OpenBrowser
            print("\n📝 Task Instruction (same as given to OpenBrowser):")
            print(f"   {rewritten_instruction}")
            print(
                "\nPerform this task in the browser. Events will be tracked from this moment."
            )
            print("Complete the task using the website's own controls.")
            print("After you finish in the browser, return here and enter 'ok' below.")

            # Start timing when instruction is shown (same as automated test)
            start_time = time.time()

            # Wait for user to complete the entire task
            while True:
                response = (
                    input("\nAfter finishing in the browser, enter 'ok' here > ")
                    .strip()
                    .lower()
                )
                if response == "ok":
                    break
                else:
                    print("Please finish the browser task first, then enter 'ok' here.")

            end_time = time.time()
            duration = end_time - start_time

            # Wait a moment for any pending events to be tracked
            time.sleep(2)

            # Get tracking events from this manual run's dedicated server.
            track_events = eval_server.get_events()

            # Save track events to file (no conversation_id for manual mode, use "manual")
            track_events_file = self._save_track_events(
                track_events, test_case.id, "manual", self.output_dir
            )

            # Evaluate against criteria (no SSE events in manual mode)
            passed, score, max_score = self._evaluate_criteria(
                test_case, track_events, []
            )

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
            print("Manual test completed!")
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
        finally:
            eval_server_proc.stop()

    def _build_scheduled_jobs(
        self, test_cases: List[TestCase], targets: List[LLMTarget]
    ) -> Dict[int, List[ScheduledJob]]:
        """Build the full job matrix for automated evaluation."""
        jobs_by_target: Dict[int, List[ScheduledJob]] = {}
        for target_index, target in enumerate(targets):
            model_key = self._get_model_key(target)
            jobs_by_target[target_index] = [
                ScheduledJob(
                    target_index=target_index,
                    test_index=test_index,
                    target=target,
                    test_case=test_case,
                    model_key=model_key,
                    site_bucket=self._get_test_site_bucket(test_case),
                )
                for test_index, test_case in enumerate(test_cases)
            ]
        return jobs_by_target

    def _execute_scheduled_job(self, job: ScheduledJob) -> TestResult:
        """Run one scheduled job in an isolated worker evaluator."""
        worker = self._create_worker_evaluator()
        try:
            return worker.run_test(
                job.test_case,
                target=job.target,
                model_name=job.model_key,
            )
        except Exception as e:
            logger.exception(
                "Scheduled job failed: model=%s test=%s site=%s",
                job.model_key,
                job.test_case.id,
                job.site_bucket,
            )
            return self._build_error_result(
                job.test_case,
                job.model_key,
                f"Unhandled scheduler worker error: {e}",
            )

    def _run_scheduled_jobs(
        self,
        test_cases: List[TestCase],
        targets: List[LLMTarget],
        parallel: int,
        single_model_parallel: int,
    ) -> Dict[int, List[TestResult]]:
        """Run scheduled jobs with global and per-model concurrency limits."""
        max_parallel = max(1, parallel)
        per_model_limit = max(1, single_model_parallel)
        jobs_by_target = self._build_scheduled_jobs(test_cases, targets)
        results_by_target: Dict[int, List[Optional[TestResult]]] = {
            target_index: [None] * len(test_cases)
            for target_index in range(len(targets))
        }

        logger.info(
            "Scheduler limits: parallel=%s, single_model_parallel=%s",
            max_parallel,
            per_model_limit,
        )

        running_by_model: Dict[str, int] = {}
        busy_sites: set[str] = set()
        in_flight: Dict[Any, ScheduledJob] = {}
        target_order = list(range(len(targets)))
        # Track retries per (target_index, test_index) for API-stall detection.
        retry_counts: Dict[Tuple[int, int], int] = {}

        with ThreadPoolExecutor(max_workers=max_parallel) as executor:
            while True:
                pending_jobs = any(jobs for jobs in jobs_by_target.values())

                while len(in_flight) < max_parallel:
                    scheduled_job: Optional[ScheduledJob] = None

                    for target_index in target_order:
                        pending_for_target = jobs_by_target[target_index]
                        if not pending_for_target:
                            continue

                        model_key = pending_for_target[0].model_key
                        if running_by_model.get(model_key, 0) >= per_model_limit:
                            continue

                        for job_index, job in enumerate(pending_for_target):
                            if job.site_bucket in busy_sites:
                                continue
                            scheduled_job = pending_for_target.pop(job_index)
                            break

                        if scheduled_job is not None:
                            break

                    if scheduled_job is None:
                        break

                    future = executor.submit(self._execute_scheduled_job, scheduled_job)
                    in_flight[future] = scheduled_job
                    running_by_model[scheduled_job.model_key] = (
                        running_by_model.get(scheduled_job.model_key, 0) + 1
                    )
                    busy_sites.add(scheduled_job.site_bucket)

                    logger.info(
                        "Scheduled test '%s' for model '%s' on site '%s'",
                        scheduled_job.test_case.id,
                        scheduled_job.model_key,
                        scheduled_job.site_bucket,
                    )

                # Re-check pending after processing completions (retries
                # may have re-queued jobs).
                pending_jobs = any(jobs for jobs in jobs_by_target.values())

                if not in_flight and not pending_jobs:
                    break

                if not in_flight:
                    logger.warning("Pending jobs remain but none could be scheduled")
                    break

                done, _ = wait(set(in_flight.keys()), return_when=FIRST_COMPLETED)
                for future in done:
                    job = in_flight.pop(future)
                    running_by_model[job.model_key] -= 1
                    if running_by_model[job.model_key] <= 0:
                        del running_by_model[job.model_key]
                    busy_sites.discard(job.site_bucket)

                    result = future.result()

                    status = "PASSED" if result.passed else "FAILED"

                    # --- API-stall retry logic ---
                    # If the test timed out, check whether Dashscope API
                    # stalls (observation→action gaps > threshold) caused it.
                    # If so, re-queue for another attempt.
                    job_key = (job.target_index, job.test_index)
                    retries_so_far = retry_counts.get(job_key, 0)
                    should_retry = False

                    timed_out = (
                        result.duration is not None
                        and result.duration >= job.test_case.time_limit
                    )
                    if timed_out and retries_so_far < API_STALL_MAX_RETRIES:
                        stalls = detect_api_stalls(
                            result.sse_events,
                            threshold=API_STALL_THRESHOLD,
                        )
                        if stalls:
                            should_retry = True
                            retry_counts[job_key] = retries_so_far + 1
                            stall_summary = ", ".join(
                                f"{s:.0f}s" for s in sorted(stalls, reverse=True)[:3]
                            )
                            logger.info(
                                "API stall detected in '%s' for '%s' "
                                "(stalls: %s). Retry %d/%d.",
                                job.test_case.name,
                                job.model_key,
                                stall_summary,
                                retries_so_far + 1,
                                API_STALL_MAX_RETRIES,
                            )
                            # Re-queue at the front of the target's pending
                            # list so it runs again soon.
                            jobs_by_target[job.target_index].insert(0, job)

                    if not should_retry:
                        results_by_target[job.target_index][job.test_index] = result

                    logger.info(
                        "Completed test '%s' for model '%s': %s %.1f/%.1f%s",
                        job.test_case.name,
                        job.model_key,
                        status,
                        result.score,
                        result.max_score,
                        (
                            f" [retrying due to API stall, attempt {retries_so_far + 1}]"
                            if should_retry
                            else ""
                        ),
                    )

        return {
            target_index: [result for result in target_results if result is not None]
            for target_index, target_results in results_by_target.items()
        }

    def run_all(
        self,
        targets: Optional[List[LLMTarget]] = None,
        skip_services: bool = False,
        manual: bool = False,
        parallel: int = 1,
        single_model_parallel: int = 1,
    ):
        """Run all test cases for specified LLM targets."""
        if not self.ensure_services(skip_services=skip_services, manual=manual):
            logger.error("Cannot run tests: services unavailable")
            return False

        if targets is None or len(targets) == 0:
            logger.error("No model aliases provided")
            return False

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        self.output_dir = OUTPUT_BASE_DIR / timestamp
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Base output directory: {self.output_dir}")

        test_cases = self.load_test_cases()
        if not test_cases:
            logger.warning("No test cases found")
            return False

        scheduled_results = self._run_scheduled_jobs(
            test_cases=test_cases,
            targets=targets,
            parallel=parallel,
            single_model_parallel=single_model_parallel,
        )

        all_results: List[TestResult] = []
        target_names = [self._get_model_key(target) for target in targets]

        for target_index, target in enumerate(targets):
            logger.info(f"\n{'=' * 60}")
            logger.info(
                "Finished target alias: %s -> model: %s",
                target.alias,
                target.model_name,
            )
            logger.info(f"{'=' * 60}")

            self.results = scheduled_results.get(target_index, [])
            if self.results:
                model_report_path = self.generate_report()
                logger.info(f"Model report saved to: {model_report_path}")
                all_results.extend(self.results)

        if len(targets) > 1 and all_results:
            self._generate_cross_model_summary(all_results, target_names)

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
        print("MANUAL ALL-TESTS MODE")
        print(f"Found {len(test_cases)} test cases to complete")
        print("Each test will start when you confirm ready after seeing start URL")
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
            print("MANUAL TESTING COMPLETE")
            print(f"{'=' * 60}")
            print(f"Total tests: {total_tests}")
            print(f"Passed tests: {passed_tests} ({pass_rate:.1f}%)")
            print(f"Total task score: {total_task_score:.1f}/{total_max_score:.1f}")
            print(f"Average efficiency score: {avg_efficiency_score:.2f}/1.0")
            print(f"Average duration: {avg_duration:.1f}s per test")
            print(f"\nDetailed results saved to: {summary_path}")
            print(f"{'=' * 60}")

            # Print per-test summary table
            print("\nTest Results Summary:")
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

    def repair_output_usage_from_db(
        self,
        output_dir: Path,
        db_path: Path = DEFAULT_SESSION_DB_PATH,
    ) -> bool:
        """Backfill usage_metrics into a saved evaluation output directory."""
        output_dir = output_dir.expanduser().resolve()
        db_path = db_path.expanduser().resolve()

        if not output_dir.exists():
            logger.error("Output directory not found: %s", output_dir)
            return False
        if not db_path.exists():
            logger.error("Session database not found: %s", db_path)
            return False

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        def fetch_usage_rows(conversation_id: str) -> List[Dict[str, Any]]:
            rows = conn.execute(
                """
                SELECT event_index, event_data, created_at
                FROM session_events
                WHERE conversation_id = ? AND event_type = 'usage_metrics'
                ORDER BY event_index
                """,
                (conversation_id,),
            ).fetchall()
            parsed_rows: List[Dict[str, Any]] = []
            for row in rows:
                try:
                    event_data = json.loads(row["event_data"])
                except json.JSONDecodeError:
                    continue
                parsed_rows.append(
                    {
                        "event_type": "usage_metrics",
                        "event_data": event_data,
                        "event_index": row["event_index"],
                        "created_at": row["created_at"],
                    }
                )
            return parsed_rows

        recovered_costs: Dict[str, float] = {}
        artifact_rows: List[Tuple[str, str, str, Path, Path]] = []
        patched_event_files = 0

        for event_path in sorted(output_dir.glob("dashscope_*/events/*_events.json")):
            if event_path.name.endswith("_track_events.json"):
                continue

            test_id, conversation_id = event_path.stem.removesuffix("_events").rsplit(
                "_", 1
            )
            persisted_usage = fetch_usage_rows(conversation_id)
            if not persisted_usage:
                continue

            events = json.loads(event_path.read_text())
            merged_events = self._merge_persisted_usage_metrics(
                events,
                persisted_usage,
                source="sessions.db",
            )
            if merged_events != events:
                event_path.write_text(json.dumps(merged_events, indent=2, default=str))
                patched_event_files += 1

            latest_metrics = persisted_usage[-1]["event_data"].get("metrics", {})
            latest_cost = latest_metrics.get("accumulated_cost")
            latest_model = latest_metrics.get("model_name") or (
                latest_metrics.get("accumulated_token_usage", {}) or {}
            ).get("model")
            if latest_cost is not None:
                recovered_costs[conversation_id] = float(latest_cost)
            if isinstance(latest_model, str) and latest_model:
                artifact_rows.append(
                    (
                        test_id,
                        conversation_id,
                        latest_model,
                        event_path,
                        event_path.with_name(
                            f"{test_id}_{conversation_id}_track_events.json"
                        ),
                    )
                )

        test_cases_by_id = {
            test_case.id: test_case for test_case in self.load_test_cases()
        }
        rebuilt_results: List[TestResult] = []

        for test_id, conversation_id, model, sse_path, track_path in artifact_rows:
            test_case = test_cases_by_id.get(test_id)
            if test_case is None:
                logger.warning("Skipping unknown test id from artifacts: %s", test_id)
                continue

            try:
                sse_events = json.loads(sse_path.read_text())
            except json.JSONDecodeError:
                logger.warning("Skipping malformed SSE event file: %s", sse_path)
                continue

            track_events: List[Dict[str, Any]] = []
            if track_path.exists():
                try:
                    track_events = json.loads(track_path.read_text())
                except json.JSONDecodeError:
                    logger.warning("Malformed track event file: %s", track_path)

            passed, score, max_score = self._evaluate_criteria(
                test_case, track_events, sse_events
            )
            timestamps = [
                float(timestamp)
                for timestamp in (event.get("timestamp") for event in sse_events)
                if isinstance(timestamp, (int, float))
            ]
            duration = (
                max(timestamps) - min(timestamps) if len(timestamps) >= 2 else 0.0
            )
            cost = recovered_costs.get(conversation_id)
            efficiency_score = self._calculate_efficiency_score(
                duration, test_case.time_limit
            )
            usage_score = self._calculate_usage_score(cost, test_case.cost_limit)
            error_event = next(
                (
                    event
                    for event in reversed(sse_events)
                    if event.get("type") == "error"
                ),
                None,
            )
            images = list(
                (output_dir / self._sanitize_model_name(model) / "images").glob(
                    f"{test_id}_{conversation_id}_*.png"
                )
            )

            rebuilt_results.append(
                TestResult(
                    test_case=test_case,
                    passed=passed,
                    score=score,
                    max_score=max_score,
                    events=[],
                    sse_events=sse_events,
                    track_events=track_events,
                    images=[str(path) for path in images],
                    error=(
                        (error_event.get("data") or {}).get("error")
                        if isinstance(error_event, dict)
                        else None
                    ),
                    conversation_id=conversation_id,
                    duration=duration,
                    cost=cost,
                    efficiency_score=efficiency_score,
                    usage_score=usage_score,
                    total_score=score + efficiency_score + usage_score,
                    sse_events_file=str(sse_path),
                    track_events_file=str(track_path) if track_path.exists() else None,
                    model=model,
                )
            )

        if not rebuilt_results:
            logger.error("No results rebuilt from saved artifacts in %s", output_dir)
            conn.close()
            return False

        models = list(
            dict.fromkeys(
                rebuilt_result.model or "unknown" for rebuilt_result in rebuilt_results
            )
        )

        report_files = sorted(output_dir.glob("evaluation_report_*.json"))
        report_path = (
            report_files[-1]
            if report_files
            else output_dir / f"evaluation_report_{time.strftime('%Y%m%d_%H%M%S')}.json"
        )
        total_task_score = sum(result.score for result in rebuilt_results)
        total_task_max_score = sum(result.max_score for result in rebuilt_results)
        total_efficiency_score = sum(
            result.efficiency_score or 0 for result in rebuilt_results
        )
        total_usage_score = sum(result.usage_score or 0 for result in rebuilt_results)
        total_combined_score = sum(
            result.total_score or result.score for result in rebuilt_results
        )
        total_combined_max_score = total_task_max_score + len(rebuilt_results) * 2

        report = {
            "timestamp": time.time(),
            "browser_uuid": self.chrome_uuid,
            "total_tests": len(rebuilt_results),
            "passed_tests": sum(1 for result in rebuilt_results if result.passed),
            "total_task_score": total_task_score,
            "total_task_max_score": total_task_max_score,
            "total_efficiency_score": total_efficiency_score,
            "total_usage_score": total_usage_score,
            "total_combined_score": total_combined_score,
            "total_combined_max_score": total_combined_max_score,
            "average_duration": (
                sum(result.duration or 0 for result in rebuilt_results)
                / len(rebuilt_results)
            ),
            "average_cost": (
                sum(result.cost or 0 for result in rebuilt_results)
                / len(rebuilt_results)
            ),
            "results": [
                {
                    "test_id": result.test_case.id,
                    "test_name": result.test_case.name,
                    "passed": result.passed,
                    "task_score": result.score,
                    "task_max_score": result.max_score,
                    "efficiency_score": result.efficiency_score,
                    "usage_score": result.usage_score,
                    "total_score": result.total_score,
                    "duration": result.duration,
                    "cost": result.cost,
                    "conversation_id": result.conversation_id,
                    "error": result.error,
                    "image_count": 0,
                    "track_event_count": 0,
                    "sse_event_count": 0,
                    "sse_events_file": result.sse_events_file,
                    "track_events_file": result.track_events_file,
                    "model": result.model,
                }
                for result in rebuilt_results
            ],
        }
        report_path.write_text(json.dumps(report, indent=2, default=str))

        self.output_dir = output_dir
        summary = self._build_summary(rebuilt_results, models)
        (output_dir / "cross_model_summary.json").write_text(
            json.dumps(summary, indent=2, default=str)
        )
        self._generate_json_report(summary, rebuilt_results, models)

        conn.close()
        logger.info(
            "Repaired %s event file(s) and refreshed reports in %s",
            patched_event_files,
            output_dir,
        )
        return True


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
        "--repair-output",
        help="Repair one saved evaluation output directory using persisted usage data.",
    )
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
        "--parallel",
        type=int,
        default=1,
        help="Maximum number of automated test jobs running at once.",
    )
    parser.add_argument(
        "--single-model-parallel",
        type=int,
        default=1,
        help="Maximum concurrent test jobs allowed for the same resolved model.",
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
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_SESSION_DB_PATH),
        help="SQLite session database used when repairing saved outputs.",
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

    if not args.manual and not args.list and not args.repair_output:
        if not model_aliases:
            parser.error(
                "Automated evaluation requires at least one configured model alias: "
                "--model-alias"
            )

        llm_targets = _build_llm_targets(model_aliases)
        logger.info(
            f"Model aliases to test: {[target.alias for target in llm_targets]}"
        )

    if (
        not args.manual
        and not args.list
        and not args.repair_output
        and not args.chrome_uuid
    ):
        parser.error(
            "--chrome-uuid is required for automated browser evaluation "
            "(or set OPENBROWSER_CHROME_UUID)"
        )

    if args.parallel < 1:
        parser.error("--parallel must be >= 1")

    if args.single_model_parallel < 1:
        parser.error("--single-model-parallel must be >= 1")

    evaluator = Evaluator(chrome_uuid=args.chrome_uuid)

    if args.repair_output:
        success = evaluator.repair_output_usage_from_db(
            Path(args.repair_output),
            Path(args.db_path),
        )
        if not success:
            sys.exit(1)
        return

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
                print("MANUAL MODE ENABLED")
                print(f"Test: {test_case.name}")
                print("Model selection ignored (manual human test)")
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
                scheduled_results = evaluator._run_scheduled_jobs(
                    test_cases=[test_case],
                    targets=llm_targets,
                    parallel=args.parallel,
                    single_model_parallel=args.single_model_parallel,
                )
                target_names = [
                    evaluator._get_model_key(target) for target in llm_targets
                ]

                for target_index, target in enumerate(llm_targets):
                    target_results = scheduled_results.get(target_index, [])
                    if not target_results:
                        continue

                    result = target_results[0]
                    all_results.append(result)

                    print(
                        f"\nTest result for {test_case.name} "
                        f"(alias: {target.alias}, model: {target.model_name}):"
                    )
                    print(f"  Status: {'PASS' if result.passed else 'FAIL'}")
                    print(f"  Task score: {result.score:.1f}/{result.max_score:.1f}")
                    print(f"  Efficiency score: {result.efficiency_score or 0:.2f}/1.0")
                    print(f"  Usage score: {result.usage_score or 0:.2f}/1.0")
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
                logger.info("Running all tests in MANUAL mode")
                print(f"\n{'=' * 60}")
                print("ALL TESTS MANUAL MODE")
                print("Model selection ignored (manual human test)")
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
                    targets=llm_targets,
                    skip_services=args.no_services,
                    manual=False,
                    parallel=args.parallel,
                    single_model_parallel=args.single_model_parallel,
                )
                if not success:
                    sys.exit(1)
    finally:
        if run_lock is not None:
            run_lock.release()


if __name__ == "__main__":
    main()
