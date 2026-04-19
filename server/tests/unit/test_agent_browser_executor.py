"""Regression tests for agent BrowserExecutor result handling."""

from types import SimpleNamespace

import server.agent.tools.browser_executor as browser_executor_module

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.agent.tools.highlight_tool import HighlightAction
from server.models.commands import (
    HoverElementCommand,
    SelectElementCommand,
    SwipeElementCommand,
)


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
        lambda element_id, intended_action=None: (
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
            text="hello",
            conversation_id="conv-input-pending",
        )
    )

    assert observation.success is True
    assert (
        observation.message
        == "Keyboard input action pending confirmation for element: inp123"
    )
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "keyboard_input"
    assert observation.pending_confirmation["element_id"] == "inp123"


def test_build_observation_marks_small_model_from_session_metadata(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-small-model"

    monkeypatch.setattr(
        browser_executor_module.session_manager,
        "get_session",
        lambda conversation_id: SimpleNamespace(
            metadata={"model": "dashscope/qwen3.5-flash"}
        ),
    )

    observation = executor._build_observation_from_result(
        result_dict={
            "success": True,
            "data": {
                "elements": [
                    {
                        "id": "abc123",
                        "type": "clickable",
                        "descriptor": {"tag": "button", "text": "Submit"},
                    }
                ],
                "totalElements": 1,
            },
        },
        message="Found clickable elements",
        highlighted_elements=[
            {
                "id": "abc123",
                "type": "clickable",
                "descriptor": {"tag": "button", "text": "Submit"},
            }
        ],
        total_elements=1,
        element_type="clickable",
    )

    assert observation.small_model is True
    assert '<button> "Submit"' in observation.to_llm_content[0].text


def test_build_observation_extracts_highlight_pagination_from_nested_data() -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-highlight-page"

    observation = executor._build_observation_from_result(
        result_dict={
            "success": True,
            "data": {
                "elements": [
                    {
                        "id": "abc123",
                        "type": "inputable",
                        "descriptor": {
                            "tag": "input",
                            "inputType": "search",
                        },
                    }
                ],
                "page": 2,
                "totalPages": 3,
                "totalElements": 7,
            },
        },
        message="Hovered element: hov123",
        element_id="hov123",
    )

    assert observation.page == 2
    assert observation.total_pages == 3
    assert observation.total_elements == 7
    assert "**Page**: 2/3" in observation.to_llm_content[0].text


def test_highlight_action_message_does_not_repeat_pagination(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-highlight-action"

    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: {
            "success": True,
            "data": {
                "elements": [
                    {
                        "id": "abc123",
                        "type": "inputable",
                        "descriptor": {
                            "tag": "input",
                            "inputType": "search",
                        },
                    }
                ],
                "page": 2,
                "totalPages": 2,
                "totalElements": 4,
                "screenshot": "data:image/png;base64,highlighted",
            },
        },
    )

    observation = executor._execute_action_sync(
        HighlightAction(
            element_type="any",
            page=2,
            conversation_id="conv-highlight-action",
        )
    )

    assert observation.message == "Found 1 interactive element"
    assert "**Page**: 2/2" in observation.to_llm_content[1].text
    assert "on page" not in observation.message
    assert "(total:" not in observation.message


def test_confirm_click_uses_pending_confirmation_state(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-click-confirm"
    executor._set_pending_confirmation(
        element_id="btn13",
        action_type="click",
        full_html="<button>Save</button>",
        extra_data={"tab_id": 456},
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {
            "success": True,
            "data": {"screenshot": "data:image/png;base64,clicked"},
        }

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
    assert captured["command"].tab_id == 456
    assert executor._get_pending_confirmation() is None


def test_click_always_requires_pending_confirmation_even_after_prior_confirm(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-click"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            "<button>Save</button>",
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
            tab_id=456,
            conversation_id="conv-repeat-click",
        )
    )

    assert observation.success is True
    assert observation.message == "Click action pending confirmation for element: 15"
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "click"
    assert observation.pending_confirmation["element_id"] == "15"


def test_unconfirmed_click_element_id_still_enters_pending_confirmation(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-placeholder"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
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
            conversation_id="conv-repeat-placeholder",
        )
    )

    assert observation.success is True
    assert observation.message == "Click action pending confirmation for element: 15"
    assert observation.pending_confirmation is not None
    assert (
        observation.pending_confirmation["full_html"] == "<element not found in cache>"
    )


def test_keyboard_input_always_requires_pending_confirmation_even_after_prior_confirm(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-repeat-input"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            '<input type="text" />',
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
            text="hello",
            tab_id=321,
            conversation_id="conv-repeat-input",
        )
    )

    assert observation.success is True
    assert (
        observation.message
        == "Keyboard input action pending confirmation for element: inp123"
    )
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "keyboard_input"
    assert observation.pending_confirmation["element_id"] == "inp123"


def test_click_pending_confirmation_records_corrected_element_id(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-corrected-click"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            "<button>Save</button>",
            "data:image/png;base64,corrected",
            "DO2",
            "Matched requested element ID 'D02' to 'DO2'.",
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
            element_id="D02",
            conversation_id="conv-corrected-click",
        )
    )

    assert observation.success is True
    assert (
        observation.message
        == "Click action pending confirmation for element: DO2 Matched requested element ID 'D02' to 'DO2'."
    )
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["element_id"] == "DO2"
    assert observation.pending_confirmation["requested_element_id"] == "D02"
    assert (
        observation.pending_confirmation["element_id_resolution_note"]
        == "Matched requested element ID 'D02' to 'DO2'."
    )


def test_confirmed_click_element_id_does_not_skip_keyboard_input_confirmation(
    monkeypatch,
) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-action-isolation"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
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


def test_confirmed_click_does_not_grant_next_click_shortcut(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-click-no-shortcut"
    executor._set_pending_confirmation(
        element_id="btn13",
        action_type="click",
        full_html="<button>Save</button>",
        extra_data={"tab_id": 456},
    )

    executed_commands = []

    def fake_execute(command):
        executed_commands.append(command)
        return {
            "success": True,
            "data": {"screenshot": "data:image/png;base64,clicked"},
        }

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    confirmed = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_click",
            conversation_id="conv-click-no-shortcut",
        )
    )

    assert confirmed.success is True
    assert confirmed.message == "Confirmed and clicked element: btn13"
    assert len(executed_commands) == 1

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            "<button>Save</button>",
            "data:image/png;base64,pending-again",
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    next_observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="click",
            element_id="btn13",
            tab_id=456,
            conversation_id="conv-click-no-shortcut",
        )
    )

    assert next_observation.success is True
    assert (
        next_observation.message
        == "Click action pending confirmation for element: btn13"
    )
    assert next_observation.pending_confirmation is not None
    assert next_observation.pending_confirmation["action_type"] == "click"


def test_select_sets_pending_confirmation(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-select-pending"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            '<select><option value="usa">USA</option></select>',
            "data:image/png;base64,select-pending",
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="select",
            element_id="sel123",
            value="usa",
            tab_id=987,
            conversation_id="conv-select-pending",
        )
    )

    assert observation.success is True
    assert observation.message == (
        "Select action pending confirmation for element: sel123. "
        "About to choose option 'usa'."
    )
    assert observation.pending_confirmation is not None
    assert observation.pending_confirmation["action_type"] == "select"
    assert observation.pending_confirmation["element_id"] == "sel123"
    assert observation.pending_confirmation["extra_data"]["value"] == "usa"
    assert observation.pending_confirmation["extra_data"]["tab_id"] == 987


def test_select_multi_value_pending_confirmation_renders_list(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-select-multi-pending"

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            '<select multiple><option value="a">A</option></select>',
            None,
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="select",
            element_id="sel456",
            value=["a", "b"],
            conversation_id="conv-select-multi-pending",
        )
    )

    assert observation.success is True
    assert observation.message == (
        "Select action pending confirmation for element: sel456. "
        "About to choose option ['a', 'b']."
    )
    assert observation.pending_confirmation["extra_data"]["value"] == ["a", "b"]


def test_confirm_select_uses_pending_confirmation_state(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-select-confirm"
    executor._set_pending_confirmation(
        element_id="sel123",
        action_type="select",
        full_html='<select><option value="usa">USA</option></select>',
        extra_data={"value": "usa", "tab_id": 987},
    )

    captured = {}

    def fake_execute(command):
        captured["command"] = command
        return {
            "success": True,
            "data": {"screenshot": "data:image/png;base64,selected"},
        }

    monkeypatch.setattr(executor, "_execute_command_sync", fake_execute)

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_select",
            conversation_id="conv-select-confirm",
        )
    )

    assert observation.success is True
    assert (
        observation.message == "Confirmed and selected option 'usa' in element: sel123"
    )
    assert isinstance(captured["command"], SelectElementCommand)
    assert captured["command"].element_id == "sel123"
    assert captured["command"].value == "usa"
    assert captured["command"].tab_id == 987
    assert executor._get_pending_confirmation() is None


def test_confirm_select_without_pending_confirmation_raises(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-select-missing"

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="confirm_select",
            conversation_id="conv-select-missing",
        )
    )

    assert observation.success is False
    assert "No pending select confirmation found" in observation.error


def test_select_after_pending_click_clears_old_confirmation(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-select-supersedes-click"
    executor._set_pending_confirmation(
        element_id="btn99",
        action_type="click",
        full_html="<button>Save</button>",
        extra_data={"tab_id": 1},
    )

    monkeypatch.setattr(
        executor,
        "_get_element_full_html",
        lambda element_id, intended_action=None: (
            '<select><option value="x">X</option></select>',
            None,
        ),
    )
    monkeypatch.setattr(
        executor,
        "_execute_command_sync",
        lambda command: (_ for _ in ()).throw(AssertionError("should stay in 2PC")),
    )

    observation = executor._execute_action_sync(
        ElementInteractionAction(
            action="select",
            element_id="sel789",
            value="x",
            conversation_id="conv-select-supersedes-click",
        )
    )

    assert observation.success is True
    assert observation.pending_confirmation["action_type"] == "select"
    assert observation.pending_confirmation["element_id"] == "sel789"


def test_confirm_keyboard_input_reports_nested_extension_error(monkeypatch) -> None:
    executor = BrowserExecutor()
    executor.conversation_id = "conv-input-error"
    executor._set_pending_confirmation(
        element_id="inp123",
        action_type="keyboard_input",
        full_html='<input type="text" />',
        extra_data={
            "text": "hello world",
            "tab_id": 321,
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
    assert observation.error == "Failed to input text: Input element is detached"
    assert captured["command"].element_id == "inp123"
    assert captured["command"].tab_id == 321
    assert "None" not in observation.message
