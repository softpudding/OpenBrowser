"""Unit tests for ProcessManager crash recovery functionality."""

import time

import pytest

from server.core.process_manager import ProcessManager


class TestCrashDetection:
    """Tests for crash detection."""

    def test_detect_crashes_empty(self) -> None:
        """Test detect_crashes returns empty list when no processes."""
        manager = ProcessManager()
        crashed = manager.detect_crashes()
        assert crashed == []

    def test_detect_crashes_running_process(self) -> None:
        """Test detect_crashes returns empty list for running processes."""
        manager = ProcessManager()
        conv_id = "test-conv-crash-001"
        browser_id = "browser-uuid-001"

        manager.spawn_conversation_process(conv_id, browser_id)
        crashed = manager.detect_crashes()

        assert crashed == []
        assert manager.get_process_status(conv_id) == "running"

        manager.shutdown_process(conv_id, force=True)

    def test_detect_crashes_dead_process(self) -> None:
        """Test detect_crashes detects and marks crashed processes."""
        manager = ProcessManager()
        conv_id = "test-conv-crash-002"
        browser_id = "browser-uuid-002"

        manager.spawn_conversation_process(conv_id, browser_id)
        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        crashed = manager.detect_crashes()

        assert conv_id in crashed
        assert manager.get_process_status(conv_id) == "crashed"

        manager.shutdown_process(conv_id, force=True)

    def test_detect_crashes_records_history(self) -> None:
        """Test detect_crashes records crash in history."""
        manager = ProcessManager()
        conv_id = "test-conv-crash-003"
        browser_id = "browser-uuid-003"

        manager.spawn_conversation_process(conv_id, browser_id)
        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        manager.detect_crashes()

        history = manager.get_crash_history(conv_id)
        assert len(history) == 1
        assert "timestamp" in history[0]
        assert "exit_code" in history[0]

        manager.shutdown_process(conv_id, force=True)


class TestProcessRecovery:
    """Tests for process recovery."""

    def test_recover_process_success(self) -> None:
        """Test recover_process restarts a crashed process."""
        manager = ProcessManager()
        conv_id = "test-conv-recover-001"
        browser_id = "browser-uuid-001"

        manager.spawn_conversation_process(conv_id, browser_id)
        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        old_pid = process_info.process.pid
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        manager.detect_crashes()
        result = manager.recover_process(conv_id)

        assert result is True
        assert manager.get_process_status(conv_id) == "running"
        assert manager.is_process_alive(conv_id)

        new_process_info = manager.get_process_info(conv_id)
        assert new_process_info is not None
        assert new_process_info.process is not None
        assert new_process_info.process.pid != old_pid
        assert new_process_info.restart_count == 1

        manager.shutdown_process(conv_id, force=True)

    def test_recover_process_non_crashed(self) -> None:
        """Test recover_process fails for non-crashed process."""
        manager = ProcessManager()
        conv_id = "test-conv-recover-002"
        browser_id = "browser-uuid-002"

        manager.spawn_conversation_process(conv_id, browser_id)

        result = manager.recover_process(conv_id)

        assert result is False
        assert manager.get_process_status(conv_id) == "running"

        manager.shutdown_process(conv_id, force=True)

    def test_recover_process_nonexistent(self) -> None:
        """Test recover_process fails for nonexistent conversation."""
        manager = ProcessManager()

        result = manager.recover_process("nonexistent-conv")

        assert result is False


class TestRecoverAllCrashed:
    """Tests for recover_all_crashed."""

    def test_recover_all_crashed_empty(self) -> None:
        """Test recover_all_crashed returns empty dict when no crashes."""
        manager = ProcessManager()
        results = manager.recover_all_crashed()
        assert results == {}

    def test_recover_all_crashed_multiple(self) -> None:
        """Test recover_all_crashed recovers multiple crashed processes."""
        manager = ProcessManager()

        conv_id1 = "test-conv-recoverall-001"
        conv_id2 = "test-conv-recoverall-002"
        browser_id1 = "browser-uuid-001"
        browser_id2 = "browser-uuid-002"

        manager.spawn_conversation_process(conv_id1, browser_id1)
        manager.spawn_conversation_process(conv_id2, browser_id2)

        for conv_id in [conv_id1, conv_id2]:
            process_info = manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)

        results = manager.recover_all_crashed()

        assert len(results) == 2
        assert results[conv_id1] is True
        assert results[conv_id2] is True
        assert manager.get_process_status(conv_id1) == "running"
        assert manager.get_process_status(conv_id2) == "running"

        manager.shutdown_process(conv_id1, force=True)
        manager.shutdown_process(conv_id2, force=True)


class TestCrashHistory:
    """Tests for crash history tracking."""

    def test_get_crash_history_empty(self) -> None:
        """Test get_crash_history returns empty list for new process."""
        manager = ProcessManager()
        conv_id = "test-conv-history-001"
        browser_id = "browser-uuid-001"

        manager.spawn_conversation_process(conv_id, browser_id)

        history = manager.get_crash_history(conv_id)
        assert history == []

        manager.shutdown_process(conv_id, force=True)

    def test_get_crash_history_nonexistent(self) -> None:
        """Test get_crash_history returns empty list for nonexistent conversation."""
        manager = ProcessManager()
        history = manager.get_crash_history("nonexistent-conv")
        assert history == []

    def test_clear_crash_history(self) -> None:
        """Test clear_crash_history clears the history."""
        manager = ProcessManager()
        conv_id = "test-conv-history-002"
        browser_id = "browser-uuid-002"

        manager.spawn_conversation_process(conv_id, browser_id)
        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        manager.detect_crashes()

        assert len(manager.get_crash_history(conv_id)) == 1

        result = manager.clear_crash_history(conv_id)
        assert result is True
        assert manager.get_crash_history(conv_id) == []

        manager.shutdown_process(conv_id, force=True)

    def test_clear_crash_history_nonexistent(self) -> None:
        """Test clear_crash_history returns False for nonexistent conversation."""
        manager = ProcessManager()
        result = manager.clear_crash_history("nonexistent-conv")
        assert result is False


class TestMaxRestarts:
    """Tests for max restart limit."""

    def test_get_restart_count_initial(self) -> None:
        """Test get_restart_count returns 0 for new process."""
        manager = ProcessManager()
        conv_id = "test-conv-restart-001"
        browser_id = "browser-uuid-001"

        manager.spawn_conversation_process(conv_id, browser_id)

        count = manager.get_restart_count(conv_id)
        assert count == 0

        manager.shutdown_process(conv_id, force=True)

    def test_get_restart_count_nonexistent(self) -> None:
        """Test get_restart_count returns 0 for nonexistent conversation."""
        manager = ProcessManager()
        count = manager.get_restart_count("nonexistent-conv")
        assert count == 0

    def test_set_max_restarts(self) -> None:
        """Test set_max_restores sets the limit."""
        manager = ProcessManager()
        conv_id = "test-conv-restart-002"

        manager.set_max_restarts(conv_id, 5)

    def test_max_restarts_limit_enforced(self) -> None:
        """Test that recovery fails when max restarts is reached."""
        manager = ProcessManager()
        conv_id = "test-conv-restart-003"
        browser_id = "browser-uuid-003"

        manager.set_max_restarts(conv_id, 1)
        manager.spawn_conversation_process(conv_id, browser_id)

        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        manager.detect_crashes()
        result1 = manager.recover_process(conv_id)
        assert result1 is True
        assert manager.get_restart_count(conv_id) == 1

        new_process_info = manager.get_process_info(conv_id)
        assert new_process_info is not None
        assert new_process_info.process is not None
        new_process_info.process.terminate()
        new_process_info.process.join(timeout=2.0)
        manager.detect_crashes()
        result2 = manager.recover_process(conv_id)
        assert result2 is False

        manager.shutdown_process(conv_id, force=True)

    def test_default_max_restarts_is_three(self) -> None:
        """Test that default max restarts is 3."""
        manager = ProcessManager()
        conv_id = "test-conv-restart-004"
        browser_id = "browser-uuid-004"

        manager.spawn_conversation_process(conv_id, browser_id)
        process_info = manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        for i in range(3):
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)
            manager.detect_crashes()
            result = manager.recover_process(conv_id)
            assert result is True, f"Restart {i + 1} should succeed"
            process_info = manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        manager.detect_crashes()
        result = manager.recover_process(conv_id)
        assert result is False, "4th restart should fail (limit reached)"

        manager.shutdown_process(conv_id, force=True)
