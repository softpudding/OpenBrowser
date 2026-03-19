"""Unit tests for API routes with UUID support."""

from unittest.mock import MagicMock, patch, AsyncMock
import pytest
from fastapi.testclient import TestClient

from server.api.main import app
from server.websocket.manager import ws_manager
from server.models.commands import CommandResponse


class TestBrowserRegistrationEndpoint:
    """Tests for browser registration endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def mock_ws_manager(self):
        """Mock WebSocketManager."""
        with patch("server.api.routes.browsers.ws_manager") as mock:
            yield mock

    def test_register_browser_success(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test successful browser registration."""
        mock_ws_manager.is_connected.return_value = True
        mock_ws_manager.connections = [MagicMock()]
        mock_ws_manager.register_browser.return_value = None
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/browsers/register",
            json={"uuid": "test-browser-uuid-123", "ttl_hours": 24},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["uuid"] == "test-browser-uuid-123"
        mock_ws_manager.register_browser.assert_called_once()

    def test_register_browser_no_websocket(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test registration fails when no WebSocket connection."""
        mock_ws_manager.is_connected.return_value = False

        response = client.post(
            "/browsers/register",
            json={"uuid": "test-browser-uuid-456", "ttl_hours": 24},
        )

        assert response.status_code == 503

    def test_register_browser_invalid_uuid(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test registration fails with invalid UUID format."""
        mock_ws_manager.is_connected.return_value = True

        response = client.post(
            "/browsers/register", json={"uuid": "short", "ttl_hours": 24}
        )

        assert response.status_code == 400


class TestBrowserValidityEndpoint:
    """Tests for browser validity check endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def mock_ws_manager(self):
        """Mock WebSocketManager."""
        with patch("server.api.routes.browsers.ws_manager") as mock:
            yield mock

    def test_check_validity_valid_browser(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test validity check for valid browser."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.get("/browsers/valid-browser-uuid/valid")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["valid"] is True
        assert data["uuid"] == "valid-browser-uuid"

    def test_check_validity_invalid_browser(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test validity check for invalid browser."""
        mock_ws_manager.is_browser_valid.return_value = False

        response = client.get("/browsers/invalid-browser-uuid/valid")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["valid"] is False


class TestConversationCreationWithBrowserId:
    """Tests for conversation creation with browser_id."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def mock_ws_manager(self):
        """Mock WebSocketManager."""
        with patch("server.api.routes.agent.ws_manager") as mock:
            yield mock

    @pytest.fixture
    def mock_agent_manager(self):
        """Mock agent manager."""
        with patch("server.api.routes.agent.create_agent_conversation") as mock:
            mock.return_value = "test-conversation-id"
            yield mock

    def test_create_conversation_with_valid_browser_id(
        self, client: TestClient, mock_ws_manager, mock_agent_manager
    ) -> None:
        """Test conversation creation with valid browser_id."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/agent/conversations",
            json={"cwd": ".", "browser_id": "valid-browser-uuid"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["browser_id"] == "valid-browser-uuid"
        mock_ws_manager.is_browser_valid.assert_called_once_with("valid-browser-uuid")

    def test_create_conversation_with_invalid_browser_id(
        self, client: TestClient, mock_ws_manager, mock_agent_manager
    ) -> None:
        """Test conversation creation fails with invalid browser_id."""
        mock_ws_manager.is_browser_valid.return_value = False

        response = client.post(
            "/agent/conversations",
            json={"cwd": ".", "browser_id": "invalid-browser-uuid"},
        )

        assert response.status_code == 400

    def test_create_conversation_without_browser_id(
        self, client: TestClient, mock_ws_manager, mock_agent_manager
    ) -> None:
        """Test conversation creation without browser_id (backward compatibility)."""
        response = client.post("/agent/conversations", json={"cwd": "."})

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "browser_id" not in data


class TestCommandExecutionWithBrowserId:
    """Tests for command execution with browser_id validation."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def mock_ws_manager(self):
        """Mock WebSocketManager."""
        with patch("server.api.routes.commands.ws_manager") as mock:
            yield mock

    @pytest.fixture
    def mock_processor(self):
        """Mock command processor."""
        with patch("server.api.routes.commands.command_processor") as mock:
            mock_response = CommandResponse(
                success=True,
                command_id="test-command-id",
                message="Command executed successfully",
            )
            mock.execute = AsyncMock(return_value=mock_response)
            yield mock

    def test_execute_command_with_valid_browser_id(
        self, client: TestClient, mock_ws_manager, mock_processor
    ) -> None:
        """Test command execution with valid browser_id."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/command", json={"type": "screenshot", "browser_id": "valid-browser-uuid"}
        )

        assert response.status_code == 200
        mock_ws_manager.is_browser_valid.assert_called_once_with("valid-browser-uuid")

    def test_execute_command_with_invalid_browser_id(
        self, client: TestClient, mock_ws_manager, mock_processor
    ) -> None:
        """Test command execution fails with invalid browser_id."""
        mock_ws_manager.is_browser_valid.return_value = False

        response = client.post(
            "/command",
            json={"type": "screenshot", "browser_id": "invalid-browser-uuid"},
        )

        assert response.status_code == 400

    def test_execute_command_without_browser_id(
        self, client: TestClient, mock_ws_manager, mock_processor
    ) -> None:
        """Test command execution without browser_id (backward compatibility)."""
        response = client.post("/command", json={"type": "screenshot"})

        assert response.status_code == 200
        mock_ws_manager.is_browser_valid.assert_not_called()
