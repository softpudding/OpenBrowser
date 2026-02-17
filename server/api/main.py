from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from contextlib import asynccontextmanager

from server.core.config import config
from server.core.processor import command_processor
from server.websocket.manager import ws_manager
from server.models.commands import Command, parse_command, CommandResponse


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


@app.get("/")
async def root():
    """Root endpoint with API info"""
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
async def screenshot(tab_id: int = None, include_cursor: bool = True, quality: int = 90):
    """Capture screenshot"""
    command = {
        "type": "screenshot",
        "tab_id": tab_id,
        "include_cursor": include_cursor,
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
async def get_tabs():
    """Get list of all tabs"""
    command = {
        "type": "get_tabs"
    }
    return await execute_command(command)


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