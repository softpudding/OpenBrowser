"""Unit tests for Process Spawner implementation."""

import time
from multiprocessing import Queue

import pytest

from server.core.process_manager import (
    ProcessManager,
    ProcessInfo,
    _conversation_worker,
    _placeholder_worker,
)
from server.core.ipc_types import (
    BrowserCommandMessage,
    BrowserResponseMessage,
    ProcessShutdownMessage,
)


class TestConversationWorker:
    """Tests for _conversation_worker function."""

    def test_worker_exits_on_shutdown_message(self) -> None:
        """Test worker exits gracefully when receiving shutdown message."""
        command_queue: Queue = Queue()
        response_queue: Queue = Queue()

        shutdown_msg = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-uuid",
            reason="test_shutdown",
            force=False,
        )
        command_queue.put(shutdown_msg.to_dict())

        _placeholder_worker(
            conv_id="conv-123",
            browser_id="browser-uuid",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        assert response_queue.empty()

    def test_worker_processes_multiple_messages(self) -> None:
        """Test worker can process multiple messages before shutdown."""
        command_queue: Queue = Queue()
        response_queue: Queue = Queue()

        command_queue.put({"type": "test", "data": "message1"})
        command_queue.put({"type": "test", "data": "message2"})
        shutdown_msg = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-uuid",
            reason="test_shutdown",
            force=False,
        )
        command_queue.put(shutdown_msg.to_dict())

        _placeholder_worker(
            conv_id="conv-123",
            browser_id="browser-uuid",
            command_queue=command_queue,
            response_queue=response_queue,
        )

        assert response_queue.empty()


class TestSpawnWithConfig:
    """Tests for spawn_with_config method."""

    def test_spawn_with_config_creates_process(self) -> None:
        """Test spawn_with_config creates a new process."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
            "base_url": "https://test.example.com",
        }

        manager.spawn_with_config(
            conv_id="conv-123",
            browser_id="browser-uuid",
            llm_config=llm_config,
        )

        assert manager.get_process_count() == 1
        assert "conv-123" in manager.list_processes()

        process_info = manager.get_process_info("conv-123")
        assert process_info is not None
        assert process_info.status == "running"
        assert process_info.command_queue is not None
        assert process_info.response_queue is not None

        manager.shutdown_process("conv-123")

    def test_spawn_with_config_rejects_duplicate(self) -> None:
        """Test spawn_with_config raises error for duplicate conversation."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
        }

        manager.spawn_with_config(
            conv_id="conv-123",
            browser_id="browser-uuid",
            llm_config=llm_config,
        )

        with pytest.raises(RuntimeError, match="Process already exists"):
            manager.spawn_with_config(
                conv_id="conv-123",
                browser_id="browser-uuid-2",
                llm_config=llm_config,
            )

        manager.shutdown_process("conv-123")

    def test_spawn_with_config_process_is_alive(self) -> None:
        """Test spawned process is alive after creation."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
        }

        manager.spawn_with_config(
            conv_id="conv-123",
            browser_id="browser-uuid",
            llm_config=llm_config,
        )

        assert manager.is_process_alive("conv-123")

        manager.shutdown_process("conv-123")

    def test_spawn_with_config_graceful_shutdown(self) -> None:
        """Test graceful shutdown sends shutdown message."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
        }

        manager.spawn_with_config(
            conv_id="conv-123",
            browser_id="browser-uuid",
            llm_config=llm_config,
        )

        manager.shutdown_process("conv-123", force=False)

        assert manager.get_process_info("conv-123") is None


class TestProcessSpawnerIntegration:
    """Integration tests for process spawner."""

    def test_spawn_and_shutdown_multiple_processes(self) -> None:
        """Test spawning and shutting down multiple processes."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
        }

        for i in range(3):
            manager.spawn_with_config(
                conv_id=f"conv-{i}",
                browser_id=f"browser-{i}",
                llm_config=llm_config,
            )

        assert manager.get_process_count() == 3

        for i in range(3):
            assert manager.is_process_alive(f"conv-{i}")

        for i in range(3):
            manager.shutdown_process(f"conv-{i}")

        assert manager.get_process_count() == 0

    def test_process_queues_are_isolated(self) -> None:
        """Test that each process has isolated queues."""
        manager = ProcessManager()

        llm_config = {
            "model": "test-model",
            "api_key": "test-key",
        }

        manager.spawn_with_config(
            conv_id="conv-1",
            browser_id="browser-1",
            llm_config=llm_config,
        )
        manager.spawn_with_config(
            conv_id="conv-2",
            browser_id="browser-2",
            llm_config=llm_config,
        )

        info1 = manager.get_process_info("conv-1")
        info2 = manager.get_process_info("conv-2")

        assert info1.command_queue is not info2.command_queue
        assert info1.response_queue is not info2.response_queue

        manager.shutdown_process("conv-1")
        manager.shutdown_process("conv-2")
