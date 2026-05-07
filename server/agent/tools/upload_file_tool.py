"""UploadFileTool — attach files to a focused `<input type="file">`.

OS file pickers don't render into CDP screenshots, so the flow is: the
agent clicks the upload control, the click is intercepted and focuses
the underlying file input, then `upload_file` attaches files via
`DOM.setFileInputFiles`. Paths must be absolute and exist on the host
running Chrome.
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


def get_upload_file_tool_description(conv_state=None) -> str:
    """Get the UploadFileTool description, rendered from Jinja2 template."""
    return render_tool_prompt(
        "upload_file_tool.j2",
        conv_state,
        context=get_prompt_render_context(conv_state),
    )


class UploadFileAction(OpenBrowserAction):
    """Attach file(s) to the native file input focused by the previous click."""

    paths: List[str] = Field(
        description=(
            "Absolute file paths to attach. One entry for a normal upload, "
            "multiple entries for `<input type=file multiple>`. Paths must "
            "exist on the host running the browser."
        ),
        min_length=1,
        max_length=20,
    )


class UploadFileTool(ToolDefinition[UploadFileAction, OpenBrowserObservation]):
    """Upload file(s) to a native file input after clicking it."""

    name = "upload_file"

    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence["UploadFileTool"]:
        if terminal_executor is not None:
            executor = terminal_executor
        else:
            conversation_id = getattr(conv_state, "id", None)
            from server.agent.tools.browser_executor import get_browser_executor

            executor = get_browser_executor(conversation_id)

        return [
            cls(
                description=get_upload_file_tool_description(conv_state),
                action_type=UploadFileAction,
                observation_type=OpenBrowserObservation,
                annotations=ToolAnnotations(
                    title="UploadFile",
                    readOnlyHint=False,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=True,
                ),
                executor=executor,
            )
        ]


register_tool("upload_file", UploadFileTool.create)
