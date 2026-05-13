"""
Queue-based Visualizer for SSE Streaming

Converts agent events to SSE events and puts them in a queue for streaming.
"""

import json
import logging
import queue
from typing import Any, Optional

from rich.text import Text
from openhands.sdk import Event, ImageContent
from openhands.sdk.conversation.visualizer.base import ConversationVisualizerBase
from openhands.sdk.event import (
    ActionEvent,
    ObservationEvent,
    MessageEvent,
)

from server.api.sse import SSEEvent
from server.agent.user_help import PLEASE_HELP_ME_TOOL_NAME
from server.core.session_manager import session_manager

logger = logging.getLogger(__name__)


class QueueVisualizer(ConversationVisualizerBase):
    """Visualizer that puts events into a queue for SSE streaming with event persistence"""

    def __init__(self, event_queue: queue.Queue = None, conversation_id: str = None):
        """
        Args:
            event_queue: queue.Queue to put visualized events into (can be set later)
            conversation_id: Conversation ID for event persistence
        """
        super().__init__()
        self.event_queue = event_queue
        self.conversation_id = conversation_id
        self.event_index = 0  # Track event index for ordering

    def set_event_queue(self, event_queue: queue.Queue) -> None:
        """Set the event queue (useful for delayed initialization)"""
        self.event_queue = event_queue

    def set_conversation_id(self, conversation_id: str) -> None:
        """Set conversation ID for event persistence"""
        self.conversation_id = conversation_id

    def on_event(self, event: Event) -> None:
        """Handle conversation events and put them into the queue"""
        logger.debug(
            f"QueueVisualizer.on_event called for event type: {type(event).__name__}"
        )

        if self.event_queue is None:
            logger.warning("QueueVisualizer.on_event called but event_queue is None")
            return

        try:
            # Get basic event information
            event_type = type(event).__name__
            content = event.visualize
            logger.debug(
                f"QueueVisualizer: content type {type(content)}, has plain? {hasattr(content, 'plain')}"
            )
            # Determine the best text representation
            if isinstance(content, Text):
                text_content = content.plain
                logger.debug("QueueVisualizer: using content.plain (Text)")
            elif content and hasattr(content, "plain"):
                text_content = content.plain
                logger.debug("QueueVisualizer: using content.plain (has plain)")
            else:
                text_content = str(event)
                logger.warning(
                    f"QueueVisualizer: falling back to str(event), content type: {type(content)}"
                )
            logger.debug(
                f"QueueVisualizer: text_content length {len(text_content)}, preview: {text_content[:200]}"
            )
            if "..." in text_content[-10:]:
                logger.warning(
                    f"QueueVisualizer: text_content ends with '...'! Full text: {text_content}"
                )

            # Build SSE data with common fields
            sse_data = {
                "type": event_type,
                "text": text_content,
                "timestamp": getattr(event, "timestamp", None),
                "source": getattr(event, "source", None),
            }

            # Handle different event types using isinstance for clarity
            # Note: ActionEvent, ObservationEvent, MessageEvent, SystemPromptEvent, etc.
            # all inherit from LLMConvertibleEvent
            # We use separate checks for specific event types to add their unique fields

            # Process specific event types (mutually exclusive)
            if isinstance(event, ActionEvent):
                sse_data["tool_name"] = event.tool_name
                sse_data["tool_call_id"] = event.tool_call_id
                # ActionEvent has action attribute
                if event.action:
                    sse_data["action"] = str(event.action)
                if event.summary:
                    sse_data["summary"] = str(event.summary)
                rc = getattr(event, "reasoning_content", None)
                if rc:
                    sse_data["reasoning_content"] = rc
                tbs = getattr(event, "thinking_blocks", None)
                if tbs:
                    sse_data["thinking_blocks"] = [tb.model_dump() for tb in tbs]
                if event.tool_name == PLEASE_HELP_ME_TOOL_NAME and event.action:
                    help_request = getattr(event.action, "message", None)
                    if isinstance(help_request, str) and help_request.strip():
                        sse_data["help_request"] = help_request
                        sse_data["awaiting_user_help"] = True

            elif isinstance(event, ObservationEvent):
                sse_data["tool_name"] = event.tool_name
                sse_data["tool_call_id"] = event.tool_call_id
                # ObservationEvent has observation attribute with possible image content
                obs = event.observation
                # Extract observation properties (same as original hasattr checks)
                if hasattr(obs, "success"):
                    sse_data["success"] = obs.success
                if hasattr(obs, "message"):
                    sse_data["message"] = obs.message
                if hasattr(obs, "error"):
                    sse_data["error"] = obs.error

                # Check for image content in observations from browser-related tools
                if hasattr(obs, "screenshot_data_url") and obs.screenshot_data_url:
                    sse_data["image"] = obs.screenshot_data_url
                elif hasattr(obs, "image_urls") and obs.image_urls:
                    sse_data["images"] = list(obs.image_urls)
                    sse_data["image"] = obs.image_urls[0]
                elif hasattr(obs, "image_url") and obs.image_url:
                    sse_data["image"] = obs.image_url
                elif hasattr(obs, "image") and obs.image:
                    sse_data["image"] = obs.image
                if event.tool_name == PLEASE_HELP_ME_TOOL_NAME:
                    sse_data["awaiting_user_help"] = True
                    help_request = getattr(obs, "help_message", None)
                    if isinstance(help_request, str) and help_request.strip():
                        sse_data["help_request"] = help_request

            elif isinstance(event, MessageEvent):
                # MessageEvent has llm_message with role information
                sse_data["role"] = event.llm_message.role
                # Surface reasoning so it's visible in the frontend even when
                # `content` is empty (e.g. qwen-flash thinking-only responses).
                rc = getattr(event.llm_message, "reasoning_content", None)
                if rc:
                    sse_data["reasoning_content"] = rc
                tbs = getattr(event.llm_message, "thinking_blocks", None)
                if tbs:
                    sse_data["thinking_blocks"] = [tb.model_dump() for tb in tbs]
                # Also include activated_skills if present
                if event.activated_skills:
                    sse_data["activated_skills"] = event.activated_skills
                if event.sender:
                    sse_data["sender"] = event.sender

            # Put event in queue
            sse_event = SSEEvent("agent_event", sse_data)
            self.event_queue.put(sse_event)
            logger.debug(
                f"Queued SSE event: {sse_event.event_type} - type: {event_type}"
            )

            # Persist event to database (async, don't block)
            if self.conversation_id:
                try:
                    session_manager.save_event(
                        conversation_id=self.conversation_id,
                        event_type=event_type,
                        event_data=sse_data,
                        event_index=self.event_index,
                    )
                    self.event_index += 1
                except Exception as e:
                    logger.warning(f"Failed to persist event: {e}")

        except Exception as e:
            logger.error(f"Error processing event in QueueVisualizer: {e}")
            # Put error event in queue
            error_event = SSEEvent(
                "error",
                {"type": "error", "message": f"Error processing event: {str(e)}"},
            )
            try:
                self.event_queue.put(error_event)
            except:
                pass
