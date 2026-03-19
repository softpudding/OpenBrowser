"""Unit tests for ProcessManager skeleton."""

import pytest

from server.core.process_manager import ProcessInfo, ProcessManager


class TestProcessInfo:
    """Tests for ProcessInfo dataclass."""

    def test_process_info_creation(self) -> None:
        """Test ProcessInfo can be created with required fields."""
        info = ProcessInfo(
            conversation_id="conv-123",
            browser_id="browser-uuid",
        )
        assert info.conversation_id == "conv-123"
        assert info.browser_id == "browser-uuid"
        assert info.process is None
        assert info.status == "starting"
        assert info.started_at > 0

    def test_process_info_with_process(self) -> None:
        """Test ProcessInfo can hold a process reference."""
        info = ProcessInfo(
            conversation_id="conv-456",
            browser_id="browser-uuid-2",
            process=None,  # Would be a real Process in production
            status="running",
        )
        assert info.status == "running"


class TestProcessManager:
    """Tests for ProcessManager class."""

    def test_instantiation(self) -> None:
        """Test ProcessManager can be instantiated."""
        manager = ProcessManager()
        assert manager is not None

    def test_list_processes_empty(self) -> None:
        """Test list_processes returns empty list initially."""
        manager = ProcessManager()
        result = manager.list_processes()
        assert result == []
        assert isinstance(result, list)

    def test_get_process_count_empty(self) -> None:
        """Test get_process_count returns 0 initially."""
        manager = ProcessManager()
        assert manager.get_process_count() == 0

    def test_get_process_not_found(self) -> None:
        """Test get_process returns None for unknown conversation."""
        manager = ProcessManager()
        result = manager.get_process("unknown-conv-id")
        assert result is None

    def test_get_process_info_not_found(self) -> None:
        """Test get_process_info returns None for unknown conversation."""
        manager = ProcessManager()
        result = manager.get_process_info("unknown-conv-id")
        assert result is None

    def test_register_process_internal(self) -> None:
        """Test _register_process creates ProcessInfo entry."""
        manager = ProcessManager()
        info = manager._register_process("conv-123", "browser-uuid")

        assert info.conversation_id == "conv-123"
        assert info.browser_id == "browser-uuid"
        assert info.status == "starting"
        assert manager.get_process_count() == 1
        assert "conv-123" in manager.list_processes()

    def test_unregister_process_internal(self) -> None:
        """Test _unregister_process removes ProcessInfo entry."""
        manager = ProcessManager()
        manager._register_process("conv-123", "browser-uuid")

        result = manager._unregister_process("conv-123")
        assert result is True
        assert manager.get_process_count() == 0
        assert "conv-123" not in manager.list_processes()

    def test_unregister_process_not_found(self) -> None:
        """Test _unregister_process returns False for unknown conversation."""
        manager = ProcessManager()
        result = manager._unregister_process("unknown-conv-id")
        assert result is False
