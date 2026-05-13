"""
MouseTool - Move, click, drag, and scroll a virtual mouse cursor.

The agent emits target coordinates in the Qwen-VL [0, 1000] normalized space
(0 = viewport top-left, 1000 = bottom-right). The server denormalizes against
the captured viewport before dispatching CDP input events. A small arrow
cursor is rendered into the page DOM and appears in every screenshot.
"""

from collections.abc import Sequence
from typing import List, Literal, Optional

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field, field_validator

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


MouseActionKind = Literal["move", "click", "drag", "scroll", "reset", "confirm"]


def _validate_coordinate_pair(v: Optional[List[int]]) -> Optional[List[int]]:
    """Coordinate fields are 2-element [x, y] arrays, each int in [0, 1000].

    Accepts None (omitted), rejects everything else with a single clear
    message so the agent can self-correct without parsing pydantic's
    multi-error output.
    """
    if v is None:
        return v
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise ValueError(
            "coordinate must be a 2-element array like [x, y] in [0, 1000] space"
        )
    out: List[int] = []
    for i, n in enumerate(v):
        if isinstance(n, bool) or not isinstance(n, int):
            try:
                n = int(n)
            except (TypeError, ValueError):
                raise ValueError(f"coordinate[{i}] must be an integer in [0, 1000]")
        if n < 0 or n > 1000:
            raise ValueError(
                f"coordinate[{i}] = {n} is outside [0, 1000] normalized space"
            )
        out.append(n)
    return out


class MouseAction(OpenBrowserAction):
    """Move, click, drag, or scroll the virtual mouse cursor.

    Coordinates are 2-element `[x, y]` arrays in the Qwen-VL [0, 1000]
    normalized space, with `[0, 0]` at the top-left of the viewport and
    `[1000, 1000]` at the bottom-right.
    """

    action: MouseActionKind = Field(
        default="move",
        description=(
            "What to do with the mouse. Defaults to 'move' when omitted. "
            "'move' — slide the cursor to `coordinate`. The cursor traces an "
            "eased path so hover effects fire naturally along the way. "
            "'click' — click on the page. Pass `coordinate` to move the "
            "cursor there and click in one step; omit `coordinate` to click "
            "at the cursor's current position (use this after a 'move' for a "
            "hover-then-click flow). `count: 2` double-clicks, `count: 3` "
            'triple-clicks. `button: "right"` opens the context menu. '
            "'drag' — press at `start_coordinate`, drag to `end_coordinate`, "
            "release. "
            "'scroll' — scroll at the cursor position by `amount` in "
            "`direction`. "
            "'reset' — return the cursor to the viewport center. "
            "'confirm' — commit a pending click or drag that was previewed "
            "as a zoomed crop in the previous response."
        ),
    )

    coordinate: Optional[List[int]] = Field(
        default=None,
        description=(
            "Target as `[x, y]` in [0, 1000] normalized space. Used by "
            "'move' (destination), 'click' (where to click — omit to click "
            "the cursor's current position), and 'scroll' (cursor position). "
            "Example: `[405, 157]`."
        ),
    )
    start_coordinate: Optional[List[int]] = Field(
        default=None,
        description=(
            "Drag start point as `[x, y]` in [0, 1000] normalized space. "
            "Required for 'drag'. Example: `[200, 400]`."
        ),
    )
    end_coordinate: Optional[List[int]] = Field(
        default=None,
        description=(
            "Drag end point as `[x, y]` in [0, 1000] normalized space. "
            "Required for 'drag'. Example: `[820, 540]`."
        ),
    )

    @field_validator("coordinate", "start_coordinate", "end_coordinate", mode="before")
    @classmethod
    def _check_coord(cls, v):
        return _validate_coordinate_pair(v)

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
        description=(
            "Scroll distance for 'scroll', in the same [0, 1000] space as "
            "coordinates: 1000 is one full viewport in the chosen direction, "
            "500 is half."
        ),
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
