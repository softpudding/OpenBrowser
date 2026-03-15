"""
ElementInteractionTool - Tool for element interactions with 2PC safety mechanism.

This tool provides element interaction operations including click, hover, scroll,
and keyboard input, with a two-phase commit (2PC) safety mechanism to prevent
accidental interactions.
"""

import os
import jinja2
from collections.abc import Sequence
from pathlib import Path
from typing import Literal, Optional

from openhands.sdk.tool import ToolDefinition, ToolAnnotations, ToolExecutor, register_tool
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation


# Setup Jinja2 template environment for prompts
_TEMPLATE_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(Path(__file__).parent.parent / 'prompts'),
    autoescape=jinja2.select_autoescape(['html', 'xml']),
    trim_blocks=True,
    lstrip_blocks=True
)

# Template cache
_ELEMENT_INTERACTION_TOOL_TEMPLATE = None


def get_element_interaction_tool_description() -> str:
    """Get the ElementInteractionTool description, rendered from Jinja2 template."""
    global _ELEMENT_INTERACTION_TOOL_TEMPLATE
    
    # Load template if not cached
    if _ELEMENT_INTERACTION_TOOL_TEMPLATE is None:
        _ELEMENT_INTERACTION_TOOL_TEMPLATE = _TEMPLATE_ENV.get_template('element_interaction_tool.j2')
    
    # Render template with context
    return _ELEMENT_INTERACTION_TOOL_TEMPLATE.render()


class ElementInteractionAction(OpenBrowserAction):
    """Action for element interactions with 2PC safety mechanism."""

    action: Literal[
        "click",
        "hover",
        "scroll",
        "keyboard_input",
        "confirm_click",
        "confirm_hover",
        "confirm_scroll",
        "confirm_keyboard_input",
    ] = Field(
        description="Element interaction action (use 'click'/'hover'/'scroll'/'keyboard_input' for preview, 'confirm_*' to execute)"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Element ID (6-character hash) from highlight_elements",
    )
    direction: Optional[Literal["up", "down", "left", "right"]] = Field(
        default="down",
        description="Scroll direction (up, down, left, right)",
    )
    scroll_amount: Optional[float] = Field(
        default=0.5,
        ge=0.1,
        le=3.0,
        description="Scroll amount as fraction of viewport (0.1-3.0)",
    )
    text: Optional[str] = Field(
        default=None,
        description="Text to input for keyboard_input actions",
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Tab ID (optional, uses active tab if not specified)",
    )


class ElementInteractionTool(
    ToolDefinition[ElementInteractionAction, OpenBrowserObservation]
):
    """Tool for element interactions with 2PC safety mechanism."""

    name = "element_interaction"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["ElementInteractionTool"]:
        """Create ElementInteractionTool instance.

        Args:
            conv_state: Conversation state for session isolation.
            terminal_executor: Optional BrowserExecutor instance for handling commands.
                             If None, creates a new BrowserExecutor.

        Returns:
            List containing a single ElementInteractionTool instance.
        """
        # Use provided executor or get shared executor for conversation
        if terminal_executor is not None:
            executor = terminal_executor
        else:
            # Try to get conversation ID from conv_state to share executor across tools
            # conv_state: openhands-sdk ConversationState
            conversation_id = conv_state.id
            
            # Get shared executor for this conversation (or create new if no conversation_id)
            from server.agent.tools.browser_executor import get_browser_executor
            executor = get_browser_executor(conversation_id)
        
        return [
            cls(
                description=get_element_interaction_tool_description(),
                action_type=ElementInteractionAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="element_interaction",
                    readOnlyHint=False,
                    destructiveHint=True,  # click/keyboard_input can modify state
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


# Register the tool
register_tool("element_interaction", ElementInteractionTool.create)
