import sys
import importlib.util
from pathlib import Path

import pytest
from openhands.sdk import TextContent, ImageContent

BASE_MODULE_PATH = Path(__file__).parent.parent.parent / "agent" / "tools" / "base.py"

spec = importlib.util.spec_from_file_location("base", BASE_MODULE_PATH)
assert spec is not None and spec.loader is not None
base_module = importlib.util.module_from_spec(spec)
sys.modules["server.agent.tools.base"] = base_module
spec.loader.exec_module(base_module)

OpenBrowserAction = base_module.OpenBrowserAction
OpenBrowserObservation = base_module.OpenBrowserObservation


class TestOpenBrowserAction:
    def test_action_has_conversation_id(self) -> None:
        action = OpenBrowserAction()
        assert hasattr(action, "conversation_id")
        assert action.conversation_id is None

    def test_action_with_conversation_id(self) -> None:
        action = OpenBrowserAction(conversation_id="test-conv-123")
        assert action.conversation_id == "test-conv-123"

    def test_action_is_serializable(self) -> None:
        action = OpenBrowserAction(conversation_id="conv-456")
        data = action.model_dump()
        assert data["conversation_id"] == "conv-456"


class TestOpenBrowserObservation:
    def test_observation_has_required_fields(self) -> None:
        obs = OpenBrowserObservation(success=True)
        assert obs.success is True
        assert obs.screenshot_data_url is None
        assert obs.message is None
        assert obs.error is None
        assert obs.tabs == []

    def test_observation_with_all_fields(self) -> None:
        obs = OpenBrowserObservation(
            success=True,
            screenshot_data_url="data:image/png;base64,abc123",
            message="Operation completed",
            error=None,
            tabs=[{"id": 1, "url": "https://example.com"}],
        )
        assert obs.success is True
        assert obs.screenshot_data_url == "data:image/png;base64,abc123"
        assert obs.message == "Operation completed"
        assert obs.error is None
        assert len(obs.tabs) == 1

    def test_observation_failed_state(self) -> None:
        obs = OpenBrowserObservation(
            success=False,
            error="Connection refused",
        )
        assert obs.success is False
        assert obs.error == "Connection refused"

    def test_to_llm_content_success(self) -> None:
        obs = OpenBrowserObservation(success=True, message="Tab opened")
        content = obs.to_llm_content

        assert len(content) == 1
        assert isinstance(content[0], TextContent)
        assert "**Status**: SUCCESS" in content[0].text
        assert "**Action**: Tab opened" in content[0].text

    def test_to_llm_content_failure(self) -> None:
        obs = OpenBrowserObservation(success=False, error="Tab not found")
        content = obs.to_llm_content

        assert len(content) == 1
        assert isinstance(content[0], TextContent)
        assert "**Status**: FAILED" in content[0].text
        assert "**Error**: Tab not found" in content[0].text

    def test_to_llm_content_with_screenshot(self) -> None:
        obs = OpenBrowserObservation(
            success=True,
            screenshot_data_url="data:image/png;base64,testimg",
        )
        content = obs.to_llm_content

        assert len(content) == 2
        assert isinstance(content[0], TextContent)
        assert isinstance(content[1], ImageContent)
        assert content[1].image_urls == ["data:image/png;base64,testimg"]

    def test_to_llm_content_markdown_format(self) -> None:
        obs = OpenBrowserObservation(
            success=True,
            message="Element clicked",
            tabs=[{"id": 1, "url": "https://example.com"}],
        )
        content = obs.to_llm_content
        text = content[0].text

        assert "## Operation Status" in text
        assert "**Status**: SUCCESS" in text
        assert "**Action**: Element clicked" in text

    def test_observation_is_serializable(self) -> None:
        obs = OpenBrowserObservation(
            success=True,
            message="Done",
            tabs=[{"id": 1}],
        )
        data = obs.model_dump()
        assert data["success"] is True
        assert data["message"] == "Done"
        assert data["tabs"] == [{"id": 1}]
