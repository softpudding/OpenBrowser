"""UUID Manager for browser identification with TTL support.

This module provides a simple in-memory UUID management system for tracking
browser instances with automatic expiration support.
"""

import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class BrowserInfo:
    """Information about a registered browser instance.

    Attributes:
        uuid: Unique identifier for the browser
        websocket: WebSocket connection to the browser extension (type-agnostic)
        registered_at: Unix timestamp when the browser was registered
        expires_at: Unix timestamp when the browser registration expires
    """

    uuid: str
    websocket: Any  # Type-agnostic: can be fastapi.WebSocket or websockets.WebSocketServerProtocol
    registered_at: float
    expires_at: float


class UUIDManager:
    """Manages UUID-based browser identification with TTL support.

    This class provides in-memory storage for browser instances identified
    by UUIDs, with automatic expiration based on TTL (time-to-live).

    Example:
        >>> manager = UUIDManager()
        >>> browser_uuid = manager.generate_uuid()
        >>> manager.register_browser(browser_uuid, websocket, ttl_hours=24)
        >>> ws = manager.get_websocket(browser_uuid)
        >>> manager.is_valid(browser_uuid)
        True
    """

    def __init__(self) -> None:
        """Initialize the UUID manager with empty browser registry."""
        self._browsers: dict[str, BrowserInfo] = {}

    def generate_uuid(self) -> str:
        """Generate a random UUID4 string.

        Returns:
            A UUID4 string in the format 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.
        """
        return str(uuid.uuid4())

    def register_browser(
        self, uuid_str: str, websocket: Any, ttl_hours: int = 24
    ) -> None:
        """Register a browser instance with TTL.

        Args:
            uuid_str: UUID string identifying the browser
            websocket: WebSocket connection to the browser extension
            ttl_hours: Time-to-live in hours (default: 24)
        """
        now = time.time()
        expires_at = now + (ttl_hours * 3600)

        # A browser websocket should only have one active capability token.
        self.unregister_websocket(websocket)

        self._browsers[uuid_str] = BrowserInfo(
            uuid=uuid_str, websocket=websocket, registered_at=now, expires_at=expires_at
        )

    def get_websocket(self, uuid_str: str) -> Optional[Any]:
        """Get the WebSocket connection for a browser UUID.

        Args:
            uuid_str: UUID string identifying the browser

        Returns:
            WebSocket connection if found and valid, None otherwise
        """
        browser_info = self._browsers.get(uuid_str)
        if browser_info is None:
            return None

        if time.time() > browser_info.expires_at:
            return None

        return browser_info.websocket

    def is_valid(self, uuid_str: str) -> bool:
        """Check if a UUID is valid and not expired.

        Args:
            uuid_str: UUID string to validate

        Returns:
            True if UUID exists and hasn't expired, False otherwise
        """
        browser_info = self._browsers.get(uuid_str)
        if browser_info is None:
            return False

        return time.time() <= browser_info.expires_at

    def cleanup_expired(self) -> int:
        """Remove all expired browser registrations.

        Returns:
            Number of expired browsers removed
        """
        now = time.time()
        expired_uuids = [
            uuid_str
            for uuid_str, info in self._browsers.items()
            if now > info.expires_at
        ]

        for uuid_str in expired_uuids:
            del self._browsers[uuid_str]

        return len(expired_uuids)

    def unregister_browser(self, uuid_str: str) -> bool:
        """Unregister a browser instance.

        Args:
            uuid_str: UUID string identifying the browser

        Returns:
            True if browser was unregistered, False if not found
        """
        if uuid_str in self._browsers:
            del self._browsers[uuid_str]
            return True
        return False

    def unregister_websocket(self, websocket: Any) -> list[str]:
        """Unregister all browsers associated with a websocket connection."""
        removed_uuids = [
            uuid_str
            for uuid_str, info in self._browsers.items()
            if info.websocket == websocket
        ]

        for uuid_str in removed_uuids:
            del self._browsers[uuid_str]

        return removed_uuids

    def get_browser_count(self) -> int:
        """Get the total number of registered browsers (including expired).

        Returns:
            Number of browsers in the registry
        """
        return len(self._browsers)
