"""Unit tests for WebSocketManager UUID methods."""

import time
from unittest.mock import MagicMock

import pytest

from server.websocket.manager import WebSocketManager


class TestWebSocketManagerUUID:
    """Tests for WebSocketManager UUID methods."""

    def test_register_browser_stores_browser_info(self) -> None:
        """Test that register_browser stores browser info correctly."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "test-uuid-1234"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        assert manager.is_browser_valid(uuid_str) is True
        result = manager.get_browser_websocket(uuid_str)
        assert result == mock_websocket

    def test_register_browser_default_ttl(self) -> None:
        """Test that register_browser uses default TTL of 24 hours."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "test-uuid-5678"

        before = time.time()
        manager.register_browser(uuid_str, mock_websocket)
        after = time.time()

        assert manager.is_browser_valid(uuid_str) is True
        ws = manager.get_browser_websocket(uuid_str)
        assert ws == mock_websocket

    def test_get_browser_websocket_returns_websocket_for_valid_uuid(self) -> None:
        """Test that get_browser_websocket returns WebSocket for valid UUID."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "valid-uuid"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)
        result = manager.get_browser_websocket(uuid_str)

        assert result == mock_websocket

    def test_get_browser_websocket_returns_none_for_unknown_uuid(self) -> None:
        """Test that get_browser_websocket returns None for unknown UUID."""
        manager = WebSocketManager()

        result = manager.get_browser_websocket("unknown-uuid")

        assert result is None

    def test_get_browser_websocket_returns_none_for_expired_uuid(self) -> None:
        """Test that get_browser_websocket returns None for expired UUID."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "expired-uuid"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)
        time.sleep(0.1)

        result = manager.get_browser_websocket(uuid_str)

        assert result is None

    def test_is_browser_valid_returns_true_for_valid_uuid(self) -> None:
        """Test that is_browser_valid returns True for valid UUID."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "valid-browser-uuid"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        assert manager.is_browser_valid(uuid_str) is True

    def test_is_browser_valid_returns_false_for_unknown_uuid(self) -> None:
        """Test that is_browser_valid returns False for unknown UUID."""
        manager = WebSocketManager()

        assert manager.is_browser_valid("unknown-uuid") is False

    def test_is_browser_valid_returns_false_for_expired_uuid(self) -> None:
        """Test that is_browser_valid returns False for expired UUID."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "expired-browser-uuid"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)
        time.sleep(0.1)

        assert manager.is_browser_valid(uuid_str) is False

    def test_unregister_browser_removes_browser(self) -> None:
        """Test that unregister_browser removes browser."""
        manager = WebSocketManager()
        mock_websocket = MagicMock()
        uuid_str = "to-unregister"

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)
        result = manager.unregister_browser(uuid_str)

        assert result is True
        assert manager.is_browser_valid(uuid_str) is False

    def test_unregister_browser_returns_false_for_unknown(self) -> None:
        """Test that unregister_browser returns False for unknown UUID."""
        manager = WebSocketManager()

        result = manager.unregister_browser("unknown-uuid")

        assert result is False

    def test_multiple_browsers_can_be_registered(self) -> None:
        """Test that multiple browsers can be registered."""
        manager = WebSocketManager()
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()
        uuid1 = "browser-1"
        uuid2 = "browser-2"

        manager.register_browser(uuid1, mock_ws1, ttl_hours=24)
        manager.register_browser(uuid2, mock_ws2, ttl_hours=24)

        assert manager.is_browser_valid(uuid1) is True
        assert manager.is_browser_valid(uuid2) is True
        assert manager.get_browser_websocket(uuid1) == mock_ws1
        assert manager.get_browser_websocket(uuid2) == mock_ws2

    def test_unregister_one_browser_does_not_affect_others(self) -> None:
        """Test that unregistering one browser doesn't affect others."""
        manager = WebSocketManager()
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()
        uuid1 = "browser-a"
        uuid2 = "browser-b"

        manager.register_browser(uuid1, mock_ws1, ttl_hours=24)
        manager.register_browser(uuid2, mock_ws2, ttl_hours=24)
        manager.unregister_browser(uuid1)

        assert manager.is_browser_valid(uuid1) is False
        assert manager.is_browser_valid(uuid2) is True
        assert manager.get_browser_websocket(uuid2) == mock_ws2
