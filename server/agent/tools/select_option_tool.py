"""SelectOptionTool — choose option(s) on a focused native `<select>`.

Native `<select>` dropdowns render in OS chrome rather than in the page
DOM, so they don't appear in CDP screenshots when opened. The flow is:
the agent moves the cursor over the select and clicks; the click is
intercepted and the available options are returned in the observation;
the agent then calls `select_option` with the desired value or label.
"""

from collections.abc import Sequence
from typing import List

from openhands.sdk.tool import (
    ToolDefinition,
    ToolAnnotations,
    register_tool,
)
from pydantic import Field

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.agent.tools.prompt_context import get_prompt_render_context
from server.agent.tools.prompt_loader import render_tool_prompt


def get_select_option_tool_description(conv_state=None) -> str:
    """Get the SelectOptionTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "select_option_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


class SelectOptionAction(OpenBrowserAction):
    """Choose option(s) on the native `<select>` focused by the previous click.

    Match order: exact `value` attribute → exact visible label → case-
    insensitive substring of the label. Pass multiple entries for
    `<select multiple>`.
    """

    values: List[str] = Field(
        description=(
            "Option(s) to select. Single entry for a normal `<select>`, "
            "multiple entries for `<select multiple>`. Each entry may be an "
            "option's `value` attribute or its visible label."
        ),
        min_length=1,
        max_length=50,
    )


class SelectOptionTool(
    ToolDefinition[SelectOptionAction, OpenBrowserObservation]
):
    """Pick from a native `<select>` after clicking it."""

    name = "select_option"

    @classmethod
    def create(
        cls, conv_state, terminal_executor=None
    ) -> Sequence["SelectOptionTool"]:
        if terminal_executor is not None:
            executor = terminal_executor
        else:
            conversation_id = getattr(conv_state, "id", None)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_select_option_tool_description(conv_state),
                action_type=SelectOptionAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="SelectOption",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


register_tool("select_option", SelectOptionTool.create)
