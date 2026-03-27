"""Tests for explicit user-help requests."""

import queue
from unittest.mock import patch

from openhands.sdk.event import ActionEvent, MessageEvent
from openhands.sdk.llm import Message, MessageToolCall, TextContent

from server.agent.user_help import build_completion_event_payload
from server.agent.visualizer import QueueVisualizer
from server.agent.tools.help_tool import PleaseHelpMeAction


def _help_action_event(message: str) -> ActionEvent:
    tool_call = MessageToolCall(
        id="call-help-1",
        name="please_help_me",
        arguments='{"message": "ignored"}',
        origin="completion",
    )
    return ActionEvent(
        source="agent",
        thought=[TextContent(text="Need help")],
        action=PleaseHelpMeAction(message=message),
        tool_name="please_help_me",
        tool_call_id="call-help-1",
        tool_call=tool_call,
        llm_response_id="resp-help-1",
    )


def test_build_completion_event_payload_marks_pending_user_help() -> None:
    payload = build_completion_event_payload(
        "conv-help-1",
        [_help_action_event("Please solve the CAPTCHA, then reply ok.")],
    )

    assert payload == {
        "conversation_id": "conv-help-1",
        "message": "Agent is waiting for user help",
        "needs_user_help": True,
        "help_request": "Please solve the CAPTCHA, then reply ok.",
        "tool_call_id": "call-help-1",
    }


def test_build_completion_event_payload_clears_after_user_reply() -> None:
    payload = build_completion_event_payload(
        "conv-help-2",
        [
            _help_action_event("Please approve the login."),
            MessageEvent(
                source="user",
                llm_message=Message(role="user", content=[TextContent(text="done")]),
            ),
        ],
    )

    assert payload == {
        "conversation_id": "conv-help-2",
        "message": "Conversation completed",
    }


def test_visualizer_surfaces_structured_help_request_fields() -> None:
    event_queue: queue.Queue = queue.Queue()
    visualizer = QueueVisualizer(event_queue=event_queue, conversation_id="conv-help-3")

    with patch("server.agent.visualizer.session_manager.save_event", return_value=True):
        visualizer.on_event(_help_action_event("Please complete MFA and reply done."))

    sse_event = event_queue.get_nowait()

    assert sse_event.event_type == "agent_event"
    assert sse_event.data["type"] == "ActionEvent"
    assert sse_event.data["tool_name"] == "please_help_me"
    assert sse_event.data["tool_call_id"] == "call-help-1"
    assert sse_event.data["help_request"] == "Please complete MFA and reply done."
    assert sse_event.data["awaiting_user_help"] is True
    assert sse_event.data["source"] == "agent"
