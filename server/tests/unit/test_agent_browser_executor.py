"""Regression tests for agent BrowserExecutor result handling."""

import server.agent.tools.browser_executor as browser_executor_module

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.models.commands import SwipeElementCommand


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


def test_execute_command_sync_promotes_nested_error_to_top_level(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-swipe-error"

    monkeypatch.setattr(
        browser_executor_module.requests,
        "post",
        lambda *args, **kwargs: _FakeResponse(
            {
                "success": False,
                "error": None,
                "data": {"error": "No swipeable container found for element"},
            }
        ),
    )

    result = executor._execute_command_sync(
        SwipeElementCommand(
            element_id="swp123",
            direction="next",
            conversation_id="conv-swipe-error",
        )
    )

    assert result["error"] == "No swipeable container found for element"


def test_confirm_swipe_reports_nested_extension_error(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-swipe-error"
    executor._set_pending_confirmation(
        element_id="swp123",
        action_type="swipe",
        full_html='<div class="swiper"></div>',
        extra_data={"direction": "next", "swipe_count": 1},
    )

    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: {
            "success": False,
            "error": None,
            "data": {"error": "No swipeable container found for element"},
        },
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_swipe",
            element_id="swp123",
            conversation_id="conv-swipe-error",
        )
    )

    assert observation.success is False
    assert (
        observation.error
        == "Failed to swipe element: No swipeable container found for element"
    )
    assert "None" not in observation.message
