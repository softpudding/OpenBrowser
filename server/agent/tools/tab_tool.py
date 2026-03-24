"""
TabTool - Tool for managing browser tabs.

This tool provides tab management operations including initialization,
opening, closing, switching, listing, refreshing, and viewing tabs.
"""

from collections.abc import Sequence
from typing import Any, Dict, Literal, Optional

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_tab_tool_description(conv_state=None) -> str:
    """Get the TabTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "tab_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


class TabAction(OpenBrowserAction):
    """Action for tab management operations."""

    action: Literal[
        "init", "open", "close", "switch", "list", "refresh", "view", "back", "forward"
    ] = Field(description="Tab action to perform")
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
            conversation_id = getattr(conv_state, "id", None)

            # Get shared executor for this conversation (or create new if no conversation_id)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_tab_tool_description(conv_state),
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
