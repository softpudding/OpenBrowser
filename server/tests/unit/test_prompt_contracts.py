"""Contract tests for agent-facing tool prompts and observation guidance."""

import sys
import importlib.util
from pathlib import Path

from openhands.sdk import TextContent


def import_module(module_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


BASE_MODULE_PATH = Path(__file__).parent.parent.parent / "agent" / "tools" / "base.py"
base_module = import_module(BASE_MODULE_PATH, "server.agent.tools.base")
OpenBrowserObservation = base_module.OpenBrowserObservation

HIGHLIGHT_TOOL_PATH = (
    Path(__file__).parent.parent.parent / "agent" / "tools" / "highlight_tool.py"
)
highlight_tool_module = import_module(
    HIGHLIGHT_TOOL_PATH, "server.agent.tools.highlight_tool"
)
HighlightAction = highlight_tool_module.HighlightAction
get_highlight_tool_description = highlight_tool_module.get_highlight_tool_description

TAB_TOOL_PATH = Path(__file__).parent.parent.parent / "agent" / "tools" / "tab_tool.py"
tab_tool_module = import_module(TAB_TOOL_PATH, "server.agent.tools.tab_tool")
get_tab_tool_description = tab_tool_module.get_tab_tool_description

from server.models.commands import HighlightElementsCommand


class TestPromptContracts:
    def test_highlight_defaults_to_any_in_tool_action(self) -> None:
        action = HighlightAction()
        assert action.element_type == "any"

    def test_highlight_defaults_to_any_in_command_model(self) -> None:
        command = HighlightElementsCommand()
        assert command.element_type == "any"

    def test_highlight_prompt_matches_any_default(self) -> None:
        desc = get_highlight_tool_description()
        assert "Default: any interactive elements, page 1" in desc
        assert '"any" (default)' in desc
        assert '"clickable" (default without keywords)' not in desc

    def test_tab_prompt_uses_tab_view_not_screenshot_tool(self) -> None:
        desc = get_tab_tool_description()
        assert "use `tab view`" in desc
        assert "call `screenshot` explicitly" not in desc

    def test_dialog_guidance_uses_dialog_tool_name(self) -> None:
        obs = OpenBrowserObservation(
            success=True,
            dialog_opened=True,
            dialog={
                "type": "confirm",
                "message": "Delete item?",
                "needsDecision": True,
            },
        )
        content = obs.to_llm_content
        assert len(content) == 1
        assert isinstance(content[0], TextContent)
        text = content[0].text
        assert "Use the `dialog` tool to respond." in text
        assert '`{"dialog_action": "accept"}' in text
        assert "handle_dialog" not in text
