"""Agent conversation endpoints with SSE streaming"""

import asyncio
import json
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from server.agent.agent import (
    agent_manager,
    process_agent_message,
    create_agent_conversation,
    get_conversation_info,
    delete_conversation,
    list_conversations,
)
from server.core.session_manager import session_manager
from server.websocket.manager import ws_manager
from server.api.sse import (
    SSEEvent,
    create_sse_response_headers,
    sse_heartbeat_generator,
)

router = APIRouter(prefix="/agent/conversations", tags=["agent"])

logger = logging.getLogger(__name__)


def _require_valid_browser_id(browser_id: str | None) -> str:
    """Require a valid, registered browser UUID."""
    if not browser_id:
        raise HTTPException(
            status_code=400,
            detail="browser_id is required. Open the extension UUID page and paste it here.",
        )

    if not ws_manager.is_browser_valid(browser_id):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid or expired browser_id: {browser_id}",
        )

    return browser_id


def _authorize_conversation_browser_access(
    conversation_id: str, browser_id: str | None
) -> tuple[object, str]:
    """Authorize browser access for an existing conversation.

    This function performs authorization and resolution only.

    Checks performed:
    - The conversation/session exists; otherwise raises 404.
    - If the session metadata already contains a bound ``browser_id``:
      - Reuse that bound value when the request omits ``browser_id``.
      - Reject the request with 403 when the request provides a different
        ``browser_id`` from the bound one.
    - Ensure the effective ``browser_id`` is present and currently valid;
      otherwise raises 400.

    Important non-goals:
    - Does NOT write or update session metadata.
    - Does NOT bind a browser to the conversation.
    - Does NOT perform any side effects beyond validation and returning the
      effective ``browser_id`` to the caller.

    Returns:
        ``(session, effective_browser_id)``

    The caller is responsible for any first-time binding/update logic after
    authorization succeeds.
    """
    session = session_manager.get_session(conversation_id)
    if session is None:
        raise HTTPException(
            status_code=404, detail=f"Conversation {conversation_id} not found"
        )

    bound_browser_id = session.metadata.get("browser_id")
    if isinstance(bound_browser_id, str) and bound_browser_id:
        if browser_id is None:
            browser_id = bound_browser_id
        elif bound_browser_id != browser_id:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Conversation {conversation_id} is already bound to browser_id "
                    f"{bound_browser_id}"
                ),
            )

    if browser_id is None:
        raise HTTPException(
            status_code=400,
            detail="browser_id is required. Open the extension UUID page and paste it here.",
        )

    browser_id = _require_valid_browser_id(browser_id)
    return session, browser_id


VALID_CONVERSATION_MODES = {"routine_replay"}


@router.post("")
async def create_conversation(request: Request):
    """Create a new agent conversation

    Request body (JSON):
        cwd: Working directory for the conversation (default: ".")
        model: Optional model override
        base_url: Optional base URL override
        model_alias: Optional configured model alias
        browser_id: Optional browser UUID capability token
        mode: Optional conversation-mode tag. Currently only
            ``"routine_replay"`` is recognized — it enables the
            routine-replay system prompt block with the Routine Keywords
            unlock. Omit for normal free-form conversations.
    """
    try:
        raw_body = await request.body()
        body = await request.json() if raw_body else {}
        cwd = body.get("cwd", ".")
        model = body.get("model")
        base_url = body.get("base_url")
        model_alias = body.get("model_alias")
        browser_id = body.get("browser_id")
        mode = body.get("mode")

        if mode is not None and mode not in VALID_CONVERSATION_MODES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unsupported conversation mode: {mode!r}. "
                    f"Valid modes: {sorted(VALID_CONVERSATION_MODES)}"
                ),
            )

        if browser_id is not None:
            browser_id = _require_valid_browser_id(browser_id)

        conversation_id = await create_agent_conversation(
            cwd=cwd,
            model=model,
            base_url=base_url,
            browser_id=browser_id,
            model_alias=model_alias,
            mode=mode,
        )

        response = {
            "success": True,
            "conversation_id": conversation_id,
            "message": f"Conversation created: {conversation_id}",
            "cwd": cwd,
            "model": model,
            "base_url": base_url,
            "model_alias": model_alias,
        }

        if browser_id is not None:
            response["browser_id"] = browser_id
        if mode is not None:
            response["mode"] = mode

        return response
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.api_route("/{conversation_id}/messages", methods=["GET", "POST"])
async def agent_messages_stream(conversation_id: str, request: Request):
    """
    Handle agent conversation messages with SSE streaming
    - GET: Connect to SSE stream
    - POST: Send a message and get SSE stream response
    """

    async def event_generator(message_text: str = None, cwd: str = "."):
        """Generate SSE events for the agent conversation"""
        try:
            # If no message text provided, this is a GET request - just open stream
            if message_text is None:
                # Send a connected event to establish SSE connection
                yield (
                    'event: connected\ndata: {"status": "connected", "conversation_id": "'
                    + conversation_id
                    + '"}\n\n'
                )
                # Keep the connection alive with periodic heartbeats
                async for heartbeat in sse_heartbeat_generator(conversation_id):
                    yield heartbeat
            else:
                # Process the actual message with cwd
                logger.debug(
                    f"API: Starting SSE event generation for conversation {conversation_id} with cwd={cwd}"
                )
                event_count = 0
                async for sse_event in process_agent_message(
                    conversation_id, message_text, cwd
                ):
                    event_count += 1
                    logger.debug(
                        f"API: Yielding SSE event #{event_count}: {sse_event[:200] if sse_event else 'None'}"
                    )
                    yield sse_event
                logger.debug(
                    f"API: Finished SSE event generation, yielded {event_count} events"
                )

        except ValueError as e:
            logger.error(f"Error processing agent message: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        except asyncio.CancelledError:
            logger.debug(
                f"SSE connection cancelled for conversation {conversation_id} - client disconnected"
            )
            # Client disconnected - pause the conversation
            try:
                if agent_manager.request_pause(conversation_id):
                    logger.info(
                        f"Pause requested for conversation {conversation_id} due to client disconnect"
                    )
                else:
                    logger.debug(
                        "No active conversation available to pause for %s",
                        conversation_id,
                    )
            except Exception as e:
                logger.warning(f"Failed to pause conversation {conversation_id}: {e}")
            # Don't yield error on cancellation, just exit cleanly
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': 'Internal server error'})}\n\n"

    # Handle GET request (SSE connection)
    if request.method == "GET":
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers=create_sse_response_headers(),
        )

    # Handle POST request (send message)
    elif request.method == "POST":
        try:
            message_data = await request.json()
            if "text" not in message_data:
                raise HTTPException(
                    status_code=400, detail="Message must contain 'text' field"
                )

            session, browser_id = _authorize_conversation_browser_access(
                conversation_id, message_data.get("browser_id")
            )
            if not session.metadata.get("browser_id"):
                session_manager.update_session_metadata(
                    conversation_id, {"browser_id": browser_id}
                )

            # Extract cwd parameter with default value
            cwd = message_data.get("cwd", ".")

            return StreamingResponse(
                event_generator(message_data["text"], cwd),
                media_type="text/event-stream",
                headers=create_sse_response_headers(),
            )
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in request body")


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation information"""
    info = await get_conversation_info(conversation_id)
    if info:
        return {"success": True, "conversation": info}
    else:
        raise HTTPException(
            status_code=404, detail=f"Conversation {conversation_id} not found"
        )


@router.delete("/{conversation_id}")
async def remove_conversation(conversation_id: str):
    """Delete a conversation"""
    success = await delete_conversation(conversation_id)
    if success:
        return {"success": True, "message": f"Conversation {conversation_id} deleted"}
    else:
        raise HTTPException(
            status_code=404, detail=f"Conversation {conversation_id} not found"
        )


@router.get("")
async def get_all_conversations(status: str = None):
    """List all conversations with optional status filter

    Query Parameters:
        status: Optional status filter ('active', 'idle', 'error', 'completed')
    """
    conversations = await list_conversations(status=status)
    return {
        "success": True,
        "conversations": conversations,
        "count": len(conversations),
        "filter": {"status": status} if status else None,
    }


@router.get("/{conversation_id}/events")
async def get_conversation_events(conversation_id: str):
    """Get event history for a conversation (without images)"""
    try:
        events = session_manager.get_session_events(conversation_id)
        return {
            "success": True,
            "conversation_id": conversation_id,
            "events": events,
            "count": len(events),
        }
    except Exception as e:
        logger.error(f"Error getting events for {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}/replay")
async def replay_conversation(conversation_id: str):
    """Replay conversation history as SSE stream (without images)"""
    try:
        events = session_manager.get_session_events(conversation_id)

        async def replay_generator():
            for event in events:
                # Format as SSE
                event_data_json = json.dumps(event["event_data"])
                yield f"event: {event['event_type']}\ndata: {event_data_json}\n\n"
                await asyncio.sleep(0.01)  # Small delay for streaming effect

            # Send completion event
            yield f"event: complete\ndata: {json.dumps({'conversation_id': conversation_id})}\n\n"

        return StreamingResponse(
            replay_generator(),
            media_type="text/event-stream",
            headers=create_sse_response_headers(),
        )
    except Exception as e:
        logger.error(f"Error replaying conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    """Get user messages for a conversation"""
    try:
        messages = session_manager.get_user_messages(conversation_id)
        return {
            "success": True,
            "conversation_id": conversation_id,
            "messages": messages,
            "count": len(messages),
        }
    except Exception as e:
        logger.error(f"Error getting messages for {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
