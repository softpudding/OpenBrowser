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
from typing import Dict, List, Any, Optional, AsyncGenerator

from server.api.sse import SSEEvent
from server.agent.manager import agent_manager
from server.agent.conversation import ConversationState
from server.core.session_manager import session_manager, SessionStatus

logger = logging.getLogger(__name__)


async def create_agent_conversation(
    conversation_id: Optional[str] = None,
    cwd: str = ".",
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    browser_id: Optional[str] = None,
    model_alias: Optional[str] = None,
) -> str:
    """Create a new agent conversation

    Args:
        conversation_id: Optional conversation ID (auto-generated if None)
        cwd: Working directory for the conversation (default: current directory)
        model: Optional model name override (e.g., "dashscope/qwen3.5-plus")
        base_url: Optional base URL override
    """
    return agent_manager.create_conversation(
        conversation_id, cwd, model, base_url, browser_id, model_alias
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

    conv_state = agent_manager.get_or_create_conversation(conversation_id, cwd)
    logger.debug(f"DEBUG: Using conversation {conversation_id} (created if new)")

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

            logger.debug(f"DEBUG: Putting complete event into queue")
            # Put completion event in queue
            event_queue.put(
                SSEEvent(
                    "complete",
                    {
                        "conversation_id": conversation_id,
                        "message": "Conversation completed",
                    },
                )
            )
            logger.debug(f"DEBUG: Complete event put into queue")

            # Put usage metrics event in queue (will be drained after complete event)
            if usage_metrics:
                logger.debug(f"DEBUG: Putting usage_metrics event into queue")
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
        # Yield events as they arrive from the queue
        timeout_seconds = 600.0  # Timeout for idle time (no events for 10 minutes)
        last_event_time = time.time()

        while True:
            # Debug: print queue size
            logger.debug(
                f"DEBUG: Queue size: {event_queue.qsize()}, conversation_finished: {conversation_finished}"
            )

            # Check if conversation thread has finished
            if conversation_finished and event_queue.empty():
                logger.debug(
                    f"Conversation thread finished and queue empty for {conversation_id}"
                )
                logger.debug(
                    f"DEBUG: Conversation finished and queue empty, breaking loop"
                )
                break

            # Check for idle timeout (no events received for timeout_seconds)
            idle_time = time.time() - last_event_time
            if idle_time > timeout_seconds:
                logger.warning(
                    f"Timeout waiting for events from conversation {conversation_id} (idle for {idle_time:.1f}s)"
                )
                yield SSEEvent(
                    "error",
                    {
                        "conversation_id": conversation_id,
                        "error": "Timeout waiting for agent response",
                    },
                ).to_sse_format()
                break

            try:
                # Use asyncio to wait for queue item without blocking event loop
                loop = asyncio.get_event_loop()
                try:
                    # Wait for event with timeout based on remaining idle time
                    # Calculate remaining time before idle timeout
                    remaining_time = max(
                        10.0, timeout_seconds - idle_time
                    )  # Minimum 10 seconds to reduce log noise
                    logger.debug(
                        f"DEBUG: Waiting for event from queue (timeout: {remaining_time:.1f}s, idle: {idle_time:.1f}s)..."
                    )
                    sse_event = await loop.run_in_executor(
                        None, event_queue.get, remaining_time
                    )
                    # Reset idle timer when we get an event
                    last_event_time = time.time()
                    logger.debug(
                        f"DEBUG: Got SSE event from queue: {sse_event.event_type}"
                    )
                except queue.Empty:
                    # Continue loop to check other conditions
                    logger.debug(
                        f"DEBUG: Queue empty after waiting, checking conversation_finished: {conversation_finished}"
                    )
                    continue

                # Check if this is a completion or error event
                if sse_event.event_type in ["complete", "error"]:
                    logger.debug(
                        f"Yielding {sse_event.event_type} event for conversation {conversation_id}"
                    )
                    logger.debug(f"DEBUG: Yielding {sse_event.event_type} event")
                    yield sse_event.to_sse_format()

                    # If it's an error from the conversation thread, we should break
                    if sse_event.event_type == "error":
                        break

                    # For completion events, drain remaining events from queue
                    logger.debug(f"DEBUG: Draining remaining events from queue...")
                    drained_count = 0
                    while True:
                        try:
                            next_event = event_queue.get_nowait()
                            logger.debug(
                                f"DEBUG: Draining event #{drained_count + 1}: {next_event.event_type}"
                            )
                            yield next_event.to_sse_format()
                            drained_count += 1
                        except queue.Empty:
                            logger.debug(
                                f"DEBUG: Queue empty after draining {drained_count} events"
                            )
                            break

                    break
                else:
                    # Yield regular event
                    logger.debug(
                        f"Yielding SSE event for conversation {conversation_id}: {sse_event.event_type}"
                    )
                    logger.debug(
                        f"DEBUG: Yielding regular SSE event: {sse_event.event_type}"
                    )
                    sse_format = sse_event.to_sse_format()
                    logger.debug(
                        f"DEBUG: SSE format string (first 500 chars): {sse_format[:500]}"
                    )
                    yield sse_format

            except Exception as e:
                logger.error(f"Error processing events from queue: {e}")
                yield SSEEvent(
                    "error",
                    {
                        "conversation_id": conversation_id,
                        "error": f"Error processing events: {str(e)}",
                    },
                ).to_sse_format()
                break

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
            "has_agent": conv_state.conversation.agent is not None,
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
        from .tools.javascript_tool import JavaScriptTool

        logger.info(
            "5 focused OpenBrowser tools registered: tab, highlight, element_interaction, dialog, javascript"
        )

    except Exception as e:
        logger.error(f"Failed to register OpenBrowser tools: {e}")

    logger.info("OpenBrowserAgent initialized")


# Initialize on module import
initialize_agent()
