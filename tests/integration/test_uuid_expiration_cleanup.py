"""Integration tests for UUID expiration cleanup.

Tests the automatic cleanup of expired browser UUIDs:
- UUIDs expire after TTL
- Expired UUIDs are cleaned up automatically
- cleanup_expired_browsers returns list of removed UUIDs
- Expired browser UUIDs trigger conversation cleanup
"""

import time
import uuid
from unittest.mock import MagicMock, patch

import pytest

from server.core.uuid_manager import UUIDManager
from server.websocket.manager import WebSocketManager
from server.core.process_manager import ProcessManager, ProcessInfo


@pytest.fixture
def uuid_manager() -> UUIDManager:
    """Create a fresh UUIDManager for each test."""
    return UUIDManager()


@pytest.fixture
def ws_manager() -> WebSocketManager:
    """Create a fresh WebSocketManager for each test."""
    return WebSocketManager()


@pytest.fixture
def process_manager() -> ProcessManager:
    """Create a fresh ProcessManager for each test."""
    return ProcessManager()


def generate_uuid() -> str:
    """Generate a unique UUID string."""
    return str(uuid.uuid4())


@pytest.mark.integration
class TestUUIDExpiration:
    """Tests for UUID expiration behavior."""

    def test_uuid_expires_after_ttl(self, uuid_manager: UUIDManager) -> None:
        """Test that UUID expires after TTL.

        Given: A UUID registered with TTL
        When: Time passes beyond TTL
        Then: UUID is no longer valid
        """
        test_uuid = generate_uuid()

        # Register with default TTL
        uuid_manager.register_browser(test_uuid, websocket=None, ttl_hours=24)

        # Should be valid immediately
        assert uuid_manager.is_valid(test_uuid)

        # Manually expire the UUID by setting expires_at to past
        uuid_manager._browsers[test_uuid].expires_at = time.time() - 1

        # Should be expired
        assert not uuid_manager.is_valid(test_uuid)

    def test_cleanup_expired_removes_expired_uuids(
        self, uuid_manager: UUIDManager
    ) -> None:
        """Test that cleanup_expired removes expired UUIDs.

        Given: Multiple UUIDs, some expired, some valid
        When: cleanup_expired is called
        Then: Only expired UUIDs are removed
        """
        expired_uuid = generate_uuid()
        valid_uuid = generate_uuid()

        # Register expired UUID (TTL = 0)
        uuid_manager.register_browser(expired_uuid, websocket=None, ttl_hours=0)

        # Register valid UUID (TTL = 24 hours)
        uuid_manager.register_browser(valid_uuid, websocket=None, ttl_hours=24)

        # Wait for expiration
        time.sleep(0.1)

        # Verify expired is invalid, valid is still valid
        assert not uuid_manager.is_valid(expired_uuid)
        assert uuid_manager.is_valid(valid_uuid)

        # Cleanup
        count = uuid_manager.cleanup_expired()

        # Should have removed 1 expired UUID
        assert count == 1

        # Expired UUID should be gone
        assert uuid_manager.get_websocket(expired_uuid) is None

        # Valid UUID should still exist
        assert uuid_manager.is_valid(valid_uuid)

    def test_cleanup_expired_returns_count(self, uuid_manager: UUIDManager) -> None:
        """Test that cleanup_expired returns correct count.

        Given: Multiple expired UUIDs
        When: cleanup_expired is called
        Then: Returns count of removed UUIDs
        """
        num_expired = 3

        for _ in range(num_expired):
            test_uuid = generate_uuid()
            uuid_manager.register_browser(test_uuid, websocket=None, ttl_hours=0)

        # Wait for expiration
        time.sleep(0.1)

        # Cleanup
        count = uuid_manager.cleanup_expired()

        assert count == num_expired


@pytest.mark.integration
class TestWebSocketManagerCleanup:
    """Tests for WebSocketManager cleanup_expired_browsers method."""

    def test_cleanup_expired_browsers_returns_uuid_list(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup_expired_browsers returns list of expired UUIDs.

        Given: Multiple expired browser registrations
        When: cleanup_expired_browsers is called
        Then: Returns list of expired UUID strings
        """
        expired_uuids = [generate_uuid() for _ in range(3)]

        for test_uuid in expired_uuids:
            ws_manager.register_browser(test_uuid, websocket=None, ttl_hours=0)

        # Wait for expiration
        time.sleep(0.1)

        # Cleanup
        removed_uuids = ws_manager.cleanup_expired_browsers()

        # Should return all expired UUIDs
        assert len(removed_uuids) == 3
        assert set(removed_uuids) == set(expired_uuids)

    def test_cleanup_expired_browsers_removes_from_manager(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup actually removes UUIDs from manager.

        Given: Expired browser registration
        When: cleanup_expired_browsers is called
        Then: UUID is removed from internal storage
        """
        test_uuid = generate_uuid()

        ws_manager.register_browser(test_uuid, websocket=None, ttl_hours=0)

        # Wait for expiration
        time.sleep(0.1)

        # Verify it's expired
        assert not ws_manager.is_browser_valid(test_uuid)

        # Cleanup
        removed_uuids = ws_manager.cleanup_expired_browsers()

        assert test_uuid in removed_uuids

        # Verify it's completely removed
        assert test_uuid not in ws_manager._uuid_manager._browsers

    def test_cleanup_preserves_valid_browsers(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup doesn't remove valid browsers.

        Given: Mix of expired and valid browser registrations
        When: cleanup_expired_browsers is called
        Then: Only expired browsers are removed
        """
        expired_uuid = generate_uuid()
        valid_uuid = generate_uuid()

        ws_manager.register_browser(expired_uuid, websocket=None, ttl_hours=0)
        ws_manager.register_browser(valid_uuid, websocket=None, ttl_hours=24)

        # Wait for expiration
        time.sleep(0.1)

        # Cleanup
        removed_uuids = ws_manager.cleanup_expired_browsers()

        # Only expired should be removed
        assert expired_uuid in removed_uuids
        assert valid_uuid not in removed_uuids

        # Valid should still be accessible
        assert ws_manager.is_browser_valid(valid_uuid)


@pytest.mark.integration
class TestProcessManagerBrowserLookup:
    """Tests for ProcessManager.get_conversation_by_browser method."""

    def test_get_conversation_by_browser_finds_match(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that get_conversation_by_browser finds correct conversation.

        Given: A process registered with a browser_id
        When: get_conversation_by_browser is called with that browser_id
        Then: Returns the correct conversation_id
        """
        conv_id = generate_uuid()
        browser_id = generate_uuid()

        process_manager._processes[conv_id] = ProcessInfo(
            conversation_id=conv_id,
            browser_id=browser_id,
        )

        result = process_manager.get_conversation_by_browser(browser_id)

        assert result == conv_id

    def test_get_conversation_by_browser_returns_none_for_unknown(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that get_conversation_by_browser returns None for unknown browser.

        Given: No process registered with the given browser_id
        When: get_conversation_by_browser is called
        Then: Returns None
        """
        unknown_browser_id = generate_uuid()

        result = process_manager.get_conversation_by_browser(unknown_browser_id)

        assert result is None

    def test_get_conversation_by_browser_with_multiple_processes(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that get_conversation_by_browser finds correct match among multiple.

        Given: Multiple processes with different browser_ids
        When: get_conversation_by_browser is called
        Then: Returns the correct conversation_id
        """
        processes = [(generate_uuid(), generate_uuid()) for _ in range(3)]

        for conv_id, browser_id in processes:
            process_manager._processes[conv_id] = ProcessInfo(
                conversation_id=conv_id,
                browser_id=browser_id,
            )

        target_conv_id, target_browser_id = processes[1]
        result = process_manager.get_conversation_by_browser(target_browser_id)

        assert result == target_conv_id


@pytest.mark.integration
class TestConversationCleanupOnExpiration:
    """Tests for conversation cleanup when browser UUID expires."""

    def test_cleanup_triggers_conversation_cleanup_in_multi_process_mode(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that expired browser UUID triggers conversation cleanup.

        Given: An expired browser UUID with an associated conversation
        When: cleanup_expired_browsers is called
        Then: The conversation is deleted via agent_manager
        """
        browser_id = generate_uuid()
        conv_id = generate_uuid()

        ws_manager.register_browser(browser_id, websocket=None, ttl_hours=0)
        time.sleep(0.1)

        mock_process_manager = MagicMock()
        mock_process_manager.get_conversation_by_browser.return_value = conv_id

        mock_agent_manager = MagicMock()
        mock_agent_manager.multi_process_mode = True
        mock_agent_manager._process_manager = mock_process_manager

        with patch("server.agent.manager.agent_manager", mock_agent_manager):
            removed_uuids = ws_manager.cleanup_expired_browsers()

        assert browser_id in removed_uuids
        mock_process_manager.get_conversation_by_browser.assert_called_once_with(
            browser_id
        )
        mock_agent_manager.delete_conversation.assert_called_once_with(conv_id)

    def test_cleanup_skips_conversation_if_no_browser_match(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup skips conversation if no browser match found.

        Given: An expired browser UUID with no associated conversation
        When: cleanup_expired_browsers is called
        Then: No conversation deletion is attempted
        """
        browser_id = generate_uuid()

        ws_manager.register_browser(browser_id, websocket=None, ttl_hours=0)
        time.sleep(0.1)

        mock_process_manager = MagicMock()
        mock_process_manager.get_conversation_by_browser.return_value = None

        mock_agent_manager = MagicMock()
        mock_agent_manager.multi_process_mode = True
        mock_agent_manager._process_manager = mock_process_manager

        with patch("server.agent.manager.agent_manager", mock_agent_manager):
            removed_uuids = ws_manager.cleanup_expired_browsers()

        assert browser_id in removed_uuids
        mock_agent_manager.delete_conversation.assert_not_called()

    def test_cleanup_skips_conversation_in_single_process_mode(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup skips conversation in single-process mode.

        Given: Single-process mode (no process_manager)
        When: cleanup_expired_browsers is called
        Then: No conversation deletion is attempted
        """
        browser_id = generate_uuid()

        ws_manager.register_browser(browser_id, websocket=None, ttl_hours=0)
        time.sleep(0.1)

        mock_agent_manager = MagicMock()
        mock_agent_manager.multi_process_mode = False
        mock_agent_manager._process_manager = None

        with patch("server.agent.manager.agent_manager", mock_agent_manager):
            removed_uuids = ws_manager.cleanup_expired_browsers()

        assert browser_id in removed_uuids
        mock_agent_manager.delete_conversation.assert_not_called()

    def test_cleanup_handles_conversation_deletion_error(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test that cleanup handles errors during conversation deletion.

        Given: An expired browser UUID where conversation deletion fails
        When: cleanup_expired_browsers is called
        Then: Error is logged and cleanup continues
        """
        browser_id = generate_uuid()
        conv_id = generate_uuid()

        ws_manager.register_browser(browser_id, websocket=None, ttl_hours=0)
        time.sleep(0.1)

        mock_process_manager = MagicMock()
        mock_process_manager.get_conversation_by_browser.return_value = conv_id

        mock_agent_manager = MagicMock()
        mock_agent_manager.multi_process_mode = True
        mock_agent_manager._process_manager = mock_process_manager
        mock_agent_manager.delete_conversation.side_effect = Exception(
            "Deletion failed"
        )

        with patch("server.agent.manager.agent_manager", mock_agent_manager):
            removed_uuids = ws_manager.cleanup_expired_browsers()

        assert browser_id in removed_uuids
        mock_agent_manager.delete_conversation.assert_called_once_with(conv_id)

    def test_cleanup_multiple_expired_browsers_with_conversations(
        self, ws_manager: WebSocketManager
    ) -> None:
        """Test cleanup of multiple expired browsers with conversations.

        Given: Multiple expired browser UUIDs with associated conversations
        When: cleanup_expired_browsers is called
        Then: All conversations are deleted
        """
        browser_ids = [generate_uuid() for _ in range(3)]
        conv_ids = [generate_uuid() for _ in range(3)]

        for browser_id in browser_ids:
            ws_manager.register_browser(browser_id, websocket=None, ttl_hours=0)
        time.sleep(0.1)

        mock_process_manager = MagicMock()
        mock_process_manager.get_conversation_by_browser.side_effect = conv_ids

        mock_agent_manager = MagicMock()
        mock_agent_manager.multi_process_mode = True
        mock_agent_manager._process_manager = mock_process_manager

        with patch("server.agent.manager.agent_manager", mock_agent_manager):
            removed_uuids = ws_manager.cleanup_expired_browsers()

        assert len(removed_uuids) == 3
        assert set(removed_uuids) == set(browser_ids)
        assert mock_agent_manager.delete_conversation.call_count == 3
