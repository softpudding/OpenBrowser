"""
IPC message types for inter-process communication.

This module defines dataclasses for messages exchanged between:
- Main process (WebSocket handler)
- Conversation processes (browser executors)

All messages use JSON serialization for debuggability.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, Any
import time
import json


@dataclass
class IPCMessage:
    """Base class for all IPC messages.

    Attributes:
        conversation_id: UUID identifying the conversation session
        browser_id: UUID identifying the browser instance
        timestamp: Unix timestamp when message was created
    """

    conversation_id: str
    browser_id: str
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        """Serialize message to dictionary for JSON encoding."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "IPCMessage":
        """Deserialize message from dictionary."""
        return cls(**data)


@dataclass
class BrowserCommandMessage(IPCMessage):
    """Message to execute a browser command in a conversation process.

    Attributes:
        command: Command dictionary (e.g., {"type": "screenshot", ...})
        command_id: Optional unique identifier for tracking
    """

    command: dict[str, Any] = field(default_factory=dict)
    command_id: Optional[str] = None


@dataclass
class BrowserResponseMessage(IPCMessage):
    """Response from browser command execution.

    Attributes:
        success: Whether the command executed successfully
        result: Command result data (if successful)
        error: Error message (if failed)
        command_id: ID of the command this response corresponds to
    """

    success: bool = True
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    command_id: Optional[str] = None


@dataclass
class ProcessSpawnMessage(IPCMessage):
    """Message to spawn a new conversation process.

    Attributes:
        initial_url: Optional URL to navigate to on spawn
        config: Optional configuration for the process
    """

    initial_url: Optional[str] = None
    config: Optional[dict[str, Any]] = None


@dataclass
class ProcessShutdownMessage(IPCMessage):
    """Message to shutdown a conversation process.

    Attributes:
        reason: Reason for shutdown (e.g., "user_request", "timeout", "error")
        force: Whether to force shutdown without cleanup
    """

    reason: str = "user_request"
    force: bool = False


def serialize_message(message: IPCMessage) -> str:
    """Serialize IPC message to JSON string.

    Args:
        message: IPC message to serialize

    Returns:
        JSON string representation
    """
    return json.dumps(message.to_dict())


def deserialize_message(json_str: str) -> IPCMessage:
    """Deserialize JSON string to IPC message.

    Args:
        json_str: JSON string to deserialize

    Returns:
        Appropriate IPC message subclass instance

    Raises:
        ValueError: If message type is unknown
    """
    data = json.loads(json_str)

    # Determine message type based on fields
    if "command" in data:
        return BrowserCommandMessage.from_dict(data)
    elif "success" in data:
        return BrowserResponseMessage.from_dict(data)
    elif "initial_url" in data or "config" in data:
        return ProcessSpawnMessage.from_dict(data)
    elif "reason" in data or "force" in data:
        return ProcessShutdownMessage.from_dict(data)
    else:
        # Fallback to base IPCMessage
        return IPCMessage.from_dict(data)
