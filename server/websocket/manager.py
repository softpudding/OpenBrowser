import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional, Set, Callable
from websockets.server import WebSocketServerProtocol, serve
from websockets.exceptions import ConnectionClosed

from server.models.commands import Command, CommandResponse, parse_command
from server.core.config import config
from server.core.uuid_manager import UUIDManager


logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket connections to Chrome extension"""

    def __init__(self):
        self.connections: Set[WebSocketServerProtocol] = set()
        self.message_handlers: Dict[str, Callable] = {}
        self.response_waiters: Dict[str, asyncio.Future] = {}
        self.server: Optional[Any] = None
        self._running = False
        self._uuid_manager = UUIDManager()

    async def start(self, host: str = "127.0.0.1", port: int = 8766):
        """Start WebSocket server"""
        self.server = await serve(
            self._handle_connection,
            host,
            port,
            ping_interval=5,
            ping_timeout=3,
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
            welcome_msg = json.dumps(
                {
                    "type": "connected",
                    "message": "Connected to Local Chrome Server",
                    "timestamp": time.time(),
                }
            )
            await websocket.send(welcome_msg)
            logger.debug(f"Sent welcome message to {client_address}")

            # Handle messages until connection closes
            try:
                async for message in websocket:
                    await self._handle_message(message, websocket)
            except ConnectionClosed as e:
                logger.info(
                    f"WebSocket connection closed from {client_address}: {e.code} {e.reason}"
                )

        except Exception as e:
            logger.error(
                f"Error handling WebSocket connection from {client_address}: {e}"
            )
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
                logger.debug(
                    f"Message has command_id but no type, treating as command response"
                )
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

        if event_type == "tab_switched":
            await self._handle_tab_switched_event(data)

    async def _handle_tab_switched_event(self, data: dict):
        """Handle tab switched event from extension"""
        try:
            conversation_id = data.get("conversation_id")
            tab_id = data.get("tab_id")

            if not conversation_id or not tab_id:
                logger.warning(
                    f"Invalid tab_switched event: missing conversation_id or tab_id: {data}"
                )
                return

            # Import here to avoid circular imports
            from server.core.processor import command_processor

            # Update processor's current tab for this conversation
            command_processor.set_current_tab(tab_id, conversation_id)
            logger.info(
                f"Updated current tab for conversation {conversation_id}: {tab_id}"
            )

        except Exception as e:
            logger.error(f"Error handling tab_switched event: {e}")

    async def _send_pong(self, websocket: WebSocketServerProtocol):
        """Send pong response"""
        await websocket.send(json.dumps({"type": "pong"}))

    async def _send_error(self, websocket: WebSocketServerProtocol, error: str):
        """Send error message"""
        await websocket.send(json.dumps({"type": "error", "error": error}))

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
                future, timeout=config.command_timeout
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

    # UUID-based browser identification methods

    def register_browser(
        self, uuid: str, websocket: WebSocketServerProtocol, ttl_hours: int = 24
    ) -> None:
        """Register a browser with UUID for identification.

        Args:
            uuid: Unique identifier for the browser
            websocket: WebSocket connection to the browser extension
            ttl_hours: Time-to-live in hours (default: 24)
        """
        self._uuid_manager.register_browser(uuid, websocket, ttl_hours)

    def get_browser_websocket(self, uuid: str) -> Optional[WebSocketServerProtocol]:
        """Get WebSocket connection by browser UUID.

        Args:
            uuid: UUID string identifying the browser

        Returns:
            WebSocket connection if found and valid, None otherwise
        """
        return self._uuid_manager.get_websocket(uuid)

    def is_browser_valid(self, uuid: str) -> bool:
        """Check if a browser UUID is valid and not expired.

        Args:
            uuid: UUID string to validate

        Returns:
            True if UUID exists and hasn't expired, False otherwise
        """
        return self._uuid_manager.is_valid(uuid)

    def unregister_browser(self, uuid: str) -> bool:
        """Unregister a browser by UUID.

        Args:
            uuid: UUID string identifying the browser

        Returns:
            True if browser was unregistered, False if not found
        """
        return self._uuid_manager.unregister_browser(uuid)

    def cleanup_expired_browsers(self) -> list[str]:
        """Remove all expired browser registrations and cleanup conversations.

        This method should be called periodically to clean up expired UUIDs
        and free resources associated with stale browser connections.

        For each expired browser UUID, the associated conversation is also
        terminated via the agent manager.

        Returns:
            List of expired UUID strings that were removed
        """
        now = time.time()
        expired_uuids = [
            uuid_str
            for uuid_str, info in self._uuid_manager._browsers.items()
            if now > info.expires_at
        ]

        count = self._uuid_manager.cleanup_expired()

        if expired_uuids:
            logger.info(f"Cleaned up {count} expired browser UUIDs: {expired_uuids}")

            for browser_id in expired_uuids:
                self._cleanup_conversation_for_browser(browser_id)

        return expired_uuids

    def _cleanup_conversation_for_browser(self, browser_id: str) -> None:
        """Clean up conversation associated with an expired browser.

        Args:
            browser_id: UUID of the expired browser
        """
        try:
            from server.agent.manager import agent_manager

            if agent_manager.multi_process_mode and agent_manager._process_manager:
                conv_id = agent_manager._process_manager.get_conversation_by_browser(
                    browser_id
                )

                if conv_id:
                    logger.info(
                        f"Cleaning up conversation {conv_id} for expired browser {browser_id}"
                    )
                    agent_manager.delete_conversation(conv_id)

        except Exception as e:
            logger.warning(
                f"Failed to cleanup conversation for browser {browser_id}: {e}"
            )


# Global WebSocket manager instance
ws_manager = WebSocketManager()
