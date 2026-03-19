"""
Unit tests for BrowserExecutor 2PC state machine.
"""

import threading
import time
from multiprocessing import Queue

import pytest

from server.core.browser_executor import (
    BrowserExecutor,
    ExecutorState,
    DEFAULT_TIMEOUT,
)
from server.core.ipc_types import BrowserResponseMessage


class TestBrowserExecutorStateTransitions:
    """Tests for 2PC state machine transitions."""

    def test_initial_state_is_idle(self):
        """Executor starts in IDLE state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-1",
            browser_id="test-browser-1",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        assert executor.get_state() == "idle"

    def test_prepare_transitions_to_prepared_on_success(self):
        """Successful prepare transitions: IDLE → PREPARING → PREPARED."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-2",
            browser_id="test-browser-2",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        # Thread to simulate browser process responding
        def respond_success():
            # Wait for prepare request
            msg = command_queue.get(timeout=5.0)
            # Send success response
            response = BrowserResponseMessage(
                conversation_id="test-conv-2",
                browser_id="test-browser-2",
                success=True,
                command_id=msg.get("command_id"),
            )
            response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_success)
        thread.start()

        # Execute prepare
        result = executor.prepare({"type": "screenshot"})

        thread.join(timeout=5.0)

        assert result is True
        assert executor.get_state() == "prepared"

    def test_prepare_transitions_to_aborted_on_failure(self):
        """Failed prepare transitions: IDLE → PREPARING → ABORTED."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-3",
            browser_id="test-browser-3",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond_failure():
            msg = command_queue.get(timeout=5.0)
            response = BrowserResponseMessage(
                conversation_id="test-conv-3",
                browser_id="test-browser-3",
                success=False,
                error="Browser not ready",
                command_id=msg.get("command_id"),
            )
            response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_failure)
        thread.start()

        result = executor.prepare({"type": "screenshot"})

        thread.join(timeout=5.0)

        assert result is False
        assert executor.get_state() == "aborted"

    def test_commit_transitions_to_committed_on_success(self):
        """Successful commit flow: PREPARED → COMMITTING → COMMITTED."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-4",
            browser_id="test-browser-4",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        response_count = [0]

        def respond_to_all():
            # Respond to prepare
            msg1 = command_queue.get(timeout=5.0)
            response_count[0] += 1
            response1 = BrowserResponseMessage(
                conversation_id="test-conv-4",
                browser_id="test-browser-4",
                success=True,
                command_id=msg1.get("command_id"),
            )
            response_queue.put(response1.to_dict())

            # Respond to commit
            msg2 = command_queue.get(timeout=5.0)
            response_count[0] += 1
            response2 = BrowserResponseMessage(
                conversation_id="test-conv-4",
                browser_id="test-browser-4",
                success=True,
                result={"status": "ok"},
                command_id=msg2.get("command_id"),
            )
            response_queue.put(response2.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        # Execute full 2PC flow
        prepare_result = executor.prepare({"type": "screenshot"})
        commit_result = executor.commit()

        thread.join(timeout=5.0)

        assert prepare_result is True
        assert commit_result is True
        assert executor.get_state() == "committed"
        assert response_count[0] == 2

    def test_abort_transitions_to_aborted(self):
        """Abort flow: PREPARED → ABORTING → ABORTED."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-5",
            browser_id="test-browser-5",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond_to_all():
            # Respond to prepare
            msg1 = command_queue.get(timeout=5.0)
            response1 = BrowserResponseMessage(
                conversation_id="test-conv-5",
                browser_id="test-browser-5",
                success=True,
                command_id=msg1.get("command_id"),
            )
            response_queue.put(response1.to_dict())

            # Respond to abort
            msg2 = command_queue.get(timeout=5.0)
            response2 = BrowserResponseMessage(
                conversation_id="test-conv-5",
                browser_id="test-browser-5",
                success=True,
                command_id=msg2.get("command_id"),
            )
            response_queue.put(response2.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        # Execute prepare then abort
        prepare_result = executor.prepare({"type": "screenshot"})
        abort_result = executor.abort("User cancelled")

        thread.join(timeout=5.0)

        assert prepare_result is True
        assert abort_result is True
        assert executor.get_state() == "aborted"


class TestBrowserExecutorStateGuards:
    """Tests for state guard conditions."""

    def test_prepare_raises_when_not_idle(self):
        """prepare() raises RuntimeError if not in IDLE state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-6",
            browser_id="test-browser-6",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        # Manually set state to PREPARED
        executor._state = ExecutorState.PREPARED

        with pytest.raises(RuntimeError) as exc_info:
            executor.prepare({"type": "screenshot"})

        assert "expected IDLE" in str(exc_info.value)

    def test_commit_raises_when_not_prepared(self):
        """commit() raises RuntimeError if not in PREPARED state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-7",
            browser_id="test-browser-7",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        with pytest.raises(RuntimeError) as exc_info:
            executor.commit()

        assert "expected PREPARED" in str(exc_info.value)

    def test_abort_raises_when_not_prepared(self):
        """abort() raises RuntimeError if not in PREPARED state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-8",
            browser_id="test-browser-8",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        with pytest.raises(RuntimeError) as exc_info:
            executor.abort("test reason")

        assert "expected PREPARED" in str(exc_info.value)


class TestBrowserExecutorTimeout:
    """Tests for timeout handling."""

    def test_prepare_timeout_transitions_to_aborted(self):
        """Prepare timeout transitions to ABORTED state."""
        command_queue = Queue()
        response_queue = Queue()

        # Use very short timeout
        executor = BrowserExecutor(
            conv_id="test-conv-9",
            browser_id="test-browser-9",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=0.1,  # 100ms timeout
        )

        # Don't respond - let it timeout
        result = executor.prepare({"type": "screenshot"})

        assert result is False
        assert executor.get_state() == "aborted"

    def test_commit_timeout_transitions_to_aborted(self):
        """Commit timeout transitions to ABORTED state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-10",
            browser_id="test-browser-10",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=0.1,
        )

        def respond_to_prepare_only():
            msg = command_queue.get(timeout=5.0)
            response = BrowserResponseMessage(
                conversation_id="test-conv-10",
                browser_id="test-browser-10",
                success=True,
                command_id=msg.get("command_id"),
            )
            response_queue.put(response.to_dict())
            # Don't respond to commit - let it timeout

        thread = threading.Thread(target=respond_to_prepare_only)
        thread.start()

        prepare_result = executor.prepare({"type": "screenshot"})
        commit_result = executor.commit()

        thread.join(timeout=5.0)

        assert prepare_result is True
        assert commit_result is False
        assert executor.get_state() == "aborted"


class TestBrowserExecutorReset:
    """Tests for reset functionality."""

    def test_reset_from_committed_state(self):
        """Reset from COMMITTED state returns to IDLE."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-11",
            browser_id="test-browser-11",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond_to_all():
            for _ in range(2):
                msg = command_queue.get(timeout=5.0)
                response = BrowserResponseMessage(
                    conversation_id="test-conv-11",
                    browser_id="test-browser-11",
                    success=True,
                    command_id=msg.get("command_id"),
                )
                response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        executor.prepare({"type": "screenshot"})
        executor.commit()

        assert executor.get_state() == "committed"

        executor.reset()

        assert executor.get_state() == "idle"
        assert executor.get_pending_command() is None
        assert executor.get_pending_command_id() is None

        thread.join(timeout=5.0)

    def test_reset_from_aborted_state(self):
        """Reset from ABORTED state returns to IDLE."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-12",
            browser_id="test-browser-12",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=0.1,
        )

        # Let prepare timeout to get to ABORTED state
        executor.prepare({"type": "screenshot"})

        assert executor.get_state() == "aborted"

        executor.reset()

        assert executor.get_state() == "idle"

    def test_reset_from_any_state(self):
        """Reset can be called from any state."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-13",
            browser_id="test-browser-13",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        # Test reset from various states
        for state in [
            ExecutorState.IDLE,
            ExecutorState.PREPARING,
            ExecutorState.PREPARED,
            ExecutorState.COMMITTING,
            ExecutorState.COMMITTED,
            ExecutorState.ABORTING,
            ExecutorState.ABORTED,
        ]:
            executor._state = state
            executor.reset()
            assert executor.get_state() == "idle"


class TestBrowserExecutorPendingCommand:
    """Tests for pending command tracking."""

    def test_pending_command_stored_during_prepare(self):
        """Pending command is stored during prepare."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-14",
            browser_id="test-browser-14",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond():
            msg = command_queue.get(timeout=5.0)
            response = BrowserResponseMessage(
                conversation_id="test-conv-14",
                browser_id="test-browser-14",
                success=True,
                command_id=msg.get("command_id"),
            )
            response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond)
        thread.start()

        command = {"type": "screenshot", "tab_id": 123}
        command_id = "cmd-123"

        executor.prepare(command, command_id)

        assert executor.get_pending_command() == command
        assert executor.get_pending_command_id() == command_id

        thread.join(timeout=5.0)

    def test_pending_command_cleared_on_reset(self):
        """Pending command is cleared on reset."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-15",
            browser_id="test-browser-15",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond():
            msg = command_queue.get(timeout=5.0)
            response = BrowserResponseMessage(
                conversation_id="test-conv-15",
                browser_id="test-browser-15",
                success=True,
                command_id=msg.get("command_id"),
            )
            response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond)
        thread.start()

        executor.prepare({"type": "screenshot"}, "cmd-456")

        assert executor.get_pending_command() is not None

        executor.reset()

        assert executor.get_pending_command() is None
        assert executor.get_pending_command_id() is None

        thread.join(timeout=5.0)


class TestBrowserExecutorFull2PCFlow:
    """Tests for complete 2PC flows."""

    def test_successful_2pc_flow(self):
        """Complete successful 2PC flow: prepare → commit."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-16",
            browser_id="test-browser-16",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        messages_received = []

        def respond_to_all():
            for i in range(2):
                msg = command_queue.get(timeout=5.0)
                messages_received.append(msg)
                response = BrowserResponseMessage(
                    conversation_id="test-conv-16",
                    browser_id="test-browser-16",
                    success=True,
                    result={"status": "ok"} if i == 1 else None,
                    command_id=msg.get("command_id"),
                )
                response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        # Execute full 2PC
        assert executor.get_state() == "idle"

        prepare_result = executor.prepare(
            {"type": "click_element", "element_id": "abc123"}, "cmd-789"
        )
        assert prepare_result is True
        assert executor.get_state() == "prepared"

        commit_result = executor.commit()
        assert commit_result is True
        assert executor.get_state() == "committed"

        thread.join(timeout=5.0)

        # Verify both messages were received
        assert len(messages_received) == 2
        assert messages_received[0]["command"]["type"] == "click_element"
        assert messages_received[1]["command"]["type"] == "commit"

    def test_abort_2pc_flow(self):
        """Complete abort 2PC flow: prepare → abort."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-17",
            browser_id="test-browser-17",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        messages_received = []

        def respond_to_all():
            for i in range(2):
                msg = command_queue.get(timeout=5.0)
                messages_received.append(msg)
                response = BrowserResponseMessage(
                    conversation_id="test-conv-17",
                    browser_id="test-browser-17",
                    success=True,
                    command_id=msg.get("command_id"),
                )
                response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        # Execute prepare then abort
        assert executor.get_state() == "idle"

        prepare_result = executor.prepare(
            {"type": "click_element", "element_id": "xyz789"}, "cmd-abort"
        )
        assert prepare_result is True
        assert executor.get_state() == "prepared"

        abort_result = executor.abort("Element not visible")
        assert abort_result is True
        assert executor.get_state() == "aborted"

        thread.join(timeout=5.0)

        # Verify both messages were received
        assert len(messages_received) == 2
        assert messages_received[0]["command"]["type"] == "click_element"
        assert messages_received[1]["command"]["type"] == "abort"
        assert messages_received[1]["command"]["reason"] == "Element not visible"

    def test_multiple_2pc_cycles(self):
        """Multiple 2PC cycles with reset between each."""
        command_queue = Queue()
        response_queue = Queue()

        executor = BrowserExecutor(
            conv_id="test-conv-18",
            browser_id="test-browser-18",
            command_queue=command_queue,
            response_queue=response_queue,
            timeout=5.0,
        )

        def respond_to_all():
            for _ in range(4):  # 2 cycles * 2 messages each
                msg = command_queue.get(timeout=5.0)
                response = BrowserResponseMessage(
                    conversation_id="test-conv-18",
                    browser_id="test-browser-18",
                    success=True,
                    command_id=msg.get("command_id"),
                )
                response_queue.put(response.to_dict())

        thread = threading.Thread(target=respond_to_all)
        thread.start()

        # First cycle
        executor.prepare({"type": "screenshot"})
        executor.commit()
        assert executor.get_state() == "committed"

        # Reset for second cycle
        executor.reset()
        assert executor.get_state() == "idle"

        # Second cycle
        executor.prepare({"type": "click_element", "element_id": "test"})
        executor.commit()
        assert executor.get_state() == "committed"

        thread.join(timeout=5.0)
