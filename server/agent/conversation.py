"""
Conversation State Model

Dataclass for managing conversation state in memory.
Supports both single-process and multi-process modes.
"""

import time
from dataclasses import dataclass, field
from typing import Optional

from openhands.sdk import Conversation

from server.agent.visualizer import QueueVisualizer


@dataclass
class ConversationState:
    """State for a conversation.

    In single-process mode, conversation and visualizer are populated.
    In multi-process mode, these are None in the main process (they exist
    in the worker process instead).
    """

    conversation_id: str
    conversation: Optional[Conversation] = None
    visualizer: Optional[QueueVisualizer] = None
    created_at: float = field(default_factory=time.time)
