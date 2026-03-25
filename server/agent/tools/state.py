"""Shared state management for pending element confirmations.

This module provides state isolation for multi-conversation browser automation.
Each conversation can have at most one pending element interaction confirmation.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class PendingConfirmation:
    """Represents a pending element interaction confirmation.

    Attributes:
        element_id: The numeric ID of the target element from the latest highlight.
        action_type: The type of action being confirmed ('click' or 'keyboard_input').
        full_html: The HTML content of the element for confirmation.
        extra_data: Additional data needed for the action (for example, 'text' for keyboard_input).
        screenshot_data_url: Base64-encoded screenshot showing the highlighted element.
    """

    element_id: str
    action_type: str  # 'click' or 'keyboard_input'
    full_html: str
    extra_data: Dict[str, Any] = field(default_factory=dict)
    screenshot_data_url: Optional[str] = None


class OpenBrowserState:
    """Manages pending confirmations for browser automation.

    Provides per-conversation state isolation using conversation_id as key.
    Each conversation can have at most one pending confirmation at a time.
    """

    def __init__(self) -> None:
        self.pending_confirmations: Dict[str, PendingConfirmation] = {}

    def set_pending(
        self,
        conversation_id: str,
        element_id: str,
        action_type: str,
        full_html: str,
        extra_data: Dict[str, Any] | None = None,
        screenshot_data_url: Optional[str] = None,
    ) -> None:
        """Set a pending confirmation for a conversation.

        Args:
            conversation_id: The unique identifier for the conversation.
            element_id: The numeric ID of the target element from the latest highlight.
            action_type: The type of action ('click' or 'keyboard_input').
            full_html: The HTML content of the element.
            extra_data: Optional additional data for the action.
            screenshot_data_url: Optional base64-encoded screenshot.
        """
        self.pending_confirmations[conversation_id] = PendingConfirmation(
            element_id=element_id,
            action_type=action_type,
            full_html=full_html,
            extra_data=extra_data or {},
            screenshot_data_url=screenshot_data_url,
        )

    def get_pending(self, conversation_id: str) -> Optional[PendingConfirmation]:
        """Get the pending confirmation for a conversation.

        Args:
            conversation_id: The unique identifier for the conversation.

        Returns:
            The PendingConfirmation if exists, None otherwise.
        """
        return self.pending_confirmations.get(conversation_id)

    def clear_pending(self, conversation_id: str) -> None:
        """Clear the pending confirmation for a conversation.

        Args:
            conversation_id: The unique identifier for the conversation.
        """
        if conversation_id in self.pending_confirmations:
            del self.pending_confirmations[conversation_id]
