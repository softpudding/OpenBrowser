"""
HighlightTool - AI tool for highlighting interactive elements on web pages.

This tool provides visual element detection with collision-aware pagination,
allowing the AI agent to see and interact with elements via labeled overlays.
"""

from collections.abc import Sequence
from typing import Optional, List

from pydantic import Field
from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_highlight_tool_description(conv_state=None) -> str:
    """Get the HighlightTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "highlight_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


class BaseHighlightAction(OpenBrowserAction):
    """Shared highlight action fields."""

    element_type: str = Field(
        default="any",
        description="Single element type to highlight for agent-visible guidance: any/scrollable/inputable/selectable/draggable/droppable. Defaults to 'any'.",
    )
    page: int = Field(
        default=1,
        ge=1,
        description="Page number for pagination (1-indexed).",
    )


class HighlightAction(BaseHighlightAction):
    """Large-model highlight action with exact-text keyword filtering."""

    keywords: Optional[List[str]] = Field(
        default=None,
        description="Exact observed text or stable tokens to filter elements by detected semantic text (visible text, labels, roles, and stable element tokens). Use only for wording already seen in the screenshot or returned HTML. When provided, returns all matching elements (no pagination). Example: ['Continue with Email', 'View comments']",
    )


class SmallModelHighlightAction(BaseHighlightAction):
    """Small-model highlight action without keyword filtering."""


class SmallModelRoutineReplayHighlightAction(BaseHighlightAction):
    """Small-model highlight action restricted to Routine-supplied keywords.

    Routine replay is the only mode in which a small model is trusted to
    pass `keywords`, because the value must come verbatim from the active
    Routine step's `**Keywords:**` line — never invented by the model. The
    system prompt's <ROUTINE_REPLAY> block enforces that rule, and this
    action mirrors it by exposing the field only in replay sessions.
    """

    keywords: Optional[List[str]] = Field(
        default=None,
        description=(
            "Stable token from the active Routine step's `**Keywords:** "
            "<token>` line. Pass verbatim as a single-element list. See "
            "the system prompt's <ROUTINE_REPLAY> block for the full "
            "rules."
        ),
    )


def get_highlight_action_type(conv_state=None) -> type[BaseHighlightAction]:
    """Return the model-aware highlight action schema.

    In routine-replay mode, small models may use `keywords` too — but only
    with a token copied verbatim from the active Routine step's
    `**Keywords:**` line. That carve-out is enforced by both the system
    prompt's <ROUTINE_REPLAY> block and the
    ``SmallModelRoutineReplayHighlightAction`` description.
    """
    context = get_prompt_render_context(conv_state)
    if context.get("small_model"):
        if context.get("routine_replay_mode"):
            return SmallModelRoutineReplayHighlightAction
        return SmallModelHighlightAction
    return HighlightAction


class HighlightTool(ToolDefinition[BaseHighlightAction, OpenBrowserObservation]):
    """Tool for highlighting interactive elements with visual overlays."""

    name = "highlight"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["HighlightTool"]:
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
            conversation_id = getattr(conv_state, "id", None)

            # Get shared executor for this conversation (or create new if no conversation_id)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_highlight_tool_description(conv_state),
                action_type=get_highlight_action_type(conv_state),
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
