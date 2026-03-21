"""Unit tests for agent API multi-process streaming."""

import queue
from unittest.mock import MagicMock, patch

import pytest

from server.agent.api import process_agent_message
from server.api.sse import SSEEvent
from server.core.session_manager import SessionStatus


@pytest.mark.asyncio
async def test_process_agent_message_uses_worker_queues() -> None:
    """When multi-process mode is enabled, the API should stream from IPC."""
    command_queue: queue.Queue[dict] = queue.Queue()
    response_queue: queue.Queue[SSEEvent] = queue.Queue()
    response_queue.put(SSEEvent("agent_event", {"text": "hello"}))
    response_queue.put(
        SSEEvent(
            "complete",
            {
                "conversation_id": "conv-123",
                "message": "Conversation completed",
            },
        )
    )

    with (
        patch("server.agent.api.agent_manager") as mock_manager,
        patch("server.agent.api.session_manager") as mock_session_manager,
    ):
        mock_manager.multi_process_mode = True
        mock_manager.get_or_create_conversation.return_value = MagicMock()
        mock_manager.get_command_queue.return_value = command_queue
        mock_manager.get_response_queue.return_value = response_queue

        sse_payloads = [
            payload
            async for payload in process_agent_message(
                "conv-123",
                "hello worker",
                cwd="/tmp/workspace",
            )
        ]

    assert command_queue.get_nowait() == {
        "agent_message": "hello worker",
        "cwd": "/tmp/workspace",
    }
    assert any("event: agent_event" in payload for payload in sse_payloads)
    assert any("event: complete" in payload for payload in sse_payloads)
    mock_session_manager.update_session_status.assert_any_call(
        "conv-123", SessionStatus.ACTIVE, increment_message_count=True
    )
    mock_session_manager.update_session_status.assert_any_call(
        "conv-123", SessionStatus.IDLE
    )
