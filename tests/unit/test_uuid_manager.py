"""Unit tests for UUIDManager."""

import re
import time
from unittest.mock import MagicMock

import pytest

from server.core.uuid_manager import BrowserInfo, UUIDManager


class TestUUIDManager:
    """Tests for UUIDManager class."""

    def test_generate_uuid_returns_valid_format(self) -> None:
        """Test that generate_uuid returns a valid UUID4 string."""
        manager = UUIDManager()
        uuid_str = manager.generate_uuid()

        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
        assert uuid_pattern.match(uuid_str) is not None

    def test_generate_uuid_returns_unique_values(self) -> None:
        """Test that generate_uuid returns unique values."""
        manager = UUIDManager()
        uuids = {manager.generate_uuid() for _ in range(100)}
        assert len(uuids) == 100

    def test_register_browser_stores_browser_info(self) -> None:
        """Test that register_browser stores browser info correctly."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        assert uuid_str in manager._browsers
        browser_info = manager._browsers[uuid_str]
        assert browser_info.uuid == uuid_str
        assert browser_info.websocket == mock_websocket
        assert browser_info.registered_at > 0
        assert browser_info.expires_at > browser_info.registered_at

    def test_register_browser_default_ttl(self) -> None:
        """Test that register_browser uses default TTL of 24 hours."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()

        before = time.time()
        manager.register_browser(uuid_str, mock_websocket)
        after = time.time()

        browser_info = manager._browsers[uuid_str]
        expected_min = before + (24 * 3600)
        expected_max = after + (24 * 3600)
        assert expected_min <= browser_info.expires_at <= expected_max

    def test_get_websocket_returns_websocket_for_valid_uuid(self) -> None:
        """Test that get_websocket returns WebSocket for valid UUID."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()
        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        result = manager.get_websocket(uuid_str)

        assert result == mock_websocket

    def test_get_websocket_returns_none_for_unknown_uuid(self) -> None:
        """Test that get_websocket returns None for unknown UUID."""
        manager = UUIDManager()

        result = manager.get_websocket("unknown-uuid")

        assert result is None

    def test_get_websocket_returns_none_for_expired_uuid(self) -> None:
        """Test that get_websocket returns None for expired UUID."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)
        time.sleep(0.1)

        result = manager.get_websocket(uuid_str)

        assert result is None

    def test_is_valid_returns_true_for_valid_uuid(self) -> None:
        """Test that is_valid returns True for valid UUID."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()
        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        assert manager.is_valid(uuid_str) is True

    def test_is_valid_returns_false_for_unknown_uuid(self) -> None:
        """Test that is_valid returns False for unknown UUID."""
        manager = UUIDManager()

        assert manager.is_valid("unknown-uuid") is False

    def test_is_valid_returns_false_for_expired_uuid(self) -> None:
        """Test that is_valid returns False for expired UUID."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()

        manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)
        time.sleep(0.1)

        assert manager.is_valid(uuid_str) is False

    def test_cleanup_expired_removes_expired_browsers(self) -> None:
        """Test that cleanup_expired removes expired browsers."""
        manager = UUIDManager()
        mock_websocket = MagicMock()

        uuid_expired = manager.generate_uuid()
        uuid_valid = manager.generate_uuid()

        manager.register_browser(uuid_expired, mock_websocket, ttl_hours=0)
        manager.register_browser(uuid_valid, mock_websocket, ttl_hours=24)
        time.sleep(0.1)

        count = manager.cleanup_expired()

        assert count == 1
        assert uuid_expired not in manager._browsers
        assert uuid_valid in manager._browsers

    def test_cleanup_expired_returns_zero_when_no_expired(self) -> None:
        """Test that cleanup_expired returns 0 when no expired browsers."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()
        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        count = manager.cleanup_expired()

        assert count == 0

    def test_unregister_browser_removes_browser(self) -> None:
        """Test that unregister_browser removes browser."""
        manager = UUIDManager()
        mock_websocket = MagicMock()
        uuid_str = manager.generate_uuid()
        manager.register_browser(uuid_str, mock_websocket, ttl_hours=24)

        result = manager.unregister_browser(uuid_str)

        assert result is True
        assert uuid_str not in manager._browsers

    def test_unregister_browser_returns_false_for_unknown(self) -> None:
        """Test that unregister_browser returns False for unknown UUID."""
        manager = UUIDManager()

        result = manager.unregister_browser("unknown-uuid")

        assert result is False

    def test_get_browser_count_returns_correct_count(self) -> None:
        """Test that get_browser_count returns correct count."""
        manager = UUIDManager()
        mock_websocket = MagicMock()

        assert manager.get_browser_count() == 0

        uuid1 = manager.generate_uuid()
        manager.register_browser(uuid1, mock_websocket, ttl_hours=24)
        assert manager.get_browser_count() == 1

        uuid2 = manager.generate_uuid()
        manager.register_browser(uuid2, mock_websocket, ttl_hours=24)
        assert manager.get_browser_count() == 2

        manager.unregister_browser(uuid1)
        assert manager.get_browser_count() == 1


class TestBrowserInfo:
    """Tests for BrowserInfo dataclass."""

    def test_browser_info_creation(self) -> None:
        """Test BrowserInfo dataclass creation."""
        mock_websocket = MagicMock()
        now = time.time()

        info = BrowserInfo(
            uuid="test-uuid",
            websocket=mock_websocket,
            registered_at=now,
            expires_at=now + 3600,
        )

        assert info.uuid == "test-uuid"
        assert info.websocket == mock_websocket
        assert info.registered_at == now
        assert info.expires_at == now + 3600
