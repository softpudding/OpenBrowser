"""Tool for explicit agent-to-human handoff requests."""

from collections.abc import Sequence
from typing import Any

from pydantic import Field
from rich.text import Text

from openhands.sdk import Action, TextContent
from openhands.sdk.conversation.state import ConversationExecutionStatus
from openhands.sdk.tool import (
    ToolAnnotations,
    ToolDefinition,
    ToolExecutor,
    register_tool,
)

from server.agent.user_help import PLEASE_HELP_ME_TOOL_NAME
from server.agent.tools.base import OpenBrowserObservation


class PleaseHelpMeAction(Action):
    """Action asking the human user to complete a manual step."""

    message: str = Field(
        description=(
            "The exact message to show the human user, describing what they need "
            "to do manually before you can continue."
        )
    )

    @property
    def visualize(self) -> Text:
        content = Text()
        content.append("Please help me:\n", style="bold yellow")
        content.append(self.message)
        return content


class PleaseHelpMeObservation(OpenBrowserObservation):
    """Observation shown after a help request is emitted."""

    help_message: str = Field(
        description="The help request shown to the user for this pending turn."
    )
    pending_user_decision: bool = Field(
        default=True,
        description="Whether the agent is waiting for the user's manual help.",
    )

    @property
    def visualize(self) -> Text:
        return Text("Pending user's decision")

    @property
    def to_llm_content(self) -> Sequence[TextContent]:
        return [TextContent(text="Pending user's decision")]


class PleaseHelpMeExecutor(
    ToolExecutor[PleaseHelpMeAction, PleaseHelpMeObservation]
):
    """Executor that pauses the current turn and surfaces a user-help request."""

    def __call__(
        self, action: PleaseHelpMeAction, conversation: Any = None
    ) -> PleaseHelpMeObservation:
        if conversation is not None:
            conversation.state.execution_status = ConversationExecutionStatus.FINISHED

        return PleaseHelpMeObservation(
            success=True,
            message="Pending user's decision",
            help_message=action.message,
            pending_user_decision=True,
        )


class PleaseHelpMeTool(
    ToolDefinition[PleaseHelpMeAction, PleaseHelpMeObservation]
):
    """Tool for requesting human intervention."""

    name = PLEASE_HELP_ME_TOOL_NAME

    @classmethod
    def create(cls, conv_state=None, **params) -> Sequence["PleaseHelpMeTool"]:
        if params:
            raise ValueError("PleaseHelpMeTool doesn't accept parameters")

        return [
            cls(
                description=(
                    "Ask the human user to complete a manual step such as CAPTCHA, "
                    "MFA, approval, or any browser action you cannot safely do."
                ),
                action_type=PleaseHelpMeAction,
                observation_type=PleaseHelpMeObservation,
                executor=PleaseHelpMeExecutor(),
                annotations=ToolAnnotations(
                    title=PLEASE_HELP_ME_TOOL_NAME,
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=True,
                    openWorldHint=False,
                ),
            )
        ]


register_tool(PLEASE_HELP_ME_TOOL_NAME, PleaseHelpMeTool.create)
