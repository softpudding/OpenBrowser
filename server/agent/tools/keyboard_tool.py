"""
KeyboardTool - Type text and press named keys at the current focus.

Use 'type' for plain text input (after clicking a field to focus it). Use
'press' for named keys (Enter, Escape, Tab, arrows) and shortcuts with
modifiers (Ctrl+A, Cmd+K).
"""

from collections.abc import Sequence
from typing import List, Literal, Optional

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_keyboard_tool_description(conv_state=None) -> str:
    """Get the KeyboardTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "keyboard_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


KeyboardActionKind = Literal["type", "press", "clear"]


class KeyboardAction(OpenBrowserAction):
    """Type text, press a named key, or clear the focused field."""

    action: KeyboardActionKind = Field(
        description=(
            "'type' — type literal text into the focused field (click the "
            "field first to focus it). "
            "'press' — press a single named key, optionally with modifiers. "
            "Use this for Enter/Tab/Escape/Backspace/Delete/arrows and "
            "shortcuts like Ctrl+A. "
            "'clear' — select all and delete the contents of the focused "
            "field, then leave it empty for a fresh `type`."
        )
    )

    text: Optional[str] = Field(
        default=None,
        description="Text to type for 'type' (max 1000 chars).",
        max_length=1000,
    )
    key: Optional[str] = Field(
        default=None,
        description=(
            "Key name for 'press', e.g. 'Enter', 'Escape', 'Tab', "
            "'Backspace', 'ArrowDown', 'PageDown'. Single letters/digits "
            "also work ('a', '5')."
        ),
        max_length=50,
    )
    modifiers: List[str] = Field(
        default_factory=list,
        description=(
            "Modifier keys for 'press' (e.g. ['Control'], ['Shift', 'Alt']). "
            "Use 'Meta' for Cmd on macOS."
        ),
    )


class KeyboardTool(ToolDefinition[KeyboardAction, OpenBrowserObservation]):
    """Virtual keyboard — type text, press keys."""

    name = "keyboard"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["KeyboardTool"]:
        if terminal_executor is not None:
            executor = terminal_executor
        else:
            conversation_id = getattr(conv_state, "id", None)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_keyboard_tool_description(conv_state),
                action_type=KeyboardAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="Keyboard",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


register_tool("keyboard", KeyboardTool.create)
