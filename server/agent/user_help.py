"""Helpers for explicit agent-to-human help requests."""

from collections.abc import Sequence
from typing import Any

from openhands.sdk.event import ActionEvent, MessageEvent
from openhands.sdk.event.base import Event


PLEASE_HELP_ME_TOOL_NAME = "please_help_me"


def get_pending_user_help_request(events: Sequence[Event]) -> dict[str, Any] | None:
    """Return the latest unresolved help request for the current turn, if any."""
    for event in reversed(events):
        if isinstance(event, MessageEvent) and event.source == "user":
            return None

        if (
            isinstance(event, ActionEvent)
            and event.source == "agent"
            and event.tool_name == PLEASE_HELP_ME_TOOL_NAME
        ):
            action = event.action
            message = getattr(action, "message", None)
            if not isinstance(message, str) or not message.strip():
                message = "The agent needs your help before it can continue."

            return {
                "message": message,
                "tool_call_id": event.tool_call_id,
            }

    return None


def build_completion_event_payload(
    conversation_id: str, events: Sequence[Event]
) -> dict[str, Any]:
    """Build the SSE completion payload for a finished run."""
    help_request = get_pending_user_help_request(events)
    if help_request is not None:
        return {
            "conversation_id": conversation_id,
            "message": "Agent is waiting for user help",
            "needs_user_help": True,
            "help_request": help_request["message"],
            "tool_call_id": help_request["tool_call_id"],
        }

    return {
        "conversation_id": conversation_id,
        "message": "Conversation completed",
    }
