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

    def test_stop_recording_rejects_disconnected_browser(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Stop should fail instead of silently marking the session stopped."""
        session = temp_recording_manager.create_recording(browser_id="browser-123")

        with (
            patch(
                "server.api.routes.recordings.recording_manager",
                temp_recording_manager,
            ),
            patch(
                "server.api.routes.recordings.ws_manager.is_browser_valid",
                return_value=False,
            ),
        ):
            response = client.post(f"/recordings/{session.recording_id}/stop")

        assert response.status_code == 409
        updated = temp_recording_manager.get_recording(session.recording_id)
        assert updated is not None
        assert updated.status == RecordingStatus.ACTIVE

    def test_workflow_draft_compiles_normalized_steps(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Workflow draft should merge raw form events and extract inputs."""
        session = temp_recording_manager.create_recording(
            browser_id="browser-123",
            name="Search flow",
        )

        events = [
            {
                "event_type": "page_view",
                "event_data": {
                    "timestamp": 1000,
                    "page": {"url": "https://example.com", "title": "Example"},
                },
            },
            {
                "event_type": "focus",
                "event_data": {
                    "timestamp": 1100,
                    "element": {
                        "selector": "#search",
                        "placeholder": "Search",
                    },
                },
            },
            {
                "event_type": "input",
                "event_data": {
                    "timestamp": 1200,
                    "element": {
                        "selector": "#search",
                        "value": "openbrowser",
                        "placeholder": "Search",
                        "isSensitive": False,
                    },
                },
            },
            {
                "event_type": "change",
                "event_data": {
                    "timestamp": 1250,
                    "element": {
                        "selector": "#search",
                        "value": "openbrowser",
                        "placeholder": "Search",
                        "isSensitive": False,
                    },
                },
            },
            {
                "event_type": "submit",
                "event_data": {
                    "timestamp": 1300,
                    "form": {"selector": "form.search-form"},
                },
            },
        ]

        for index, event in enumerate(events):
            temp_recording_manager.save_recording_event(
                recording_id=session.recording_id,
                event_type=event["event_type"],
                event_data=event["event_data"],
                event_index=index,
            )

        with patch(
            "server.api.routes.recordings.recording_manager",
            temp_recording_manager,
        ):
            response = client.get(f"/recordings/{session.recording_id}/workflow-draft")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["normalized_step_count"] == 2

        steps = data["normalized_steps"]
        assert steps[0]["type"] == "navigate"
        assert steps[0]["executor_preference"] == "agent"
        assert steps[1]["type"] == "form"
        assert steps[1]["action"] == "form_fill_submit"
        assert steps[1]["executor_preference"] == "agent"
        assert steps[1]["source_event_indexes"] == [1, 2, 3, 4]

        workflow = data["workflow"]
        assert workflow["goal"]["text"] == "Search flow"
        assert workflow["executor_preference"] == "agent"
        assert len(workflow["inputs"]) == 1
        assert workflow["inputs"][0]["name"] == "input_1"
        assert workflow["inputs"][0]["default"] == "openbrowser"

    def test_workflow_draft_keeps_significant_scroll_before_action(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Meaningful scroll clusters before a same-page action become high-level steps."""
        session = temp_recording_manager.create_recording(
            browser_id="browser-123",
            name="Scroll and inspect",
        )

        events = [
            {
                "event_type": "page_view",
                "event_data": {
                    "timestamp": 1000,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                },
            },
            {
                "event_type": "scroll",
                "event_data": {
                    "timestamp": 1100,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                    "scrollX": 0,
                    "scrollY": 560,
                    "maxScrollY": 2400,
                },
            },
            {
                "event_type": "scroll",
                "event_data": {
                    "timestamp": 1200,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                    "scrollX": 0,
                    "scrollY": 1180,
                    "maxScrollY": 2400,
                },
            },
            {
                "event_type": "click",
                "event_data": {
                    "timestamp": 1300,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                    "element": {
                        "selector": ".post-card button.open",
                        "text": "Open",
                    },
                },
            },
        ]

        for index, event in enumerate(events):
            temp_recording_manager.save_recording_event(
                recording_id=session.recording_id,
                event_type=event["event_type"],
                event_data=event["event_data"],
                event_index=index,
            )

        with patch(
            "server.api.routes.recordings.recording_manager",
            temp_recording_manager,
        ):
            response = client.get(
                f"/recordings/{session.recording_id}/workflow-draft"
            )

        assert response.status_code == 200
        steps = response.json()["workflow"]["steps"]

        assert [step["action"] for step in steps] == [
            "navigate",
            "scroll_to_reveal",
            "click",
        ]
        assert steps[1]["type"] == "scroll"
        assert steps[1]["target"]["direction"] == "down"
        assert steps[1]["target"]["reveals_for_next_action"] == "click"
        assert steps[1]["source_event_indexes"] == [1, 2]
        assert steps[1]["executor_preference"] == "agent"

    def test_workflow_draft_discards_small_scroll_noise(
        self, client: TestClient, temp_recording_manager: RecordingManager
    ) -> None:
        """Small scroll movement without a strong execution effect stays out of the draft."""
        session = temp_recording_manager.create_recording(browser_id="browser-123")

        events = [
            {
                "event_type": "page_view",
                "event_data": {
                    "timestamp": 1000,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                },
            },
            {
                "event_type": "scroll",
                "event_data": {
                    "timestamp": 1100,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                    "scrollX": 0,
                    "scrollY": 120,
                    "maxScrollY": 2400,
                },
            },
            {
                "event_type": "click",
                "event_data": {
                    "timestamp": 1200,
                    "page": {"url": "https://example.com/feed", "title": "Feed"},
                    "element": {
                        "selector": ".toolbar button.like",
                        "text": "Like",
                    },
                },
            },
        ]

        for index, event in enumerate(events):
            temp_recording_manager.save_recording_event(
                recording_id=session.recording_id,
                event_type=event["event_type"],
                event_data=event["event_data"],
                event_index=index,
            )

        with patch(
            "server.api.routes.recordings.recording_manager",
            temp_recording_manager,
        ):
            response = client.get(
                f"/recordings/{session.recording_id}/workflow-draft"
            )

        assert response.status_code == 200
        steps = response.json()["workflow"]["steps"]
        assert [step["action"] for step in steps] == ["navigate", "click"]
