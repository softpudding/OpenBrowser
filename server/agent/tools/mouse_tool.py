"""
MouseTool - Move, click, drag, and scroll a virtual mouse cursor.

The agent emits target coordinates in the Qwen-VL [0, 1000] normalized space
(0 = viewport top-left, 1000 = bottom-right). The server denormalizes against
the captured viewport before dispatching CDP input events. A small arrow
cursor is rendered into the page DOM and appears in every screenshot.
"""

from collections.abc import Sequence
from typing import Literal, Optional

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_mouse_tool_description(conv_state=None) -> str:
    """Get the MouseTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "mouse_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


MouseActionKind = Literal["move", "click", "drag", "scroll", "reset"]


class MouseAction(OpenBrowserAction):
    """Move, click, drag, or scroll the virtual mouse cursor.

    Coordinates `x, y, x2, y2` are integers in the Qwen-VL [0, 1000]
    normalized space, with `(0, 0)` at the top-left of the viewport and
    `(1000, 1000)` at the bottom-right.
    """

    action: MouseActionKind = Field(
        description=(
            "What to do with the mouse. "
            "'move' — slide the cursor to (x, y). The cursor traces an eased "
            "path so hover effects fire naturally along the way. "
            "'click' — click WHERE THE CURSOR IS NOW. This is an in-place "
            "action: it does not accept a target coordinate. Move there "
            "first, verify the cursor is on the intended target in the "
            "screenshot, then click. Use `count: 2` for double-click, "
            "`count: 3` for triple-click. `button: 'right'` for context "
            "menus. "
            "'drag' — press at (x, y), drag to (x2, y2), release. "
            "'scroll' — scroll at the cursor position by `amount` in "
            "`direction`. "
            "'reset' — return the cursor to the viewport center."
        )
    )

    x: Optional[int] = Field(
        default=None,
        description=(
            "Target X in Qwen-VL [0, 1000] normalized space. Required for "
            "'move' and 'drag' (start). Ignored by 'click' — click is "
            "in-place; move first if you need to retarget."
        ),
        ge=0,
        le=1000,
    )
    y: Optional[int] = Field(
        default=None,
        description=(
            "Target Y in Qwen-VL [0, 1000] normalized space. Required for "
            "'move' and 'drag' (start). Ignored by 'click'."
        ),
        ge=0,
        le=1000,
    )
    x2: Optional[int] = Field(
        default=None,
        description="Drag end X in [0, 1000]. Required for 'drag'.",
        ge=0,
        le=1000,
    )
    y2: Optional[int] = Field(
        default=None,
        description="Drag end Y in [0, 1000]. Required for 'drag'.",
        ge=0,
        le=1000,
    )

    button: Literal["left", "right", "middle"] = Field(
        default="left",
        description="Mouse button for 'click' and 'drag'.",
    )
    count: int = Field(
        default=1,
        ge=1,
        le=3,
        description="Click count for 'click' (1 = single, 2 = double, 3 = triple).",
    )

    direction: Literal["up", "down", "left", "right"] = Field(
        default="down",
        description="Scroll direction for 'scroll'.",
    )
    amount: int = Field(
        default=300,
        ge=1,
        le=2000,
        description="Scroll amount in CSS pixels for 'scroll'.",
    )

    steps: int = Field(
        default=10,
        ge=2,
        le=40,
        description="Intermediate move steps for 'drag' (smoother for DnD libraries).",
    )


class MouseTool(ToolDefinition[MouseAction, OpenBrowserObservation]):
    """Virtual mouse — move, click, drag, scroll."""

    name = "mouse"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["MouseTool"]:
        if terminal_executor is not None:
            executor = terminal_executor
        else:
            conversation_id = getattr(conv_state, "id", None)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_mouse_tool_description(conv_state),
                action_type=MouseAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="Mouse",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


register_tool("mouse", MouseTool.create)
