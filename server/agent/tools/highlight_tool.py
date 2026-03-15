"""
HighlightTool - AI tool for highlighting interactive elements on web pages.

This tool provides visual element detection with collision-aware pagination,
allowing the AI agent to see and interact with elements via numbered overlays.
"""

import os
import jinja2
from collections.abc import Sequence
from pathlib import Path
from typing import Optional, List

from pydantic import Field
from openhands.sdk.tool import ToolDefinition, ToolAnnotations, ToolExecutor, register_tool

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation


# Setup Jinja2 template environment for prompts
_TEMPLATE_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(Path(__file__).parent.parent / 'prompts'),
    autoescape=jinja2.select_autoescape(['html', 'xml']),
    trim_blocks=True,
    lstrip_blocks=True
)

# Template cache
_HIGHLIGHT_TOOL_TEMPLATE = None


def get_highlight_tool_description() -> str:
    """Get the HighlightTool description, rendered from Jinja2 template."""
    global _HIGHLIGHT_TOOL_TEMPLATE
    
    # Load template if not cached
    if _HIGHLIGHT_TOOL_TEMPLATE is None:
        _HIGHLIGHT_TOOL_TEMPLATE = _TEMPLATE_ENV.get_template('highlight_tool.j2')
    
    # Render template with context
    return _HIGHLIGHT_TOOL_TEMPLATE.render()




class HighlightAction(OpenBrowserAction):
    """Action for highlighting interactive elements on a web page."""

    element_type: str = Field(
        default="clickable",
        description="Single element type to highlight: clickable/scrollable/inputable/hoverable",
    )
    page: int = Field(
        default=1,
        ge=1,
        description="Page number for pagination (1-indexed). Ignored when keywords is provided.",
    )
    keywords: Optional[List[str]] = Field(
        default=None,
        description="Keywords list to filter elements by HTML content. When provided, returns all matching elements (no pagination). Example: ['button', 'submit', 'login']",
    )


class HighlightTool(ToolDefinition[HighlightAction, OpenBrowserObservation]):
    """Tool for highlighting interactive elements with visual overlays."""

    name = "highlight"

    @classmethod
    def create(
        cls, conv_state, terminal_executor=None
    ) -> Sequence["HighlightTool"]:
        """Create HighlightTool instance.

        Args:
            conv_state: Conversation state for session isolation.
            terminal_executor: Optional BrowserExecutor instance for handling commands.
                             If None, creates a new BrowserExecutor.

        Returns:
            Sequence containing a single HighlightTool instance
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
                description=get_highlight_tool_description(),
                action_type=HighlightAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="Highlight Elements",
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


# Register the tool
register_tool("highlight", HighlightTool.create)
