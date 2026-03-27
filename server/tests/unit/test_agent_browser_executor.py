"""Regression tests for agent BrowserExecutor result handling."""

import server.agent.tools.browser_executor as browser_executor_module

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.models.commands import ClickElementCommand, HoverElementCommand, SwipeElementCommand


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
            highlight_snapshot_id=17,
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
            highlight_snapshot_id=17,
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
        lambda element_id, highlight_snapshot_id: (
            '<input type="text" />',
            "data:image/png;base64,pending",
        ),
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
            highlight_snapshot_id=17,
            text="hello",
            conversation_id="conv-input-pending",
        )
    )

    assert observation.success is True
    assert observation.message == "Keyboard input action pending confirmation for element: inp123"
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "keyboard_input"
    assert observation.pending_confirmation["element_id"] == "inp123"
    assert observation.pending_confirmation["highlight_snapshot_id"] == 17


def test_confirm_click_uses_pending_confirmation_state(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-click-confirm"
    executor._set_pending_confirmation(
        element_id="btn13",
        highlight_snapshot_id=39,
        action_type="click",
        full_html="<button>Save</button>",
        extra_data={"tab_id": 456, "highlight_snapshot_id": 39},
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {"success": True, "data": {"screenshot": "data:image/png;base64,clicked"}}

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_click",
            conversation_id="conv-click-confirm",
        )
    )

    assert observation.success is True
    assert observation.message == "Confirmed and clicked element: btn13"
    assert captured["command"].element_id == "btn13"
    assert captured["command"].highlight_snapshot_id == 39
    assert captured["command"].tab_id == 456
    assert executor._get_pending_confirmation() is None


def test_repeat_click_with_confirmed_html_executes_without_pending_confirmation(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-click"
    executor._remember_confirmed_action_html(
        "click",
        '<a href="/gbr/articles/opinion-article2.html">Why the Fed Must Act Decisively</a>'
    )

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, highlight_snapshot_id: (
            '<a href="/gbr/articles/opinion-article2.html">Why the Fed Must Act Decisively</a>',
            "data:image/png;base64,repeat",
        ),
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {
            "success": True,
            "data": {"screenshot": "data:image/png;base64,clicked-direct"},
        }

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="click",
            element_id="15",
            highlight_snapshot_id=195,
            tab_id=456,
            conversation_id="conv-repeat-click",
        )
    )

    assert observation.success is True
    assert observation.message == "Clicked element: 15"
    assert observation.pending_confirmation is None
    assert isinstance(captured["command"], ClickElementCommand)
    assert captured["command"].element_id == "15"
    assert captured["command"].highlight_snapshot_id == 195
    assert captured["command"].tab_id == 456
    assert executor._get_pending_confirmation() is None


def test_repeat_click_does_not_shortcut_cache_miss_placeholder(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-placeholder"
    executor._remember_confirmed_action_html(
        "click", "<element not found in cache>"
    )

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, highlight_snapshot_id: (
            "<element not found in cache>",
            "data:image/png;base64,pending",
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="click",
            element_id="15",
            highlight_snapshot_id=195,
            conversation_id="conv-repeat-placeholder",
        )
    )

    assert observation.success is True
    assert observation.message == "Click action pending confirmation for element: 15"
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["full_html"] == "<element not found in cache>"


def test_confirmed_action_html_lru_keeps_only_most_recent_ten_entries() -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-lru"

    for i in range(11):
        executor._remember_confirmed_action_html("click", f"<button>Action {i}</button>")

    lru = executor._get_confirmed_action_html_lru("click")

    assert len(lru) == 10
    assert "<button>Action 0</button>" not in lru
    assert "<button>Action 10</button>" in lru


def test_repeat_keyboard_input_with_confirmed_html_executes_without_pending_confirmation(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-input"
    executor._remember_confirmed_action_html(
        "keyboard_input", '<input type="text" id="search-input" value="fed" />'
    )

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, highlight_snapshot_id: (
            '<input type="text" id="search-input" value="fed" />',
            "data:image/png;base64,input-repeat",
        ),
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {
            "success": True,
            "data": {"screenshot": "data:image/png;base64,input-direct"},
        }

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="keyboard_input",
            element_id="inp123",
            highlight_snapshot_id=17,
            text="hello",
            tab_id=321,
            conversation_id="conv-repeat-input",
        )
    )

    assert observation.success is True
    assert observation.message == "Input text to element: inp123"
    assert observation.pending_confirmation is None
    assert captured["command"].element_id == "inp123"
    assert captured["command"].highlight_snapshot_id == 17
    assert captured["command"].text == "hello"
    assert captured["command"].tab_id == 321
    assert executor._get_pending_confirmation() is None


def test_confirmed_click_html_does_not_skip_keyboard_input_confirmation(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-action-isolation"
    executor._remember_confirmed_action_html(
        "click", '<input type="text" id="search-input" value="fed" />'
    )

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, highlight_snapshot_id: (
            '<input type="text" id="search-input" value="fed" />',
            "data:image/png;base64,input-pending",
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="keyboard_input",
            element_id="inp123",
            highlight_snapshot_id=17,
            text="hello",
            conversation_id="conv-input-action-isolation",
        )
    )

    assert observation.success is True
    assert (
        observation.message
        == "Keyboard input action pending confirmation for element: inp123"
    )
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "keyboard_input"


def test_confirm_keyboard_input_reports_nested_extension_error(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-error"
    executor._set_pending_confirmation(
        element_id="inp123",
        highlight_snapshot_id=17,
        action_type="keyboard_input",
        full_html='<input type="text" />',
        extra_data={
            "text": "hello world",
            "tab_id": 321,
            "highlight_snapshot_id": 17,
        },
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {
            "success": False,
            "error": None,
            "data": {"error": "Input element is detached"},
        }

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_keyboard_input",
            conversation_id="conv-input-error",
        )
    )

    assert observation.success is False
    assert (
        observation.error
        == "Failed to input text: Input element is detached"
    )
    assert captured["command"].element_id == "inp123"
    assert captured["command"].highlight_snapshot_id == 17
    assert captured["command"].tab_id == 321
    assert "None" not in observation.message
