"""Regression tests for agent BrowserExecutor result handling."""

import server.agent.tools.browser_executor as browser_executor_module

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.models.commands import HoverElementCommand, SwipeElementCommand


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


def test_hover_executes_without_confirmation(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-hover-direct"

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {"success": True, "data": {"screenshot": "data:image/png;base64,abc"}}

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="hover",
            element_id="hov123",
            conversation_id="conv-hover-direct",
        )
    )

    assert observation.success is True
    assert observation.message == "Hovered element: hov123"
    assert observation.pending_confirmation is None
    assert isinstance(captured["command"], HoverElementCommand)
    assert executor._get_pending_confirmation() is None


def test_keyboard_input_sets_pending_confirmation(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-pending"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id: ('<input type="text" />', "data:image/png;base64,pending"),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should not execute yet")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="keyboard_input",
            element_id="inp123",
            text="hello",
            conversation_id="conv-input-pending",
        )
    )

    assert observation.success is True
    assert observation.message == "Keyboard input action pending confirmation for element: inp123"
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "keyboard_input"
    assert observation.pending_confirmation["element_id"] == "inp123"


def test_confirm_keyboard_input_reports_nested_extension_error(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-error"
    executor._set_pending_confirmation(
        element_id="inp123",
        action_type="keyboard_input",
        full_html='<input type="text" />',
        extra_data={"text": "hello world"},
    )

    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: {
            "success": False,
            "error": None,
            "data": {"error": "Input element is detached"},
        },
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_keyboard_input",
            element_id="inp123",
            conversation_id="conv-input-error",
        )
    )

    assert observation.success is False
    assert (
        observation.error
        == "Failed to input text: Input element is detached"
    )
    assert "None" not in observation.message
