"""Tests for ProcessManager health monitoring functionality."""

import time
from unittest.mock import MagicMock, patch

import pytest

from server.core.process_manager import (
    DEFAULT_MEMORY_LIMIT_MB,
    ProcessManager,
    ProcessInfo,
)


class TestCheckHealth:
    """Tests for check_health method."""

    def test_check_health_not_found(self) -> None:
        """Check health returns not_found for non-existent process."""
        manager = ProcessManager()
        health = manager.check_health("non-existent")

        assert health["alive"] is False
        assert health["status"] == "not_found"
        assert health["memory_bytes"] is None
        assert health["memory_mb"] is None
        assert health["memory_limit_mb"] is None
        assert health["memory_exceeded"] is False

    def test_check_health_alive_process(self) -> None:
        """Check health returns correct info for alive process."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        health = manager.check_health("conv-1")

        assert health["alive"] is True
        assert health["status"] == "running"
        assert health["memory_limit_mb"] == DEFAULT_MEMORY_LIMIT_MB

        manager.shutdown_process("conv-1", force=True)

    def test_check_health_dead_process(self) -> None:
        """Check health returns alive=False for dead process."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        process_info = manager.get_process_info("conv-1")
        assert process_info is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        health = manager.check_health("conv-1")

        assert health["alive"] is False


class TestGetMemoryUsage:
    """Tests for get_memory_usage method."""

    def test_get_memory_usage_no_process(self) -> None:
        """Get memory usage returns None for non-existent process."""
        manager = ProcessManager()
        assert manager.get_memory_usage("non-existent") is None

    def test_get_memory_usage_psutil_unavailable(self) -> None:
        """Get memory usage returns None when psutil is unavailable."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        with patch("server.core.process_manager.PSUTIL_AVAILABLE", False):
            assert manager.get_memory_usage("conv-1") is None

        manager.shutdown_process("conv-1", force=True)

    def test_get_memory_usage_with_psutil(self) -> None:
        """Get memory usage returns bytes when psutil is available."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        memory = manager.get_memory_usage("conv-1")

        if memory is not None:
            assert isinstance(memory, int)
            assert memory > 0

        manager.shutdown_process("conv-1", force=True)


class TestCheckAllHealth:
    """Tests for check_all_health method."""

    def test_check_all_health_empty(self) -> None:
        """Check all health returns empty dict for no processes."""
        manager = ProcessManager()
        assert manager.check_all_health() == {}

    def test_check_all_health_multiple_processes(self) -> None:
        """Check all health returns health for all processes."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")
        manager.spawn_conversation_process("conv-2", "browser-2")

        all_health = manager.check_all_health()

        assert "conv-1" in all_health
        assert "conv-2" in all_health
        assert all_health["conv-1"]["alive"] is True
        assert all_health["conv-2"]["alive"] is True

        manager.shutdown_process("conv-1", force=True)
        manager.shutdown_process("conv-2", force=True)


class TestSetMemoryLimit:
    """Tests for set_memory_limit method."""

    def test_set_memory_limit_non_existent(self) -> None:
        """Set memory limit raises KeyError for non-existent process."""
        manager = ProcessManager()
        with pytest.raises(KeyError, match="No process found"):
            manager.set_memory_limit("non-existent", 1024)

    def test_set_memory_limit_success(self) -> None:
        """Set memory limit updates the limit for a process."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        manager.set_memory_limit("conv-1", 2048)

        process_info = manager.get_process_info("conv-1")
        assert process_info is not None
        assert process_info.memory_limit_mb == 2048

        manager.shutdown_process("conv-1", force=True)


class TestIsMemoryExceeded:
    """Tests for is_memory_exceeded method."""

    def test_is_memory_exceeded_no_process(self) -> None:
        """Is memory exceeded returns False for non-existent process."""
        manager = ProcessManager()
        assert manager.is_memory_exceeded("non-existent") is False

    def test_is_memory_exceeded_within_limit(self) -> None:
        """Is memory exceeded returns False when within limit."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        manager.set_memory_limit("conv-1", 16384)

        assert manager.is_memory_exceeded("conv-1") is False

        manager.shutdown_process("conv-1", force=True)


class TestRestartIfNeeded:
    """Tests for restart_if_needed method."""

    def test_restart_if_needed_non_existent(self) -> None:
        """Restart if needed raises KeyError for non-existent process."""
        manager = ProcessManager()
        with pytest.raises(KeyError, match="No process found"):
            manager.restart_if_needed("non-existent")

    def test_restart_if_needed_no_restart_required(self) -> None:
        """Restart if needed returns False when no restart needed."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        manager.set_memory_limit("conv-1", 16384)

        result = manager.restart_if_needed("conv-1")

        assert result is False

        manager.shutdown_process("conv-1", force=True)

    def test_restart_if_needed_preserves_memory_limit(self) -> None:
        """Restart if needed preserves memory limit after restart."""
        manager = ProcessManager()
        manager.spawn_conversation_process("conv-1", "browser-1")

        manager.set_memory_limit("conv-1", 2048)

        original_limit = manager.get_process_info("conv-1").memory_limit_mb

        manager.shutdown_process("conv-1", force=True)

        manager.spawn_conversation_process("conv-1", "browser-2")
        manager.set_memory_limit("conv-1", original_limit)

        process_info = manager.get_process_info("conv-1")
        assert process_info is not None
        assert process_info.memory_limit_mb == original_limit

        manager.shutdown_process("conv-1", force=True)
