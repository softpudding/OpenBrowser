"""
Public API Functions for Agent

High-level functions for creating and managing agent conversations.
"""

import asyncio
import json
import logging
import queue
import threading
import time
import inspect
from typing import Dict, List, Any, Optional, AsyncGenerator, Callable

from server.api.sse import SSEEvent
from server.agent.manager import agent_manager
from server.agent.conversation import ConversationState
from server.agent.user_help import build_completion_event_payload
from server.core.session_manager import session_manager, SessionStatus

logger = logging.getLogger(__name__)


async def _stream_sse_events(
    event_queue: Any,
    conversation_id: str,
    finished_checker: Optional[Callable[[], bool]] = None,
) -> AsyncGenerator[str, None]:
    """Stream ``SSEEvent`` objects from either a local queue or IPC queue."""
    timeout_seconds = 600.0
    last_event_time = time.time()

    while True:
        if finished_checker is not None and finished_checker() and event_queue.empty():
            logger.debug(
                "Event producer finished and queue empty for %s",
                conversation_id,
            )
            break

        idle_time = time.time() - last_event_time
        if idle_time > timeout_seconds:
            logger.warning(
                "Timeout waiting for events from conversation %s (idle for %.1fs)",
                conversation_id,
                idle_time,
            )
            yield SSEEvent(
                "error",
                {
                    "conversation_id": conversation_id,
                    "error": "Timeout waiting for agent response",
                },
            ).to_sse_format()
            break

        loop = asyncio.get_event_loop()
        try:
            remaining_time = max(10.0, timeout_seconds - idle_time)
            sse_event = await loop.run_in_executor(
                None, event_queue.get, remaining_time
            )
            last_event_time = time.time()
        except queue.Empty:
            continue
        except Exception as e:
            logger.error("Error reading event queue for %s: %s", conversation_id, e)
            yield SSEEvent(
                "error",
                {
                    "conversation_id": conversation_id,
                    "error": f"Error processing events: {str(e)}",
                },
            ).to_sse_format()
            break

        if not isinstance(sse_event, SSEEvent):
            logger.error(
                "Unexpected event payload for %s: %s",
                conversation_id,
                type(sse_event).__name__,
            )
            yield SSEEvent(
                "error",
                {
                    "conversation_id": conversation_id,
                    "error": "Unexpected event payload from worker",
                },
            ).to_sse_format()
            break

        yield sse_event.to_sse_format()

        if sse_event.event_type == "error":
            break

        if sse_event.event_type == "complete":
            while True:
                try:
                    next_event = event_queue.get_nowait()
                except queue.Empty:
                    break

                if not isinstance(next_event, SSEEvent):
                    logger.warning(
                        "Skipping unexpected follow-up payload for %s: %s",
                        conversation_id,
                        type(next_event).__name__,
                    )
                    continue

                yield next_event.to_sse_format()
            break


async def create_agent_conversation(
    conversation_id: Optional[str] = None,
    cwd: str = ".",
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    browser_id: Optional[str] = None,
    model_alias: Optional[str] = None,
    mode: Optional[str] = None,
) -> str:
    """Create a new agent conversation

    Args:
        conversation_id: Optional conversation ID (auto-generated if None)
        cwd: Working directory for the conversation (default: current directory)
        model: Optional model name override (e.g., "dashscope/qwen3.5-plus")
        base_url: Optional base URL override
        mode: Optional conversation-mode tag (e.g. ``"routine_replay"``).
    """
    return agent_manager.create_conversation(
        conversation_id, cwd, model, base_url, browser_id, model_alias, mode=mode
    )


async def process_agent_message(
    conversation_id: str, message_text: str, cwd: str = "."
) -> AsyncGenerator[str, None]:
    """Process a message and yield SSE events using thread-based execution

    Args:
        conversation_id: Conversation ID to process message in
        message_text: Message text to send to agent
        cwd: Working directory for the conversation if creating new (default: current directory)
    """
    logger.debug(
        f"DEBUG: process_agent_message called with conversation_id={conversation_id}, message='{message_text[:50]}...', cwd={cwd}"
    )
    logger.info(
        f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'"
    )
    logger.debug(
        f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'"
    )

    # Update session status to active and increment message count
    session_manager.update_session_status(
        conversation_id, SessionStatus.ACTIVE, increment_message_count=True
    )

    # Save user message for history
    try:
        session_manager.save_user_message(
            conversation_id=conversation_id, message_text=message_text
        )
    except Exception as e:
        logger.warning(f"Failed to save user message: {e}")

    conv_state = agent_manager.get_or_create_conversation(conversation_id, cwd)
    logger.debug(f"DEBUG: Using conversation {conversation_id} (created if new)")

    if agent_manager.multi_process_mode:
        command_queue = agent_manager.get_command_queue(conversation_id)
        response_queue = agent_manager.get_response_queue(conversation_id)

        if command_queue is None or response_queue is None:
            yield SSEEvent(
                "error",
                {
                    "conversation_id": conversation_id,
                    "error": "Conversation worker queues are not available",
                },
            ).to_sse_format()
            session_manager.update_session_status(conversation_id, SessionStatus.ERROR)
            return

        worker_failed = False
        try:
            command_queue.put({"agent_message": message_text, "cwd": cwd})

            async for sse_payload in _stream_sse_events(
                response_queue,
                conversation_id,
            ):
                if sse_payload.startswith("event: error"):
                    worker_failed = True
                yield sse_payload
        finally:
            session_manager.update_session_status(
                conversation_id,
                SessionStatus.ERROR if worker_failed else SessionStatus.IDLE,
            )

        return

    # Create a queue for collecting events from visualizer
    event_queue = queue.Queue()

    # Set the event queue on the visualizer
    conv_state.visualizer.set_event_queue(event_queue)
    logger.debug(f"Event queue set on visualizer for conversation {conversation_id}")

    # Flag to track if conversation thread has finished
    conversation_finished = False
    conversation_error = None

    def run_conversation():
        """Run the conversation in a separate thread (synchronous)"""
        nonlocal conversation_finished, conversation_error
        try:
            logger.debug(f"DEBUG: run_conversation starting for {conversation_id}")
            logger.debug(
                f"Starting conversation execution in thread for {conversation_id}"
            )

            # Set up event loop for this thread
            try:
                loop = asyncio.get_event_loop()
                logger.debug(f"DEBUG: Using existing event loop in thread")
            except RuntimeError:
                logger.debug(f"DEBUG: Creating new event loop for thread")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            # Send user message to conversation
            logger.debug(f"DEBUG: Sending message to conversation")
            conv_state.conversation.send_message(message_text)

            # Run the conversation (check if it's async or sync)
            run_method = conv_state.conversation.run

            if inspect.iscoroutinefunction(run_method):
                logger.debug(
                    f"DEBUG: conversation.run() is async, running in thread event loop"
                )
                try:
                    logger.debug(f"DEBUG: Running async conversation.run()")
                    loop.run_until_complete(run_method())
                    logger.debug(
                        f"DEBUG: Async conversation.run() completed successfully"
                    )
                finally:
                    pass  # Don't close the loop - tools might still need it
            else:
                logger.debug(f"DEBUG: conversation.run() is sync, calling directly")
                run_method()
                logger.debug(f"DEBUG: Sync conversation.run() completed successfully")
            logger.debug(f"Conversation {conversation_id} execution completed")

            # Collect usage metrics before closing conversation
            usage_metrics = {}
            try:
                if hasattr(conv_state.conversation, "conversation_stats"):
                    stats = conv_state.conversation.conversation_stats
                    if hasattr(stats, "get_combined_metrics"):
                        combined_metrics = stats.get_combined_metrics()
                        usage_metrics = combined_metrics.get()
                        usage_metrics["model_name"] = combined_metrics.model_name
                        logger.info(
                            f"Usage metrics: cost={usage_metrics.get('accumulated_cost', 0):.6f}, "
                            f"model_name={combined_metrics.model_name}, "
                            f"tokens={usage_metrics.get('accumulated_token_usage', {})}"
                        )
            except Exception as e:
                logger.warning(f"Failed to collect usage metrics: {e}")

            # Put usage metrics event in queue *before* the complete event.
            # The SSE streamer drains and breaks immediately after yielding
            # `complete`, so anything enqueued after it can be lost in a race.
            if usage_metrics:
                logger.debug(f"DEBUG: Putting usage_metrics event into queue")
                session_manager.save_event(
                    conversation_id=conversation_id,
                    event_type="usage_metrics",
                    event_data={
                        "conversation_id": conversation_id,
                        "metrics": usage_metrics,
                    },
                )
                event_queue.put(
                    SSEEvent(
                        "usage_metrics",
                        {
                            "conversation_id": conversation_id,
                            "metrics": usage_metrics,
                        },
                    )
                )
                logger.debug(f"DEBUG: usage_metrics event put into queue")

            logger.debug(f"DEBUG: Putting complete event into queue")
            # Put completion event in queue (must be last so the streamer can
            # drain remaining events and exit cleanly).
            event_queue.put(
                SSEEvent(
                    "complete",
                    build_completion_event_payload(
                        conversation_id,
                        conv_state.conversation.state.events,
                    ),
                )
            )
            logger.debug(f"DEBUG: Complete event put into queue")

        except Exception as e:
            logger.debug(f"DEBUG: Exception in run_conversation: {e}")
            import traceback

            logger.error(traceback.format_exc())
            logger.error(f"Error running conversation in thread: {e}")
            conversation_error = e
            # Put error event in queue
            event_queue.put(
                SSEEvent("error", {"conversation_id": conversation_id, "error": str(e)})
            )
        finally:
            logger.debug(
                f"DEBUG: run_conversation finally block, setting conversation_finished=True"
            )
            conversation_finished = True
            logger.debug(f"DEBUG: conversation_finished set to True in thread")
            conv_state.conversation.close()
            logger.debug(f"DEBUG: closed conversation")

    # Start conversation thread
    conversation_thread = threading.Thread(target=run_conversation, daemon=True)
    conversation_thread.start()
    logger.debug(f"Started conversation thread for {conversation_id}")

    try:
        async for sse_payload in _stream_sse_events(
            event_queue,
            conversation_id,
            finished_checker=lambda: conversation_finished,
        ):
            yield sse_payload

        # Wait for thread to finish (with timeout)
        await asyncio.get_event_loop().run_in_executor(
            None, conversation_thread.join, 5.0
        )
        if conversation_thread.is_alive():
            logger.warning(
                f"Conversation thread for {conversation_id} still alive after join timeout"
            )

    finally:
        # Update session status to idle after completion (or error if conversation_error is set)
        if conversation_error:
            session_manager.update_session_status(conversation_id, SessionStatus.ERROR)
        else:
            session_manager.update_session_status(conversation_id, SessionStatus.IDLE)

        # Clear the event queue from visualizer
        conv_state.visualizer.set_event_queue(None)
        logger.debug(
            f"Cleaned up visualizer event queue for conversation {conversation_id}"
        )


async def get_conversation_info(conversation_id: str) -> Optional[Dict[str, Any]]:
    """Get information about a conversation"""
    conv_state = agent_manager.get_conversation(conversation_id)
    if conv_state:
        return {
            "id": conv_state.conversation_id,
            "created_at": conv_state.created_at,
            "has_agent": conv_state.conversation is not None
            and conv_state.conversation.agent is not None,
        }
    return None


async def delete_conversation(conversation_id: str) -> bool:
    """Delete a conversation and cleanup all resources"""
    success = agent_manager.delete_conversation(conversation_id)

    if success:
        # Send cleanup command to extension
        try:
            from server.core.processor import command_processor
            from server.models.commands import BaseCommand

            # Send cleanup_session command to extension
            cleanup_command = BaseCommand(
                type="cleanup_session", conversation_id=conversation_id
            )
            await command_processor.execute(cleanup_command)
            logger.info(f"Sent cleanup command to extension for {conversation_id}")
        except Exception as e:
            logger.warning(
                f"Failed to cleanup extension resources for {conversation_id}: {e}"
            )

    return success


async def list_conversations(status: str = None) -> List[Dict[str, Any]]:
    """List all conversations with optional status filter

    Args:
        status: Optional status filter ('active', 'idle', 'error', 'completed')
    """
    status_enum = None
    if status:
        try:
            status_enum = SessionStatus(status)
        except ValueError:
            logger.warning(f"Invalid status filter: {status}")

    return agent_manager.list_conversations(status=status_enum)


# --- Initialization ---


def initialize_agent():
    """Initialize the agent system"""
    logger.info("Initializing OpenBrowserAgent...")

    # Check if browser server is available
    try:
        from server.core.processor import command_processor

        logger.info("Browser command processor available")
    except ImportError as e:
        logger.warning(f"Browser command processor not available: {e}")

    # Register tools if not already registered
    try:
        # Import the old OpenBrowserTool for backward compatibility
        # logger.info("OpenBrowserTool registered (deprecated, for backward compatibility)")

        # Import new focused tools to ensure they're registered
        from .tools.tab_tool import TabTool
        from .tools.highlight_tool import HighlightTool
        from .tools.element_interaction_tool import ElementInteractionTool
        from .tools.dialog_tool import DialogTool

        logger.info(
            "4 focused OpenBrowser tools registered: tab, highlight, element_interaction, dialog"
        )

    except Exception as e:
        logger.error(f"Failed to register OpenBrowser tools: {e}")

    logger.info("OpenBrowserAgent initialized")


# Initialize on module import
initialize_agent()
