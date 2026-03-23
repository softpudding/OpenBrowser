"""Contract tests for agent-facing prompts and observation guidance."""

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import patch

from openhands.sdk import TextContent

from server.models.commands import HighlightElementsCommand

TOOLS_DIR = Path(__file__).resolve().parents[2] / "agent" / "tools"
AGENT_DIR = TOOLS_DIR.parent

agent_module = types.ModuleType("server.agent")
agent_module.__path__ = [str(AGENT_DIR)]
sys.modules.setdefault("server.agent", agent_module)

tools_module = types.ModuleType("server.agent.tools")
tools_module.__path__ = [str(TOOLS_DIR)]
sys.modules.setdefault("server.agent.tools", tools_module)


def _import_module(module_name: str, filename: str):
    spec = importlib.util.spec_from_file_location(module_name, TOOLS_DIR / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


base_module = _import_module("server.agent.tools.base", "base.py")
_import_module("server.agent.tools.prompt_context", "prompt_context.py")
highlight_tool_module = _import_module(
    "server.agent.tools.highlight_tool", "highlight_tool.py"
)
tab_tool_module = _import_module("server.agent.tools.tab_tool", "tab_tool.py")

OpenBrowserObservation = base_module.OpenBrowserObservation
HighlightAction = highlight_tool_module.HighlightAction
get_highlight_tool_description = highlight_tool_module.get_highlight_tool_description
get_tab_tool_description = tab_tool_module.get_tab_tool_description


class TestPromptContracts:
    def test_highlight_defaults_are_aligned_between_tool_and_wire_command(self) -> None:
        assert HighlightAction().element_type == "any"
        assert HighlightElementsCommand().element_type == "any"

    def test_highlight_prompt_matches_default_any_workflow(self) -> None:
        description = get_highlight_tool_description()

        assert "Default: any interactive elements, page 1" in description
        assert '"any" (default)' in description
        assert '"clickable" (default without keywords)' not in description

    def test_highlight_prompt_guides_icon_targets_to_clickable_pagination(self) -> None:
        description = get_highlight_tool_description()

        assert "icon-only controls" in description
        assert "Stay on the same `element_type` across pages" in description
        assert "actual button may simply be on the next page" in description

    def test_highlight_prompt_requires_exact_text_keywords_and_pagination_before_guessing(self) -> None:
        description = get_highlight_tool_description()

        assert "Treat pages as reliable collision-free slices of the same candidate set" in description
        assert "Do not jump from a first-page miss to `keywords`" in description
        assert "Use keywords only for exact observed readable text or stable tokens" in description
        assert "DO NOT use synonym bundles like" in description
        assert "Examples of broad search" not in description
        assert "Phase 2: Broad Search" not in description

    def test_highlight_prompt_requires_rehighlight_after_significant_page_change(self) -> None:
        description = get_highlight_tool_description()

        assert "After any significant page-state change" in description
        assert 'call `highlight` with `element_type: "any"` again before choosing the next element' in description

    def test_small_model_highlight_prompt_bans_keywords_for_generic_controls(self) -> None:
        with patch.object(
            highlight_tool_module,
            "get_prompt_render_context",
            return_value={
                "model_name": "dashscope/qwen3.5-flash",
                "model_profile": "small",
                "small_model": True,
            },
        ):
            description = get_highlight_tool_description()

        assert (
            "Never use `keywords` for guessed labels, unread text, or icon-only controls such as `×` or `🔍`"
            in description
        )

    def test_tab_prompt_points_agents_to_tab_view_for_clean_screenshots(self) -> None:
        description = get_tab_tool_description()

        assert "tab view" in description
        assert "clean screenshot" in description.lower()

    def test_dialog_guidance_uses_dialog_tool_name(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            dialog_opened=True,
            dialog={
                "type": "confirm",
                "message": "Delete item?",
                "needsDecision": True,
            },
        )

        content = observation.to_llm_content

        assert len(content) == 1
        assert isinstance(content[0], TextContent)
        assert "Use the `dialog` tool to respond." in content[0].text
        assert '`{"dialog_action": "accept"}' in content[0].text
        assert "handle_dialog" not in content[0].text
