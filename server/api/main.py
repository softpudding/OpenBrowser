from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import logging
import json
import asyncio
from contextlib import asynccontextmanager

from server.core.config import config
from server.core.processor import command_processor
from server.websocket.manager import ws_manager
from server.models.commands import Command, parse_command, CommandResponse
from server.agent.agent import (
    agent_manager, 
    process_agent_message, 
    create_agent_conversation,
    get_conversation_info, 
    delete_conversation, 
    list_conversations
)


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    # Startup
    logger.info("Starting Local Chrome Server...")
    
    # Start WebSocket server
    try:
        await ws_manager.start(host=config.host, port=config.websocket_port)
        logger.info(f"WebSocket server started on ws://{config.host}:{config.websocket_port}")
    except Exception as e:
        logger.error(f"Failed to start WebSocket server: {e}")
        logger.error("Extension connectivity will be limited")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Local Chrome Server...")
    try:
        await ws_manager.stop()
    except Exception as e:
        logger.error(f"Error stopping WebSocket server: {e}")


# Create FastAPI app
app = FastAPI(
    title="Local Chrome Server API",
    description="API for controlling Chrome browser via Chrome extension",
    version="0.1.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/api")
async def api_info():
    """API info endpoint"""
    return {
        "name": "Local Chrome Server",
        "version": "0.1.0",
        "status": "running",
        "websocket_connected": ws_manager.is_connected(),
        "websocket_connections": ws_manager.get_connection_count(),
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    healthy = await command_processor.health_check()
    if healthy:
        return {
            "status": "healthy", 
            "websocket_connected": ws_manager.is_connected(),
            "websocket_connections": ws_manager.get_connection_count()
        }
    else:
        raise HTTPException(status_code=503, detail="Service unhealthy")


@app.post("/command", response_model=CommandResponse)
async def execute_command(command_data: dict):
    """
    Execute a browser command
    
    Supported command types:
    - mouse_move: Move mouse relative to current position
    - mouse_click: Click at current mouse position
    - mouse_scroll: Scroll at current mouse position
    - keyboard_type: Type text at current focus
    - keyboard_press: Press special key
    - screenshot: Capture screenshot
    - tab: Tab management (open, close, switch)
    - get_tabs: Get list of all tabs
    """
    try:
        # Parse and validate command
        command = parse_command(command_data)
        
        # Execute command
        response = await command_processor.execute(command)
        
        return response
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"No Chrome extension connection: {e}")
    except Exception as e:
        logger.error(f"Unexpected error executing command: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/mouse/move")
async def mouse_move(dx: int, dy: int, duration: float = 0.1):
    """Move mouse relative to current position"""
    command = {
        "type": "mouse_move",
        "dx": dx,
        "dy": dy,
        "duration": duration
    }
    return await execute_command(command)


@app.post("/mouse/click")
async def mouse_click(button: str = "left", double: bool = False, count: int = 1):
    """Click at current mouse position"""
    command = {
        "type": "mouse_click",
        "button": button,
        "double": double,
        "count": count
    }
    return await execute_command(command)


@app.post("/mouse/scroll")
async def mouse_scroll(direction: str = "down", amount: int = 100):
    """Scroll at current mouse position"""
    command = {
        "type": "mouse_scroll",
        "direction": direction,
        "amount": amount
    }
    return await execute_command(command)


@app.post("/keyboard/type")
async def keyboard_type(text: str):
    """Type text at current focus"""
    command = {
        "type": "keyboard_type",
        "text": text
    }
    return await execute_command(command)


@app.post("/keyboard/press")
async def keyboard_press(key: str, modifiers: list = None):
    """Press special key"""
    command = {
        "type": "keyboard_press",
        "key": key,
        "modifiers": modifiers or []
    }
    return await execute_command(command)


@app.post("/screenshot")
async def screenshot(tab_id: int = None, include_cursor: bool = True, include_visual_mouse: bool = True, quality: int = 90):
    """Capture screenshot"""
    command = {
        "type": "screenshot",
        "tab_id": tab_id,
        "include_cursor": include_cursor,
        "include_visual_mouse": include_visual_mouse,
        "quality": quality
    }
    return await execute_command(command)


@app.post("/tabs")
async def tab_action(action: str, url: str = None, tab_id: int = None):
    """Tab management"""
    command = {
        "type": "tab",
        "action": action,
        "url": url,
        "tab_id": tab_id
    }
    return await execute_command(command)


@app.get("/tabs")
async def get_tabs(managed_only: bool = True):
    """Get list of all tabs"""
    command = {
        "type": "get_tabs",
        "managed_only": managed_only
    }
    return await execute_command(command)


# --- Agent API Endpoints ---

@app.post("/agent/conversations")
async def create_conversation():
    """Create a new agent conversation"""
    try:
        conversation_id = await create_agent_conversation()
        return {
            "success": True,
            "conversation_id": conversation_id,
            "message": f"Conversation created: {conversation_id}"
        }
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.api_route("/agent/conversations/{conversation_id}/messages", methods=["GET", "POST"])
async def agent_messages_stream(conversation_id: str, request: Request = None):
    """
    Handle agent conversation messages with SSE streaming
    - GET: Connect to SSE stream
    - POST: Send a message and get SSE stream response
    """
    
    async def event_generator(message_text: str = None):
        """Generate SSE events for the agent conversation"""
        try:
            # If no message text provided, this is a GET request - just open stream
            if message_text is None:
                # Send a connected event to establish SSE connection
                yield "event: connected\ndata: {\"status\": \"connected\", \"conversation_id\": \"" + conversation_id + "\"}\n\n"
                # Keep the connection alive with periodic heartbeats
                # but don't block if client disconnects
                heartbeat_count = 0
                while True:
                    try:
                        await asyncio.sleep(5)
                        heartbeat_count += 1
                        # Send heartbeat comment (SSE comments start with :)
                        yield f": heartbeat {heartbeat_count}\n\n"
                    except asyncio.CancelledError:
                        logger.debug(f"SSE heartbeat cancelled for conversation {conversation_id}")
                        break
            else:
                # Process the actual message
                logger.debug(f"API: Starting SSE event generation for conversation {conversation_id}")
                event_count = 0
                async for sse_event in process_agent_message(conversation_id, message_text):
                    event_count += 1
                    logger.debug(f"API: Yielding SSE event #{event_count}: {sse_event[:200] if sse_event else 'None'}")
                    yield sse_event
                logger.debug(f"API: Finished SSE event generation, yielded {event_count} events")
                    
        except ValueError as e:
            logger.error(f"Error processing agent message: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        except asyncio.CancelledError:
            logger.debug(f"SSE connection cancelled for conversation {conversation_id}")
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
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    
    # Handle POST request (send message)
    elif request.method == "POST":
        try:
            message_data = await request.json()
            if "text" not in message_data:
                raise HTTPException(status_code=400, detail="Message must contain 'text' field")
            
            return StreamingResponse(
                event_generator(message_data["text"]),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                }
            )
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in request body")


@app.get("/agent/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation information"""
    info = await get_conversation_info(conversation_id)
    if info:
        return {"success": True, "conversation": info}
    else:
        raise HTTPException(status_code=404, detail=f"Conversation {conversation_id} not found")


@app.delete("/agent/conversations/{conversation_id}")
async def remove_conversation(conversation_id: str):
    """Delete a conversation"""
    success = await delete_conversation(conversation_id)
    if success:
        return {"success": True, "message": f"Conversation {conversation_id} deleted"}
    else:
        raise HTTPException(status_code=404, detail=f"Conversation {conversation_id} not found")


@app.get("/agent/conversations")
async def get_all_conversations():
    """List all conversations"""
    conversations = await list_conversations()
    return {"success": True, "conversations": conversations}


# --- Frontend Routes ---

from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os

# Get frontend directory path
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend")
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")

# Create directories if they don't exist
os.makedirs(FRONTEND_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

@app.get("/", response_class=HTMLResponse)
async def get_frontend():
    """Serve the frontend interface"""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r") as f:
            return HTMLResponse(content=f.read())
    else:
        return HTMLResponse(content="<h1>OpenBrowserAgent</h1><p>Frontend template not found.</p>")


@app.get("/agent-ui", response_class=HTMLResponse)
async def get_agent_ui():
    """Alternative route for agent UI"""
    return await get_frontend()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time command execution"""
    await websocket.accept()
    
    try:
        while True:
            # Receive command from WebSocket client
            data = await websocket.receive_json()
            
            # Execute command
            response = await execute_command(data)
            
            # Send response back
            await websocket.send_json(response.dict())
            
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close(code=1011, reason=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level=config.log_level.lower()
    )