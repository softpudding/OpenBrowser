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
        mock_ws_manager.get_websocket_by_connection_id.return_value = MagicMock()
        mock_ws_manager.register_browser.return_value = None
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/browsers/register",
            json={
                "uuid": "test-browser-uuid-123",
                "connection_id": "conn-123",
                "ttl_hours": 24,
            },
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
        mock_ws_manager.get_websocket_by_connection_id.return_value = None

        response = client.post(
            "/browsers/register",
            json={
                "uuid": "test-browser-uuid-456",
                "connection_id": "stale-conn",
                "ttl_hours": 24,
            },
        )

        assert response.status_code == 400

    def test_register_browser_invalid_uuid(
        self, client: TestClient, mock_ws_manager
    ) -> None:
        """Test registration fails with invalid UUID format."""
        mock_ws_manager.get_websocket_by_connection_id.return_value = MagicMock()

        response = client.post(
            "/browsers/register",
            json={"uuid": "short", "connection_id": "conn-123", "ttl_hours": 24},
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

    def test_create_conversation_passes_model_alias(
        self, client: TestClient, mock_ws_manager, mock_agent_manager
    ) -> None:
        """Selected model alias should be forwarded to conversation creation."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/agent/conversations",
            json={
                "cwd": ".",
                "browser_id": "valid-browser-uuid",
                "model_alias": "flash",
            },
        )

        assert response.status_code == 200
        mock_agent_manager.assert_called_once_with(
            cwd=".",
            model=None,
            base_url=None,
            browser_id="valid-browser-uuid",
            model_alias="flash",
            mode=None,
        )

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

    def test_create_conversation_with_empty_body_uses_defaults(
        self, client: TestClient, mock_ws_manager, mock_agent_manager
    ) -> None:
        """Creating a conversation with no JSON body should still use route defaults."""
        response = client.post("/agent/conversations")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["cwd"] == "."
        mock_agent_manager.assert_called_once_with(
            cwd=".",
            model=None,
            base_url=None,
            browser_id=None,
            model_alias=None,
            mode=None,
        )


class TestAgentMessageBrowserBinding:
    """Tests for browser binding behavior on agent message streaming."""

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
    def mock_session_manager(self):
        """Mock SessionManager used by agent routes."""
        with patch("server.api.routes.agent.session_manager") as mock:
            yield mock

    @pytest.fixture
    def mock_process_agent_message(self):
        """Mock SSE generator for agent messages."""

        async def _fake_sse(*args, **kwargs):
            yield 'event: message\ndata: {"ok": true}\n\n'

        with patch(
            "server.api.routes.agent.process_agent_message", side_effect=_fake_sse
        ) as mock:
            yield mock

    def test_message_post_uses_bound_browser_id_when_request_omits_it(
        self,
        client: TestClient,
        mock_ws_manager,
        mock_session_manager,
        mock_process_agent_message,
    ) -> None:
        """Bound conversations should not require browser_id on every message POST."""
        mock_session_manager.get_session.return_value = MagicMock(
            metadata={"browser_id": "bound-browser-uuid"}
        )
        mock_ws_manager.is_browser_valid.return_value = True

        with client.stream(
            "POST",
            "/agent/conversations/test-conversation/messages",
            json={"text": "hello from bound conversation"},
        ) as response:
            body = "".join(response.iter_text())

        assert response.status_code == 200
        assert "event: message" in body
        mock_process_agent_message.assert_called_once_with(
            "test-conversation",
            "hello from bound conversation",
            ".",
            images=None,
        )

    def test_message_post_rejects_rebinding_conversation_to_different_browser(
        self,
        client: TestClient,
        mock_ws_manager,
        mock_session_manager,
        mock_process_agent_message,
    ) -> None:
        """A conversation already bound to one browser must not be rebound by POSTing another valid UUID."""
        mock_session_manager.get_session.return_value = MagicMock(
            metadata={"browser_id": "browser-a"}
        )
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post(
            "/agent/conversations/test-conversation/messages",
            json={"text": "should fail", "browser_id": "browser-b"},
        )

        assert response.status_code == 403
        mock_session_manager.update_session_metadata.assert_not_called()
        mock_process_agent_message.assert_not_called()


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
    def mock_session_manager(self):
        """Mock SessionManager used by command routes."""
        with patch("server.api.routes.commands.session_manager") as mock:
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
        """Test command execution without browser_id is rejected."""
        response = client.post("/command", json={"type": "screenshot"})

        assert response.status_code == 400
        mock_ws_manager.is_browser_valid.assert_not_called()

    def test_execute_command_rejects_rebinding_bound_conversation(
        self,
        client: TestClient,
        mock_ws_manager,
        mock_session_manager,
        mock_processor,
    ) -> None:
        """A bound conversation should reject commands sent with a different valid browser UUID."""
        mock_ws_manager.is_browser_valid.return_value = True
        mock_session_manager.get_session.return_value = MagicMock(
            metadata={"browser_id": "browser-a"}
        )

        response = client.post(
            "/command",
            json={
                "type": "screenshot",
                "conversation_id": "test-conversation",
                "browser_id": "browser-b",
            },
        )

        assert response.status_code == 403
        mock_processor.execute.assert_not_called()

    def test_screenshot_endpoint_requires_conversation_id_in_strict_mode(
        self, client: TestClient, mock_ws_manager, mock_processor
    ) -> None:
        """The convenience screenshot route should not pretend to work without conversation_id."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.post("/screenshot", params={"browser_id": "valid-browser"})

        assert response.status_code == 400
        mock_processor.execute.assert_not_called()

    def test_get_tabs_endpoint_requires_conversation_id_when_managed_only(
        self, client: TestClient, mock_ws_manager, mock_processor
    ) -> None:
        """Managed tab listing should require conversation_id to match extension strict mode."""
        mock_ws_manager.is_browser_valid.return_value = True

        response = client.get("/tabs", params={"browser_id": "valid-browser"})

        assert response.status_code == 400
        mock_processor.execute.assert_not_called()
