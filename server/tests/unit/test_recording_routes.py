"""Unit tests for recording routes."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from server.api.main import app
from server.core.recording_manager import RecordingManager, RecordingStatus
from server.models.commands import CommandResponse


@pytest.fixture
def client() -> TestClient:
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def temp_recording_manager(tmp_path) -> RecordingManager:
    """Create an isolated recording manager backed by a temp SQLite file."""
    return RecordingManager(db_path=str(tmp_path / "recordings.db"))


class TestRecordingRoutes:
    """Tests for recording session endpoints."""

    def test_create_recording_success(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Creating a recording should persist the session and start the extension."""
        with (
            patch(
                "server.api.routes.recordings.recording_manager",
                temp_recording_manager,
            ),
            patch(
                "server.api.routes.recordings.ws_manager.is_browser_valid",
                return_value=True,
            ),
            patch(
                "server.api.routes.recordings.command_processor.execute",
                new=AsyncMock(
                    return_value=CommandResponse(success=True, data={"active": True})
                ),
            ) as mock_execute,
        ):
            response = client.post(
                "/recordings",
                json={"browser_id": "browser-123", "name": "Daily flow"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["recording"]["browser_id"] == "browser-123"
        assert data["recording"]["status"] == RecordingStatus.ACTIVE.value
        assert data["recording"]["metadata"]["launch_mode"] == "dedicated_window"
        assert mock_execute.await_count == 1
        command = mock_execute.await_args.args[0]
        assert command.launch_mode.value == "dedicated_window"

    def test_create_recording_supports_current_window_launch_mode(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Route should pass through an explicit current_window launch mode."""
        with (
            patch(
                "server.api.routes.recordings.recording_manager",
                temp_recording_manager,
            ),
            patch(
                "server.api.routes.recordings.ws_manager.is_browser_valid",
                return_value=True,
            ),
            patch(
                "server.api.routes.recordings.command_processor.execute",
                new=AsyncMock(
                    return_value=CommandResponse(success=True, data={"active": True})
                ),
            ) as mock_execute,
        ):
            response = client.post(
                "/recordings",
                json={
                    "browser_id": "browser-123",
                    "launch_mode": "current_window",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["recording"]["metadata"]["launch_mode"] == "current_window"
        command = mock_execute.await_args.args[0]
        assert command.launch_mode.value == "current_window"

    def test_create_recording_rejects_duplicate_active_browser(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """A browser can only have one active recording at a time."""
        temp_recording_manager.create_recording(browser_id="browser-123")

        with (
            patch(
                "server.api.routes.recordings.recording_manager",
                temp_recording_manager,
            ),
            patch(
                "server.api.routes.recordings.ws_manager.is_browser_valid",
                return_value=True,
            ),
        ):
            response = client.post("/recordings", json={"browser_id": "browser-123"})

        assert response.status_code == 409

    def test_append_recording_event_success(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Posting an event should store it under the recording trace."""
        session = temp_recording_manager.create_recording(browser_id="browser-123")

        with patch(
            "server.api.routes.recordings.recording_manager",
            temp_recording_manager,
        ):
            response = client.post(
                f"/recordings/{session.recording_id}/events",
                json={
                    "browser_id": "browser-123",
                    "event_type": "click",
                    "event_data": {"selector": "#submit"},
                },
            )

        assert response.status_code == 200
        events = temp_recording_manager.get_recording_events(session.recording_id)
        assert len(events) == 1
        assert events[0]["event_type"] == "click"
        assert events[0]["event_data"]["selector"] == "#submit"

    def test_stop_recording_marks_session_stopped(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Stopping a recording should mark it stopped after extension ack."""
        session = temp_recording_manager.create_recording(browser_id="browser-123")

        with (
            patch(
                "server.api.routes.recordings.recording_manager",
                temp_recording_manager,
            ),
            patch(
                "server.api.routes.recordings.ws_manager.is_browser_valid",
                return_value=True,
            ),
            patch(
                "server.api.routes.recordings.command_processor.execute",
                new=AsyncMock(return_value=CommandResponse(success=True)),
            ),
        ):
            response = client.post(f"/recordings/{session.recording_id}/stop")

        assert response.status_code == 200
        updated = temp_recording_manager.get_recording(session.recording_id)
        assert updated is not None
        assert updated.status == RecordingStatus.STOPPED
