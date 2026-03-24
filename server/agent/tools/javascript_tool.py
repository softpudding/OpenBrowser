"""
JavaScriptTool - AI tool for executing JavaScript in the browser.

This tool serves as a fallback mechanism for complex browser interactions
that are not covered by visual commands (highlight, click, hover, scroll, keyboard_input).

Key characteristics:
- Results must be JSON-serializable (no DOM nodes)
- For React/Vue apps, dispatch full event sequence (not just .click())
- Call `screenshot` command after if visual feedback is needed
- Can be disabled via OPEN_BROWSER_DISABLE_JAVASCRIPT_EXECUTE environment variable
"""

import os
import logging
from collections.abc import Sequence

from pydantic import Field
from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_loader import render_tool_prompt

logger = logging.getLogger(__name__)

# Environment variable to disable javascript tool
DISABLE_JAVASCRIPT_EXECUTE = os.getenv(
    "OPEN_BROWSER_DISABLE_JAVASCRIPT_EXECUTE", ""
).lower() in ("1", "true", "yes")

def get_javascript_tool_description(conv_state=None) -> str:
    """Get the JavaScriptTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "javascript_tool.j2",
        conv_state,
        disable_javascript=DISABLE_JAVASCRIPT_EXECUTE
    )


class JavaScriptAction(OpenBrowserAction):
    """Action for executing JavaScript code in the browser."""

    script: str = Field(
        description="JavaScript code to execute. Must return a JSON-serializable value."
    )


class JavaScriptTool(ToolDefinition[JavaScriptAction, OpenBrowserObservation]):
    """Tool for executing JavaScript in the browser.

    This tool provides a dedicated interface for JavaScript execution,
    following the same pattern as other tools in the system.
    """

    name = "javascript"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["JavaScriptTool"]:
        """Create JavaScriptTool instance.

        Args:
            conv_state: Conversation state for session isolation.
            terminal_executor: Optional BrowserExecutor instance for handling commands.
                             If None, creates a new BrowserExecutor.

        Returns:
            List containing the JavaScriptTool instance
        """
        # Check if disabled via environment variable
        if DISABLE_JAVASCRIPT_EXECUTE:
            logger.info(
                "JavaScriptTool is disabled via OPEN_BROWSER_DISABLE_JAVASCRIPT_EXECUTE"
            )
            return []

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
                description=get_javascript_tool_description(conv_state),
                action_type=JavaScriptAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="JavaScript",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


# Register the tool
register_tool("javascript", JavaScriptTool.create)
