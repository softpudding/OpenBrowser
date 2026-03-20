"""End-to-end tests for UUID flow from extension to server.

These tests verify the complete UUID registration and validation flow
between the browser extension and the server, using mocked extension behavior.

Note: These tests avoid importing the full FastAPI app to prevent
dependency issues with openhands.tools module.
"""

import re
import time
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from server.core.uuid_manager import BrowserInfo, UUIDManager


# ============================================================================
# Mock Extension Client
# ============================================================================


class MockExtensionClient:
    """Mock browser extension client for E2E testing.

    Simulates the extension's UUID generation and registration behavior
    without requiring an actual Chrome browser.
    """

    def __init__(self):
        self.uuid: str | None = None
        self.registered = False
        self.websocket = None

    def generate_uuid(self) -> str:
        """Generate a UUID4 string (mimics extension's crypto.randomUUID())."""
        import uuid

        self.uuid = str(uuid.uuid4())
        return self.uuid

    async def register_with_server(self, server_url: str, ttl_hours: int = 24) -> dict:
        """Register this extension with the server.

        In a real extension, this would:
        1. Connect via WebSocket
        2. Send UUID to server via HTTP POST

        For testing, we simulate this by calling the server API directly.
        """
        if not self.uuid:
            self.generate_uuid()

        # Simulate HTTP registration
        # In real extension: fetch(`${serverUrl}/api/browsers/register`, {...})
        self.registered = True
        return {
            "success": True,
            "uuid": self.uuid,
            "ttl_hours": ttl_hours,
        }


# ============================================================================
# Request/Response Models
# ============================================================================


class BrowserRegisterRequest(BaseModel):
    """Request model for browser registration."""

    uuid: str
    connection_id: str = "mock_connection_0"
    ttl_hours: int = 24


class BrowserRegisterResponse(BaseModel):
    """Response model for browser registration."""

    success: bool
    uuid: str
    message: str


class BrowserValidityResponse(BaseModel):
    """Response model for browser validity check."""

    success: bool
    uuid: str
    valid: bool
    message: str


# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def uuid_manager() -> UUIDManager:
    """Create fresh UUIDManager for each test."""
    return UUIDManager()


@pytest.fixture
def test_app(uuid_manager: UUIDManager) -> FastAPI:
    """Create minimal FastAPI app for testing UUID routes."""
    app = FastAPI()

    # Mock WebSocket manager
    class MockWSManager:
        def __init__(self, uuid_mgr: UUIDManager):
            self._uuid_manager = uuid_mgr
            self.connections = []
            self._connection_counter = 0

        def is_connected(self) -> bool:
            return True

        def register_browser(self, uuid: str, websocket, ttl_hours: int = 24) -> None:
            self._uuid_manager.register_browser(uuid, websocket, ttl_hours)

        def is_browser_valid(self, uuid: str) -> bool:
            return self._uuid_manager.is_valid(uuid)

        def unregister_browser(self, uuid: str) -> bool:
            return self._uuid_manager.unregister_browser(uuid)

        def get_websocket_by_connection_id(self, connection_id: str):
            try:
                idx = int(connection_id.split("_")[-1])
            except (ValueError, IndexError):
                idx = len(self.connections)
            while len(self.connections) <= idx:
                self.connections.append(MagicMock())
            return self.connections[idx]

    ws_manager = MockWSManager(uuid_manager)

    @app.post("/browsers/register", response_model=BrowserRegisterResponse)
    async def register_browser(request: BrowserRegisterRequest):
        """Register a browser with UUID."""
        if not request.uuid or len(request.uuid) < 8:
            raise HTTPException(
                status_code=400, detail="UUID must be at least 8 characters"
            )

        if not ws_manager.is_connected():
            raise HTTPException(
                status_code=503, detail="No WebSocket connection available"
            )

        websocket = ws_manager.get_websocket_by_connection_id(request.connection_id)
        ws_manager.register_browser(
            uuid=request.uuid, websocket=websocket, ttl_hours=request.ttl_hours
        )

        return BrowserRegisterResponse(
            success=True,
            uuid=request.uuid,
            message=f"Browser registered successfully with TTL of {request.ttl_hours} hours",
        )

    @app.get("/browsers/{uuid}/valid", response_model=BrowserValidityResponse)
    async def check_browser_validity(uuid: str):
        """Check if a browser UUID is valid."""
        is_valid = ws_manager.is_browser_valid(uuid)

        return BrowserValidityResponse(
            success=True,
            uuid=uuid,
            valid=is_valid,
            message="Browser UUID is valid"
            if is_valid
            else "Browser UUID is invalid or expired",
        )

    @app.delete("/browsers/{uuid}")
    async def unregister_browser(uuid: str):
        """Unregister a browser by UUID."""
        success = ws_manager.unregister_browser(uuid)

        if success:
            return {"success": True, "uuid": uuid, "message": "Browser unregistered"}
        else:
            raise HTTPException(
                status_code=404, detail=f"Browser with UUID {uuid} not found"
            )

    return app


@pytest.fixture
def client(test_app: FastAPI) -> TestClient:
    """Create test client."""
    return TestClient(test_app)


class TestUUIDGeneration:
    """Tests for UUID generation (extension side)."""

    def test_extension_generates_valid_uuid_format(self) -> None:
        """Test that extension generates a valid UUID4 string."""
        client = MockExtensionClient()
        uuid_str = client.generate_uuid()

        # UUID4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        )
        assert uuid_pattern.match(uuid_str) is not None

    def test_extension_generates_unique_uuids(self) -> None:
        """Test that each extension instance generates unique UUIDs."""
        uuids = set()
        for _ in range(100):
            client = MockExtensionClient()
            uuid_str = client.generate_uuid()
            uuids.add(uuid_str)

        assert len(uuids) == 100

    def test_extension_persists_uuid(self) -> None:
        """Test that extension persists UUID across sessions.

        In real extension, this is stored in chrome.storage.local.
        For testing, we verify the mock client maintains UUID.
        """
        client = MockExtensionClient()
        uuid1 = client.generate_uuid()

        # Same client should return same UUID
        assert client.uuid == uuid1

        # UUID should remain stable
        assert client.uuid == uuid1


class TestUUIDRegistration:
    """Tests for UUID registration flow (extension to server)."""

    def test_extension_registers_with_server(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        extension = MockExtensionClient()
        uuid_str = extension.generate_uuid()

        response = client.post(
            "/browsers/register",
            json={"uuid": uuid_str, "ttl_hours": 24},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["uuid"] == uuid_str

        extension.registered = True

    def test_server_validates_registered_uuid(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        extension = MockExtensionClient()
        uuid_str = extension.generate_uuid()

        client.post(
            "/browsers/register",
            json={"uuid": uuid_str, "ttl_hours": 24},
        )

        response = client.get(f"/browsers/{uuid_str}/valid")

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True

    def test_server_rejects_unregistered_uuid(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        fake_uuid = "not-registered-uuid-1234"

        response = client.get(f"/browsers/{fake_uuid}/valid")

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False


class TestUUIDExpiration:
    """Tests for UUID expiration handling."""

    @pytest.fixture
    def uuid_manager(self) -> UUIDManager:
        """Create fresh UUIDManager for each test."""
        return UUIDManager()

    def test_uuid_expires_after_ttl(self, uuid_manager: UUIDManager) -> None:
        """Test that UUID expires after TTL."""
        mock_websocket = MagicMock()
        uuid_str = uuid_manager.generate_uuid()

        # Register with very short TTL
        uuid_manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)

        # Wait for expiration
        time.sleep(0.1)

        # UUID should be expired
        assert uuid_manager.is_valid(uuid_str) is False

    def test_server_handles_expired_uuid(self, uuid_manager: UUIDManager) -> None:
        """Test that server handles expired UUID correctly."""
        mock_websocket = MagicMock()
        uuid_str = uuid_manager.generate_uuid()

        # Register with very short TTL
        uuid_manager.register_browser(uuid_str, mock_websocket, ttl_hours=0)
        time.sleep(0.1)

        # Should return None for expired UUID
        result = uuid_manager.get_websocket(uuid_str)
        assert result is None

    def test_cleanup_removes_expired_uuids(self, uuid_manager: UUIDManager) -> None:
        """Test that cleanup removes expired UUIDs."""
        mock_websocket = MagicMock()

        # Register two browsers: one expired, one valid
        # IMPORTANT: Use different websockets - a websocket can only have one active capability token
        expired_uuid = uuid_manager.generate_uuid()
        valid_uuid = uuid_manager.generate_uuid()
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()

        uuid_manager.register_browser(expired_uuid, mock_ws1, ttl_hours=0)
        time.sleep(0.1)  # Ensure expired before registering valid
        uuid_manager.register_browser(valid_uuid, mock_ws2, ttl_hours=24)

        # Cleanup should remove expired
        count = uuid_manager.cleanup_expired()

        assert count == 1
        assert uuid_manager.is_valid(expired_uuid) is False
        assert uuid_manager.is_valid(valid_uuid) is True


class TestMultipleBrowsers:
    """Tests for multiple browser registration."""

    @pytest.fixture
    def uuid_manager(self) -> UUIDManager:
        """Create fresh UUIDManager for each test."""
        return UUIDManager()

    def test_multiple_browsers_can_register(self, uuid_manager: UUIDManager) -> None:
        """Test that multiple browsers can register independently."""
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()
        mock_ws3 = MagicMock()

        # Register three browsers
        uuid1 = uuid_manager.generate_uuid()
        uuid2 = uuid_manager.generate_uuid()
        uuid3 = uuid_manager.generate_uuid()

        uuid_manager.register_browser(uuid1, mock_ws1, ttl_hours=24)
        uuid_manager.register_browser(uuid2, mock_ws2, ttl_hours=24)
        uuid_manager.register_browser(uuid3, mock_ws3, ttl_hours=24)

        # All should be valid
        assert uuid_manager.is_valid(uuid1) is True
        assert uuid_manager.is_valid(uuid2) is True
        assert uuid_manager.is_valid(uuid3) is True

        # Each should have its own WebSocket
        assert uuid_manager.get_websocket(uuid1) == mock_ws1
        assert uuid_manager.get_websocket(uuid2) == mock_ws2
        assert uuid_manager.get_websocket(uuid3) == mock_ws3

    def test_unregister_one_browser_does_not_affect_others(
        self, uuid_manager: UUIDManager
    ) -> None:
        """Test that unregistering one browser doesn't affect others."""
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()

        uuid1 = uuid_manager.generate_uuid()
        uuid2 = uuid_manager.generate_uuid()

        uuid_manager.register_browser(uuid1, mock_ws1, ttl_hours=24)
        uuid_manager.register_browser(uuid2, mock_ws2, ttl_hours=24)

        # Unregister first browser
        result = uuid_manager.unregister_browser(uuid1)

        assert result is True
        assert uuid_manager.is_valid(uuid1) is False
        assert uuid_manager.is_valid(uuid2) is True

    def test_browser_count_is_accurate(self, uuid_manager: UUIDManager) -> None:
        """Test that browser count is accurate."""
        mock_ws1 = MagicMock()
        mock_ws2 = MagicMock()

        assert uuid_manager.get_browser_count() == 0

        uuid1 = uuid_manager.generate_uuid()
        uuid_manager.register_browser(uuid1, mock_ws1, ttl_hours=24)
        assert uuid_manager.get_browser_count() == 1

        uuid2 = uuid_manager.generate_uuid()
        uuid_manager.register_browser(uuid2, mock_ws2, ttl_hours=24)
        assert uuid_manager.get_browser_count() == 2

        uuid_manager.unregister_browser(uuid1)
        assert uuid_manager.get_browser_count() == 1


class TestUUIDFlowIntegration:
    """Integration tests for complete UUID flow."""

    def test_complete_flow_register_validate_unregister(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        extension = MockExtensionClient()
        uuid_str = extension.generate_uuid()

        register_response = client.post(
            "/browsers/register",
            json={"uuid": uuid_str, "ttl_hours": 24},
        )
        assert register_response.status_code == 200
        assert register_response.json()["success"] is True

        valid_response = client.get(f"/browsers/{uuid_str}/valid")
        assert valid_response.status_code == 200
        assert valid_response.json()["valid"] is True

        unregister_response = client.delete(f"/browsers/{uuid_str}")
        assert unregister_response.status_code == 200
        assert unregister_response.json()["success"] is True

        final_valid_response = client.get(f"/browsers/{uuid_str}/valid")
        assert final_valid_response.status_code == 200
        assert final_valid_response.json()["valid"] is False

    def test_multiple_extensions_complete_flow(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        extensions = [MockExtensionClient() for _ in range(3)]
        uuids = []

        for i, ext in enumerate(extensions):
            uuid_str = ext.generate_uuid()
            uuids.append(uuid_str)

            response = client.post(
                "/browsers/register",
                json={
                    "uuid": uuid_str,
                    "connection_id": f"mock_connection_{i}",
                    "ttl_hours": 24,
                },
            )
            assert response.status_code == 200

        for uuid_str in uuids:
            response = client.get(f"/browsers/{uuid_str}/valid")
            assert response.json()["valid"] is True

        client.delete(f"/browsers/{uuids[0]}")

        response = client.get(f"/browsers/{uuids[0]}/valid")
        assert response.json()["valid"] is False

        for uuid_str in uuids[1:]:
            response = client.get(f"/browsers/{uuid_str}/valid")
            assert response.json()["valid"] is True

    def test_reregistration_after_unregister(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        extension = MockExtensionClient()
        uuid_str = extension.generate_uuid()

        response = client.post(
            "/browsers/register",
            json={"uuid": uuid_str, "ttl_hours": 24},
        )
        assert response.status_code == 200

        client.delete(f"/browsers/{uuid_str}")

        response = client.post(
            "/browsers/register",
            json={"uuid": uuid_str, "ttl_hours": 24},
        )
        assert response.status_code == 200

        response = client.get(f"/browsers/{uuid_str}/valid")
        assert response.json()["valid"] is True


class TestUUIDValidationEdgeCases:
    """Tests for UUID validation edge cases."""

    def test_register_with_short_uuid_fails(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        response = client.post(
            "/browsers/register",
            json={"uuid": "short", "ttl_hours": 24},
        )

        assert response.status_code == 400

    def test_register_with_empty_uuid_fails(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        response = client.post(
            "/browsers/register",
            json={"uuid": "", "ttl_hours": 24},
        )

        assert response.status_code == 400

    def test_register_without_websocket_fails(self, uuid_manager: UUIDManager) -> None:
        app_no_conn = FastAPI()

        class MockWSManagerNoConn:
            def __init__(self, uuid_mgr: UUIDManager):
                self._uuid_manager = uuid_mgr
                self.connections = []

            def is_connected(self) -> bool:
                return False

            def register_browser(self, uuid, websocket, ttl_hours=24):
                pass

        ws_manager = MockWSManagerNoConn(uuid_manager)

        @app_no_conn.post("/browsers/register", response_model=BrowserRegisterResponse)
        async def register_browser(request: BrowserRegisterRequest):
            if not request.uuid or len(request.uuid) < 8:
                raise HTTPException(
                    status_code=400, detail="UUID must be at least 8 characters"
                )
            if not ws_manager.is_connected():
                raise HTTPException(
                    status_code=503, detail="No WebSocket connection available"
                )
            return BrowserRegisterResponse(
                success=True, uuid=request.uuid, message="OK"
            )

        test_client = TestClient(app_no_conn)
        response = test_client.post(
            "/browsers/register",
            json={"uuid": "valid-uuid-string", "ttl_hours": 24},
        )

        assert response.status_code == 503

    def test_unregister_nonexistent_uuid_returns_404(
        self, client: TestClient, uuid_manager: UUIDManager
    ) -> None:
        response = client.delete("/browsers/nonexistent-uuid")

        assert response.status_code == 404
