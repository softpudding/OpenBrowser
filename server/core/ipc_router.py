"""
IPC Router for routing messages between main process and conversation processes.

This module provides the IPCRouter class that manages message routing between:
- Main process (WebSocket handler)
- Conversation processes (browser executors)

Uses multiprocessing.Queue for inter-process communication.
"""

import logging
from multiprocessing import Queue
from typing import Optional

from server.core.ipc_types import BrowserCommandMessage

logger = logging.getLogger(__name__)


class IPCRouter:
    """Routes IPC messages between main process and conversation processes.

    The router maintains a mapping of conversation IDs to their command and
    response queues. Commands from the main process are routed to the correct
    conversation process via the command queue. Responses flow back through
    the response queue.

    Architecture:
        Main Process (WebSocket Handler)
            │
            ├── IPCRouter (routes messages)
            │       │
            │       ├── Queue[conv-1] ──→ Conversation Process 1
            │       ├── Queue[conv-2] ──→ Conversation Process 2
            │       └── Queue[conv-3] ──→ Conversation Process 3
    """

    def __init__(self) -> None:
        """Initialize the IPC router with empty routing tables."""
        # conversation_id -> command_queue (main → conversation process)
        self._command_queues: dict[str, Queue] = {}
        # conversation_id -> response_queue (conversation process → main)
        self._response_queues: dict[str, Queue] = {}
        logger.debug("IPCRouter initialized")

    def register_conversation(
        self,
        conv_id: str,
        command_queue: Queue,
        response_queue: Queue,
    ) -> None:
        """Register queues for a conversation.

        Args:
            conv_id: Unique conversation identifier
            command_queue: Queue for sending commands to the conversation process
            response_queue: Queue for receiving responses from the conversation process
        """
        self._command_queues[conv_id] = command_queue
        self._response_queues[conv_id] = response_queue
        logger.info(f"Registered conversation: {conv_id}")

    def unregister_conversation(self, conv_id: str) -> bool:
        """Remove conversation queues from routing tables.

        Args:
            conv_id: Conversation identifier to unregister

        Returns:
            True if conversation was unregistered, False if not found
        """
        if conv_id in self._command_queues:
            del self._command_queues[conv_id]
            del self._response_queues[conv_id]
            logger.info(f"Unregistered conversation: {conv_id}")
            return True
        logger.warning(f"Attempted to unregister unknown conversation: {conv_id}")
        return False

    def route_command(self, message: BrowserCommandMessage) -> bool:
        """Route a command message to the correct conversation queue.

        Args:
            message: BrowserCommandMessage to route

        Returns:
            True if command was routed successfully, False if conversation not found
        """
        conv_id = message.conversation_id

        if conv_id not in self._command_queues:
            logger.warning(
                f"Cannot route command: conversation {conv_id} not registered"
            )
            return False

        try:
            queue = self._command_queues[conv_id]
            queue.put(message)
            logger.debug(f"Routed command to conversation {conv_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to route command to {conv_id}: {e}")
            return False

    def get_response_queue(self, conv_id: str) -> Optional[Queue]:
        """Get the response queue for a conversation.

        Args:
            conv_id: Conversation identifier

        Returns:
            Response queue if conversation is registered, None otherwise
        """
        return self._response_queues.get(conv_id)

    def get_command_queue(self, conv_id: str) -> Optional[Queue]:
        """Get the command queue for a conversation.

        Args:
            conv_id: Conversation identifier

        Returns:
            Command queue if conversation is registered, None otherwise
        """
        return self._command_queues.get(conv_id)

    def list_conversations(self) -> list[str]:
        """List all registered conversation IDs.

        Returns:
            List of conversation IDs currently registered
        """
        return list(self._command_queues.keys())

    def has_conversation(self, conv_id: str) -> bool:
        """Check if a conversation is registered.

        Args:
            conv_id: Conversation identifier

        Returns:
            True if conversation is registered, False otherwise
        """
        return conv_id in self._command_queues

    def clear(self) -> None:
        """Clear all registered conversations.

        Used for testing and cleanup.
        """
        self._command_queues.clear()
        self._response_queues.clear()
        logger.debug("Cleared all conversation registrations")
