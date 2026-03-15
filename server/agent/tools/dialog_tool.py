"""
DialogTool - AI tool for handling browser dialogs (alert/confirm/prompt/beforeunload).

This tool allows an AI agent to respond to JavaScript dialogs that block browser
execution. Dialogs must be handled before any further browser operations can proceed.
"""

import os
import jinja2
from collections.abc import Sequence
from pathlib import Path
from typing import Optional, Literal

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
_DIALOG_TOOL_TEMPLATE = None


def get_dialog_tool_description() -> str:
    """Get the DialogTool description, rendered from Jinja2 template."""
    global _DIALOG_TOOL_TEMPLATE
    
    # Load template if not cached
    if _DIALOG_TOOL_TEMPLATE is None:
        _DIALOG_TOOL_TEMPLATE = _TEMPLATE_ENV.get_template('dialog_tool.j2')
    
    # Render template with context
    return _DIALOG_TOOL_TEMPLATE.render()


class DialogHandleAction(OpenBrowserAction):
    """Action to handle a browser dialog."""

    dialog_action: Literal["accept", "dismiss"] = Field(
        description="Action to take: 'accept' (OK) or 'dismiss' (Cancel)"
    )
    prompt_text: Optional[str] = Field(
        default=None,
        description="Text to enter for prompt dialogs (only used if dialog is a prompt)",
    )


class DialogTool(ToolDefinition[DialogHandleAction, OpenBrowserObservation]):
    """Tool for handling browser dialogs."""

    name = "dialog"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["DialogTool"]:
        """Create DialogTool instance.

        Args:
            conv_state: Conversation state for session isolation.
            terminal_executor: Optional BrowserExecutor instance for handling commands.
                             If None, creates a new BrowserExecutor.

        Returns:
            Sequence containing a single DialogTool instance
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
                description=get_dialog_tool_description(),
                action_type=DialogHandleAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="Dialog",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


# Register the tool
register_tool("dialog", DialogTool.create)
