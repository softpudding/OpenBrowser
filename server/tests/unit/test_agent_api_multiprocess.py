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
        "images": None,
    }
    assert any("event: agent_event" in payload for payload in sse_payloads)
    assert any("event: complete" in payload for payload in sse_payloads)
    mock_session_manager.update_session_status.assert_any_call(
        "conv-123", SessionStatus.ACTIVE, increment_message_count=True
    )
    mock_session_manager.update_session_status.assert_any_call(
        "conv-123", SessionStatus.IDLE
    )


@pytest.mark.asyncio
async def test_process_agent_message_persists_usage_metrics_for_history() -> None:
    """Thread-mode streaming should persist usage metrics for session replay."""
    with (
        patch("server.agent.api.agent_manager") as mock_manager,
        patch("server.agent.api.session_manager") as mock_session_manager,
        patch(
            "server.agent.api.build_completion_event_payload",
            return_value={
                "conversation_id": "conv-456",
                "message": "Conversation completed",
            },
        ),
    ):
        mock_manager.multi_process_mode = False

        mock_visualizer = MagicMock()
        mock_conversation = MagicMock()
        mock_conversation.run = MagicMock()
        mock_conversation.close = MagicMock()
        mock_conversation.state.events = []

        mock_combined_metrics = MagicMock()
        mock_combined_metrics.get.return_value = {"accumulated_cost": 1.25}
        mock_combined_metrics.model_name = "dashscope/qwen3.5-plus"

        mock_stats = MagicMock()
        mock_stats.get_combined_metrics.return_value = mock_combined_metrics
        mock_conversation.conversation_stats = mock_stats

        mock_conv_state = MagicMock(
            conversation=mock_conversation,
            visualizer=mock_visualizer,
        )
        mock_manager.get_or_create_conversation.return_value = mock_conv_state

        sse_payloads = [
            payload
            async for payload in process_agent_message(
                "conv-456",
                "hello thread",
                cwd="/tmp/workspace",
            )
        ]

    assert any("event: complete" in payload for payload in sse_payloads)
    assert any("event: usage_metrics" in payload for payload in sse_payloads)
    mock_session_manager.save_event.assert_called_once_with(
        conversation_id="conv-456",
        event_type="usage_metrics",
        event_data={
            "conversation_id": "conv-456",
            "metrics": {
                "accumulated_cost": 1.25,
                "model_name": "dashscope/qwen3.5-plus",
            },
        },
    )
