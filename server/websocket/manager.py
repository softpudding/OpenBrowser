import asyncio
import json
import logging
import time
from typing import Dict, Optional, Set, Callable, Any
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed

from server.models.commands import Command, CommandResponse, parse_command
from server.core.config import config


logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket connections to Chrome extension"""
    
    def __init__(self):
        self.connections: Set[WebSocketServerProtocol] = set()
        self.message_handlers: Dict[str, Callable] = {}
        self.response_waiters: Dict[str, asyncio.Future] = {}
        self.server: Optional[Any] = None
        self._running = False
        
    async def start(self, host: str = "127.0.0.1", port: int = 8766):
        """Start WebSocket server"""
        self.server = await serve(
            self._handle_connection,
            host,
            port,
            ping_interval=30,
            ping_timeout=10,
            # Add additional options for better compatibility
            origins=None,  # Allow all origins for local development
            compression=None,
            # Increase max message size for large data like screenshots
            max_size=100 * 1024 * 1024,  # 100 MB - for screenshot data
        )
        self._running = True
        logger.info(f"WebSocket server started on ws://{host}:{port}")
        
    async def stop(self):
        """Stop WebSocket server"""
        self._running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            logger.info("WebSocket server stopped")
            
    async def _handle_connection(self, websocket: WebSocketServerProtocol):
        """Handle incoming WebSocket connection"""
        client_address = websocket.remote_address
        logger.info(f"✅ WebSocket connection established from {client_address}")
        
        try:
            # Connection is already established by websockets.serve()
            self.connections.add(websocket)
            
            # Send welcome message
            welcome_msg = json.dumps({
                "type": "connected",
                "message": "Connected to Local Chrome Server",
                "timestamp": time.time()
            })
            await websocket.send(welcome_msg)
            logger.debug(f"Sent welcome message to {client_address}")
            
            # Handle messages until connection closes
            try:
                async for message in websocket:
                    await self._handle_message(message, websocket)
            except ConnectionClosed as e:
                logger.info(f"WebSocket connection closed from {client_address}: {e.code} {e.reason}")
                
        except Exception as e:
            logger.error(f"Error handling WebSocket connection from {client_address}: {e}")
            import traceback
            logger.error(traceback.format_exc())
        finally:
            if websocket in self.connections:
                self.connections.remove(websocket)
            logger.info(f"WebSocket connection cleanup for {client_address}")
            
    async def _handle_message(self, message: str, websocket: WebSocketServerProtocol):
        """Handle incoming WebSocket message"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            # Debug log to see what we're receiving
            logger.debug(f"Received WebSocket message: {data}")
            
            if msg_type == "command_response":
                await self._handle_command_response(data)
            elif msg_type == "event":
                await self._handle_event(data)
            elif msg_type == "ping":
                await self._send_pong(websocket)
            elif "command_id" in data:
                # If message has command_id but no type, treat it as command response
                logger.debug(f"Message has command_id but no type, treating as command response")
                await self._handle_command_response(data)
            else:
                logger.warning(f"Unknown message type: {msg_type}, data: {data}")
                
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON received: {e}")
            await self._send_error(websocket, "Invalid JSON format")
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            await self._send_error(websocket, f"Internal error: {e}")
            
    async def _handle_command_response(self, data: dict):
        """Handle command response from extension"""
        command_id = data.get("command_id")
        if command_id and command_id in self.response_waiters:
            future = self.response_waiters.pop(command_id)
            if not future.done():
                future.set_result(data)
        else:
            logger.warning(f"Response for unknown command_id: {command_id}")
            
    async def _handle_event(self, data: dict):
        """Handle event from extension"""
        event_type = data.get("event_type")
        logger.info(f"Received event: {event_type}")
        # TODO: Implement event handlers
        
    async def _send_pong(self, websocket: WebSocketServerProtocol):
        """Send pong response"""
        await websocket.send(json.dumps({"type": "pong"}))
        
    async def _send_error(self, websocket: WebSocketServerProtocol, error: str):
        """Send error message"""
        await websocket.send(json.dumps({
            "type": "error",
            "error": error
        }))
        
    async def send_command(self, command: Command) -> CommandResponse:
        """Send command to extension and wait for response"""
        if not self.connections:
            raise ConnectionError("No WebSocket connections available")
            
        # Convert command to dict
        command_dict = command.dict()
        if not command_dict.get("command_id"):
            import uuid
            command_dict["command_id"] = str(uuid.uuid4())
            
        # Create future for response
        future = asyncio.Future()
        self.response_waiters[command_dict["command_id"]] = future
        
        # Send command to all connections (extension should handle duplicates)
        message = json.dumps(command_dict)
        sent = False
        for connection in self.connections:
            try:
                await connection.send(message)
                sent = True
            except Exception as e:
                logger.error(f"Failed to send command to connection: {e}")
                
        if not sent:
            self.response_waiters.pop(command_dict["command_id"], None)
            raise ConnectionError("Failed to send command to any connection")
            
        # Wait for response with timeout
        try:
            response_data = await asyncio.wait_for(
                future,
                timeout=config.command_timeout
            )
            return CommandResponse(**response_data)
        except asyncio.TimeoutError:
            self.response_waiters.pop(command_dict["command_id"], None)
            raise TimeoutError(f"Command timeout after {config.command_timeout}s")
            
    def is_connected(self) -> bool:
        """Check if any WebSocket connections are active"""
        return len(self.connections) > 0
        
    def get_connection_count(self) -> int:
        """Get number of active connections"""
        return len(self.connections)


# Global WebSocket manager instance
ws_manager = WebSocketManager()