"""Integration tests for process crash recovery.

Tests the full crash recovery flow with real multiprocessing:
- Crash detection works correctly
- Crashed process is detected and marked
- Recovery restarts the process
- Max restart limit is enforced
- Crash history is recorded
- Other processes are not affected by one crash

These tests use real multiprocessing (not mocks) to verify
the complete crash recovery behavior.
"""

import time

import pytest

from server.core.process_manager import ProcessManager


@pytest.fixture
def process_manager() -> ProcessManager:
    """Create a fresh ProcessManager for each test."""
    return ProcessManager()


@pytest.fixture
def cleanup_manager() -> ProcessManager:
    """Create a ProcessManager that will be cleaned up after the test."""
    manager = ProcessManager()
    yield manager
    # Cleanup: shutdown all remaining processes
    for conv_id in manager.list_processes():
        try:
            manager.shutdown_process(conv_id, force=True)
        except Exception:
            pass


@pytest.mark.integration
class TestCrashDetectionIntegration:
    """Integration tests for crash detection with real processes."""

    def test_detect_crashes_finds_terminated_process(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that detect_crashes finds a terminated process.

        This test simulates a real crash by terminating the process
        and verifies that detect_crashes correctly identifies it.
        """
        conv_id = "integration-crash-001"
        browser_id = "browser-uuid-001"

        # Spawn a real process
        cleanup_manager.spawn_conversation_process(conv_id, browser_id)
        assert cleanup_manager.is_process_alive(conv_id)

        # Get the process and terminate it (simulate crash)
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        # Verify process is dead
        assert not process_info.process.is_alive()

        # Detect crashes
        crashed = cleanup_manager.detect_crashes()

        # Verify crash was detected
        assert conv_id in crashed
        assert cleanup_manager.get_process_status(conv_id) == "crashed"

    def test_detect_crashes_records_exit_code(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that crash detection records the exit code."""
        conv_id = "integration-crash-002"
        browser_id = "browser-uuid-002"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None

        # Terminate and wait
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()

        # Check crash history
        history = cleanup_manager.get_crash_history(conv_id)
        assert len(history) == 1
        assert "exit_code" in history[0]
        # Terminated processes typically have negative exit codes
        assert history[0]["exit_code"] is not None

    def test_detect_crashes_does_not_affect_running_processes(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that detect_crashes doesn't mark running processes as crashed."""
        conv_id1 = "integration-crash-003a"
        conv_id2 = "integration-crash-003b"
        browser_id1 = "browser-uuid-003a"
        browser_id2 = "browser-uuid-003b"

        # Spawn two processes
        cleanup_manager.spawn_conversation_process(conv_id1, browser_id1)
        cleanup_manager.spawn_conversation_process(conv_id2, browser_id2)

        # Terminate only one
        process_info1 = cleanup_manager.get_process_info(conv_id1)
        assert process_info1 is not None
        assert process_info1.process is not None
        process_info1.process.terminate()
        process_info1.process.join(timeout=2.0)

        # Detect crashes
        crashed = cleanup_manager.detect_crashes()

        # Only the terminated process should be in crashed list
        assert conv_id1 in crashed
        assert conv_id2 not in crashed
        assert cleanup_manager.get_process_status(conv_id1) == "crashed"
        assert cleanup_manager.get_process_status(conv_id2) == "running"


@pytest.mark.integration
class TestProcessRecoveryIntegration:
    """Integration tests for process recovery with real processes."""

    def test_recover_process_creates_new_process(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that recover_process creates a new running process."""
        conv_id = "integration-recover-001"
        browser_id = "browser-uuid-001"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        old_pid = process_info.process.pid

        # Crash the process
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        # Detect and recover
        cleanup_manager.detect_crashes()
        result = cleanup_manager.recover_process(conv_id)

        # Verify recovery succeeded
        assert result is True
        assert cleanup_manager.get_process_status(conv_id) == "running"
        assert cleanup_manager.is_process_alive(conv_id)

        # Verify new process has different PID
        new_process_info = cleanup_manager.get_process_info(conv_id)
        assert new_process_info is not None
        assert new_process_info.process is not None
        assert new_process_info.process.pid != old_pid

    def test_recover_process_creates_new_queues(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that recovery creates new IPC queues."""
        conv_id = "integration-recover-002"
        browser_id = "browser-uuid-002"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        old_command_queue = process_info.command_queue
        old_response_queue = process_info.response_queue

        # Crash and recover
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()
        cleanup_manager.recover_process(conv_id)

        # Verify new queues were created
        new_process_info = cleanup_manager.get_process_info(conv_id)
        assert new_process_info is not None
        assert new_process_info.command_queue is not old_command_queue
        assert new_process_info.response_queue is not old_response_queue

    def test_recover_process_increments_restart_count(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that recovery increments the restart count."""
        conv_id = "integration-recover-003"
        browser_id = "browser-uuid-003"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)
        assert cleanup_manager.get_restart_count(conv_id) == 0

        # Crash and recover
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()
        cleanup_manager.recover_process(conv_id)

        assert cleanup_manager.get_restart_count(conv_id) == 1

    def test_recover_all_crashed_recovers_multiple(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test recover_all_crashed recovers multiple crashed processes."""
        conv_ids = ["integration-recoverall-001", "integration-recoverall-002"]
        browser_ids = ["browser-uuid-001", "browser-uuid-002"]

        # Spawn multiple processes
        for conv_id, browser_id in zip(conv_ids, browser_ids):
            cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # Crash all of them
        for conv_id in conv_ids:
            process_info = cleanup_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)

        # Recover all
        results = cleanup_manager.recover_all_crashed()

        # Verify all recovered
        assert len(results) == 2
        for conv_id in conv_ids:
            assert results[conv_id] is True
            assert cleanup_manager.get_process_status(conv_id) == "running"
            assert cleanup_manager.is_process_alive(conv_id)


@pytest.mark.integration
class TestMaxRestartLimitIntegration:
    """Integration tests for max restart limit enforcement."""

    def test_max_restart_limit_prevents_recovery(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that max restart limit prevents further recovery."""
        conv_id = "integration-limit-001"
        browser_id = "browser-uuid-001"

        # Set max restarts to 1
        cleanup_manager.set_max_restarts(conv_id, 1)
        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # First crash and recovery - should succeed
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()
        result1 = cleanup_manager.recover_process(conv_id)
        assert result1 is True
        assert cleanup_manager.get_restart_count(conv_id) == 1

        # Second crash and recovery - should fail (limit reached)
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()
        result2 = cleanup_manager.recover_process(conv_id)
        assert result2 is False
        assert cleanup_manager.get_process_status(conv_id) == "crashed"

    def test_default_max_restarts_is_three(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that default max restarts allows 3 recoveries."""
        conv_id = "integration-limit-002"
        browser_id = "browser-uuid-002"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # Perform 3 successful recoveries
        for i in range(3):
            process_info = cleanup_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)

            cleanup_manager.detect_crashes()
            result = cleanup_manager.recover_process(conv_id)
            assert result is True, f"Recovery {i + 1} should succeed"
            assert cleanup_manager.get_restart_count(conv_id) == i + 1

        # 4th recovery should fail
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        cleanup_manager.detect_crashes()
        result = cleanup_manager.recover_process(conv_id)
        assert result is False, "4th recovery should fail (limit reached)"


@pytest.mark.integration
class TestCrashHistoryIntegration:
    """Integration tests for crash history recording."""

    def test_multiple_crashes_recorded_in_history(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that multiple crashes are recorded in history."""
        conv_id = "integration-history-001"
        browser_id = "browser-uuid-001"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # Crash and recover multiple times
        for i in range(3):
            process_info = cleanup_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)

            cleanup_manager.detect_crashes()
            cleanup_manager.recover_process(conv_id)

        # Check history has 3 entries
        history = cleanup_manager.get_crash_history(conv_id)
        assert len(history) == 3

        # Verify each entry has required fields
        for entry in history:
            assert "timestamp" in entry
            assert "exit_code" in entry
            assert "restart_count" in entry

    def test_crash_history_persists_across_recoveries(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that crash history persists across recoveries."""
        conv_id = "integration-history-002"
        browser_id = "browser-uuid-002"

        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # First crash
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        cleanup_manager.detect_crashes()

        first_history = cleanup_manager.get_crash_history(conv_id)
        assert len(first_history) == 1

        # Recover
        cleanup_manager.recover_process(conv_id)

        # Second crash
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        cleanup_manager.detect_crashes()

        # History should now have 2 entries
        second_history = cleanup_manager.get_crash_history(conv_id)
        assert len(second_history) == 2

        # First entry should still be there
        assert second_history[0] == first_history[0]


@pytest.mark.integration
class TestProcessIsolationIntegration:
    """Integration tests for process isolation during crashes."""

    def test_one_crash_does_not_affect_others(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test that one process crash doesn't affect other processes."""
        conv_id1 = "integration-isolation-001a"
        conv_id2 = "integration-isolation-001b"
        browser_id1 = "browser-uuid-001a"
        browser_id2 = "browser-uuid-001b"

        # Spawn two processes
        cleanup_manager.spawn_conversation_process(conv_id1, browser_id1)
        cleanup_manager.spawn_conversation_process(conv_id2, browser_id2)

        # Verify both are running
        assert cleanup_manager.is_process_alive(conv_id1)
        assert cleanup_manager.is_process_alive(conv_id2)

        # Crash first process
        process_info1 = cleanup_manager.get_process_info(conv_id1)
        assert process_info1 is not None
        assert process_info1.process is not None
        process_info1.process.terminate()
        process_info1.process.join(timeout=2.0)

        # Verify second process is still running
        assert not cleanup_manager.is_process_alive(conv_id1)
        assert cleanup_manager.is_process_alive(conv_id2)
        assert cleanup_manager.get_process_status(conv_id2) == "running"

        # Recover first process
        cleanup_manager.detect_crashes()
        cleanup_manager.recover_process(conv_id1)

        # Verify both are running again
        assert cleanup_manager.is_process_alive(conv_id1)
        assert cleanup_manager.is_process_alive(conv_id2)

    def test_crash_detection_isolation(self, cleanup_manager: ProcessManager) -> None:
        """Test that crash detection only affects crashed processes."""
        conv_ids = [
            "integration-isolation-002a",
            "integration-isolation-002b",
            "integration-isolation-002c",
        ]
        browser_ids = ["browser-uuid-002a", "browser-uuid-002b", "browser-uuid-002c"]

        # Spawn three processes
        for conv_id, browser_id in zip(conv_ids, browser_ids):
            cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # Crash only the middle one
        process_info = cleanup_manager.get_process_info(conv_ids[1])
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)

        # Detect crashes
        crashed = cleanup_manager.detect_crashes()

        # Only middle process should be crashed
        assert conv_ids[0] not in crashed
        assert conv_ids[1] in crashed
        assert conv_ids[2] not in crashed

        # Verify statuses
        assert cleanup_manager.get_process_status(conv_ids[0]) == "running"
        assert cleanup_manager.get_process_status(conv_ids[1]) == "crashed"
        assert cleanup_manager.get_process_status(conv_ids[2]) == "running"


@pytest.mark.integration
class TestRecoveryAfterMultipleCrashes:
    """Integration tests for recovery behavior after multiple crashes."""

    def test_recovery_after_partial_restart_limit(
        self, cleanup_manager: ProcessManager
    ) -> None:
        """Test recovery works correctly when some restarts have been used."""
        conv_id = "integration-multiple-001"
        browser_id = "browser-uuid-001"

        # Set max restarts to 5
        cleanup_manager.set_max_restarts(conv_id, 5)
        cleanup_manager.spawn_conversation_process(conv_id, browser_id)

        # Perform 2 recoveries
        for _ in range(2):
            process_info = cleanup_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)
            cleanup_manager.detect_crashes()
            cleanup_manager.recover_process(conv_id)

        # Verify restart count
        assert cleanup_manager.get_restart_count(conv_id) == 2

        # Should still be able to recover 3 more times
        for _ in range(3):
            process_info = cleanup_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.process is not None
            process_info.process.terminate()
            process_info.process.join(timeout=2.0)
            cleanup_manager.detect_crashes()
            result = cleanup_manager.recover_process(conv_id)
            assert result is True

        # Now at limit
        assert cleanup_manager.get_restart_count(conv_id) == 5

        # Next recovery should fail
        process_info = cleanup_manager.get_process_info(conv_id)
        assert process_info is not None
        assert process_info.process is not None
        process_info.process.terminate()
        process_info.process.join(timeout=2.0)
        cleanup_manager.detect_crashes()
        result = cleanup_manager.recover_process(conv_id)
        assert result is False
