"""
Local Chrome Server - FastAPI Application

Main FastAPI application with modular routers for:
- Health checks and API info
- Browser command execution
- Agent conversation management
- Configuration management
- Frontend serving
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from server.core.config import config
from server.websocket.manager import ws_manager
from server.api.routes import (
    health_router,
    commands_router,
    agent_router,
    config_router,
    frontend_router,
    browsers_router,
)

logger = logging.getLogger(__name__)


async def uuid_cleanup_task():
    """Background task to periodically clean up expired browser UUIDs.

    Runs every hour to remove expired browser registrations and free resources.
    """
    while True:
        await asyncio.sleep(3600)  # Every hour
        try:
            expired_uuids = ws_manager.cleanup_expired_browsers()
            if expired_uuids:
                logger.info(
                    f"UUID cleanup: removed {len(expired_uuids)} expired browsers"
                )
        except Exception as e:
            logger.error(f"Error during UUID cleanup: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    # Startup
    logger.info("Starting Local Chrome Server...")

    # Start WebSocket server
    try:
        await ws_manager.start(host=config.host, port=config.websocket_port)
        logger.info(
            f"WebSocket server started on ws://{config.host}:{config.websocket_port}"
        )
    except Exception as e:
        logger.error(f"Failed to start WebSocket server: {e}")
        logger.error("Extension connectivity will be limited")

    # Start background cleanup task
    cleanup_task = asyncio.create_task(uuid_cleanup_task())
    logger.info("Started UUID cleanup background task")

    yield

    # Shutdown
    logger.info("Shutting down Local Chrome Server...")

    # Cancel cleanup task
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

    try:
        await ws_manager.stop()
    except Exception as e:
        logger.error(f"Error stopping WebSocket server: {e}")


# Create FastAPI app
app = FastAPI(
    title="Local Chrome Server API",
    description="API for controlling Chrome browser via Chrome extension",
    version="0.1.0",
    lifespan=lifespan,
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

# Include routers
app.include_router(health_router)
app.include_router(commands_router)
app.include_router(agent_router)
app.include_router(config_router)
app.include_router(frontend_router)
app.include_router(browsers_router)


# WebSocket endpoint for real-time command execution
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time command execution"""
    from server.models.commands import parse_command, CommandResponse

    await websocket.accept()

    try:
        while True:
            # Receive command from WebSocket client
            data = await websocket.receive_json()

            # Execute command via command processor
            from server.core.processor import command_processor

            command = parse_command(data)
            response = await command_processor.execute(command)

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
        app, host=config.host, port=config.port, log_level=config.log_level.lower()
    )
