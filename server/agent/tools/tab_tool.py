"""
TabTool - Tool for managing browser tabs.

This tool provides tab management operations including initialization,
opening, closing, switching, listing, refreshing, and viewing tabs.
"""

import os
import jinja2
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Dict, Literal, Optional

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
_TAB_TOOL_TEMPLATE = None


def get_tab_tool_description() -> str:
    """Get the TabTool description, rendered from Jinja2 template."""
    global _TAB_TOOL_TEMPLATE
    
    # Load template if not cached
    if _TAB_TOOL_TEMPLATE is None:
        _TAB_TOOL_TEMPLATE = _TEMPLATE_ENV.get_template('tab_tool.j2')
    
    # Render template with context
    return _TAB_TOOL_TEMPLATE.render()


class TabAction(OpenBrowserAction):
    """Action for tab management operations."""

    action: Literal["init", "open", "close", "switch", "list", "refresh", "view", "back", "forward"] = (
        Field(description="Tab action to perform")
    )
    url: Optional[str] = Field(
        default=None,
        description="URL for init/open actions",
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Tab ID for close/switch/refresh/view/back/forward actions",
    )


class TabTool(ToolDefinition[TabAction, OpenBrowserObservation]):
    """Tool for managing browser tabs."""

    name = "tab"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["TabTool"]:
        """Create TabTool instance.

        Args:
            conv_state: Conversation state for session isolation.
            terminal_executor: Optional BrowserExecutor instance for handling commands.
                             If None, creates a new BrowserExecutor.

        Returns:
            List containing a single TabTool instance.
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
                description=get_tab_tool_description(),
                action_type=TabAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="tab",
                    readOnlyHint=False,
                    destructiveHint=True,  # close action can be destructive
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


# Register the tool
register_tool("tab", TabTool.create)
