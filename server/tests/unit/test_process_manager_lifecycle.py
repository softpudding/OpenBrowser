"""Unit tests for ProcessManager lifecycle methods."""

import time

import pytest

from server.core.process_manager import ProcessManager


class TestProcessSpawning:
    """Tests for process spawning."""

    def test_spawn_creates_process(self) -> None:
        """Test that spawn_conversation_process creates a running process."""
        manager = ProcessManager()
        conv_id = "test-conv-001"
        browser_id = "browser-uuid-001"

        manager.spawn_conversation_process(conv_id, browser_id)

        assert manager.get_process_count() == 1
        assert manager.is_process_alive(conv_id)
        assert manager.get_process_status(conv_id) == "running"

        manager.shutdown_process(conv_id, force=True)

    def test_spawn_registers_queues(self) -> None:
        """Test that spawn creates command and response queues."""
        manager = ProcessManager()
        conv_id = "test-conv-002"
        browser_id = "browser-uuid-002"

        manager.spawn_conversation_process(conv_id, browser_id)

        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.command_queue is not None
        assert process_info.response_queue is not None

        manager.shutdown_process(conv_id, force=True)

    def test_spawn_duplicate_raises_error(self) -> None:
        """Test that spawning duplicate conversation raises RuntimeError."""
        manager = ProcessManager()
        conv_id = "test-conv-003"
        browser_id = "browser-uuid-003"

        manager.spawn_conversation_process(conv_id, browser_id)

        with pytest.raises(RuntimeError) as exc_info:
            manager.spawn_conversation_process(conv_id, browser_id)

        assert "already exists" in str(exc_info.value)

        manager.shutdown_process(conv_id, force=True)


class TestProcessShutdown:
    """Tests for process shutdown."""

    def test_graceful_shutdown(self) -> None:
        """Test graceful shutdown sends message and waits for exit."""
        manager = ProcessManager()
        conv_id = "test-conv-004"
        browser_id = "browser-uuid-004"

        manager.spawn_conversation_process(conv_id, browser_id)
        assert manager.is_process_alive(conv_id)

        manager.shutdown_process(conv_id, force=False)

        assert not manager.is_process_alive(conv_id)
        assert manager.get_process_count() == 0

    def test_force_shutdown(self) -> None:
        """Test force shutdown terminates process immediately."""
        manager = ProcessManager()
        conv_id = "test-conv-005"
        browser_id = "browser-uuid-005"

        manager.spawn_conversation_process(conv_id, browser_id)
        assert manager.is_process_alive(conv_id)

        manager.shutdown_process(conv_id, force=True)

        assert not manager.is_process_alive(conv_id)
        assert manager.get_process_count() == 0

    def test_shutdown_nonexistent_raises_error(self) -> None:
        """Test shutdown of non-existent process raises KeyError."""
        manager = ProcessManager()

        with pytest.raises(KeyError) as exc_info:
            manager.shutdown_process("nonexistent-conv")

        assert "No process found" in str(exc_info.value)


class TestProcessStatus:
    """Tests for process status tracking."""

    def test_get_status_running(self) -> None:
        """Test get_process_status returns 'running' for spawned process."""
        manager = ProcessManager()
        conv_id = "test-conv-006"
        browser_id = "browser-uuid-006"

        manager.spawn_conversation_process(conv_id, browser_id)

        status = manager.get_process_status(conv_id)
        assert status == "running"

        manager.shutdown_process(conv_id, force=True)

    def test_get_status_nonexistent(self) -> None:
        """Test get_process_status returns None for unknown conversation."""
        manager = ProcessManager()

        status = manager.get_process_status("unknown-conv")
        assert status is None

    def test_is_process_alive_nonexistent(self) -> None:
        """Test is_process_alive returns False for unknown conversation."""
        manager = ProcessManager()

        assert manager.is_process_alive("unknown-conv") is False


class TestProcessInfoWithQueues:
    """Tests for ProcessInfo with queue fields."""

    def test_process_info_has_queues_after_spawn(self) -> None:
        """Test ProcessInfo has command_queue and response_queue after spawn."""
        manager = ProcessManager()
        conv_id = "test-conv-007"
        browser_id = "browser-uuid-007"

        manager.spawn_conversation_process(conv_id, browser_id)

        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.command_queue is not None
        assert process_info.response_queue is not None

        manager.shutdown_process(conv_id, force=True)

    def test_queues_are_functional(self) -> None:
        """Test that queues can be used for communication."""
        manager = ProcessManager()
        conv_id = "test-conv-008"
        browser_id = "browser-uuid-008"

        manager.spawn_conversation_process(conv_id, browser_id)

        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.command_queue is not None

        test_message = {"test": "message", "data": 123}
        process_info.command_queue.put(test_message)

        manager.shutdown_process(conv_id, force=True)
