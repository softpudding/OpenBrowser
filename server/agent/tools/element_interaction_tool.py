"""
ElementInteractionTool - Tool for visual element interactions.

Click, keyboard input, and select use a two-phase commit (2PC) confirmation
flow. Hover, scroll, and swipe execute directly.
"""

from collections.abc import Sequence
from typing import List, Literal, Optional, Union

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_element_interaction_tool_description(conv_state=None) -> str:
    """Get the ElementInteractionTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "element_interaction_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


class ElementInteractionAction(OpenBrowserAction):
    """Action for element interactions."""

    action: Literal[
        "click",
        "hover",
        "scroll",
        "swipe",
        "keyboard_input",
        "select",
        "drag_and_drop",
        "set_slider",
        "upload_file",
        "confirm_click",
        "confirm_keyboard_input",
        "confirm_select",
        "confirm_drag_and_drop",
    ] = Field(
        description="Element interaction action (click, keyboard_input, select, and drag_and_drop require confirm_* follow-up; confirm_* executes the current pending confirmation; hover/scroll/swipe/set_slider/upload_file execute directly)"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Element ID (short opaque string) from highlight. Required for click, hover, element scroll/swipe, keyboard_input, select, drag_and_drop (source), set_slider, and upload_file. Ignored for confirm_* actions.",
    )
    direction: Optional[Literal["up", "down", "left", "right", "next", "prev"]] = Field(
        default="down",
        description=(
            "Movement direction for scroll/swipe. Use up/down/left/right for "
            "scroll. For swipe, use semantic next/prev only: 'next' shows the "
            "next picture/item and 'prev' shows the previous picture/item. Do "
            "not reinterpret swipe as left/right."
        ),
    )
    scroll_amount: Optional[float] = Field(
        default=0.5,
        ge=0.1,
        le=3.0,
        description=(
            "Scroll amount as a multiple of the current scroll target's visible "
            "size (0.1-3.0). If no element_id is provided, the target is the "
            "page viewport. If element_id refers to a scrollable region, the "
            "target is that element's visible container."
        ),
    )
    swipe_count: Optional[int] = Field(
        default=1,
        ge=1,
        le=5,
        description="Number of swipe steps for carousel/swiper interactions (1-5)",
    )
    text: Optional[str] = Field(
        default=None,
        description="Text to input for keyboard_input actions",
    )
    value: Optional[Union[str, List[str], float]] = Field(
        default=None,
        description=(
            "For `select`: option value(s) as string or list. "
            "For `set_slider`: target value as a number inside [min, max] or a "
            "percentage string like '75%' interpreted between min and max."
        ),
    )
    target_element_id: Optional[str] = Field(
        default=None,
        description=("Drop target container element ID for `drag_and_drop`. Required."),
    )
    relative_to: Optional[str] = Field(
        default=None,
        description=(
            "Inner element ID for precise drop placement in `confirm_drag_and_drop`. "
            "This ID comes from the drop preview's inner element list. "
            "Omit to drop at the end of the container."
        ),
    )
    position: Optional[str] = Field(
        default=None,
        description=(
            "Where to place the dragged element relative to `relative_to`: "
            "'before' (above/left) or 'after' (below/right). "
            "Only used with `confirm_drag_and_drop` when `relative_to` is set. "
            "Defaults to 'before'."
        ),
    )
    steps: Optional[int] = Field(
        default=10,
        ge=2,
        le=40,
        description="Number of intermediate mousemove steps for drag_and_drop (2-40).",
    )
    file_path: Optional[str] = Field(
        default=None,
        description=(
            "For `upload_file`: absolute path to the local file to attach to "
            "the target <input type=file>. Must exist on the host running the "
            "browser. Required for upload_file; ignored otherwise."
        ),
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Tab ID (optional, uses active tab if not specified). confirm_* actions use the tab stored in the pending confirmation.",
    )


class ElementInteractionTool(
    ToolDefinition[ElementInteractionAction, OpenBrowserObservation]
):
    """Tool for element interactions with selective 2PC safety."""

    name = "element_interaction"

    @classmethod
    def create(
        cls, conv_state, terminal_executor=None
    ) -> Sequence["ElementInteractionTool"]:
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
            conversation_id = getattr(conv_state, "id", None)

            # Get shared executor for this conversation (or create new if no conversation_id)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_element_interaction_tool_description(conv_state),
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
