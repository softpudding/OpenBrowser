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
element_interaction_tool_module = _import_module(
    "server.agent.tools.element_interaction_tool", "element_interaction_tool.py"
)
tab_tool_module = _import_module("server.agent.tools.tab_tool", "tab_tool.py")

OpenBrowserObservation = base_module.OpenBrowserObservation
HighlightAction = highlight_tool_module.HighlightAction
get_highlight_action_type = highlight_tool_module.get_highlight_action_type
get_highlight_tool_description = highlight_tool_module.get_highlight_tool_description
get_element_interaction_tool_description = (
    element_interaction_tool_module.get_element_interaction_tool_description
)
ElementInteractionAction = element_interaction_tool_module.ElementInteractionAction
get_tab_tool_description = tab_tool_module.get_tab_tool_description


class TestPromptContracts:
    def test_highlight_defaults_are_aligned_between_tool_and_wire_command(self) -> None:
        assert HighlightAction().element_type == "any"
        assert HighlightElementsCommand().element_type == "any"

    def test_highlight_prompt_matches_default_any_workflow(self) -> None:
        description = get_highlight_tool_description()

        assert "Default: any interactive elements, page 1" in description
        assert 'Single type to highlight - `"any"` (default)' in description
        assert (
            "Most completed browser actions already return the default "
            '`highlight` `element_type: "any"` page 1 observation' in description
        )
        assert "Use that returned observation first." in description
        assert "element_id" in description
        assert '"clickable" (default without keywords)' not in description

    def test_highlight_prompt_keeps_icon_targets_on_any_pagination(self) -> None:
        description = get_highlight_tool_description()

        assert "icon-only" in description
        assert "stay on the same `element_type` across pages" in description
        assert "your default next step is the next page in the same mode" in description
        assert (
            "If a likely target is already partly visible, clipped, or crowded by sticky UI, use `scroll` to improve geometry before paginating."
            in description
        )
        assert (
            "Keep generic controls, buttons, links, dense toolbars, and icon-only targets inside `any`"
            in description
        )
        assert "`clickable`" not in description

    def test_highlight_prompt_treats_partly_visible_targets_as_geometry_problem(
        self,
    ) -> None:
        description = get_highlight_tool_description()

        assert (
            "If the target or a likely candidate is already partly visible, clipped by the viewport edge, or cramped by sticky UI, use `scroll` to reposition it before asking for more `highlight` pages."
            in description
        )
        assert (
            "If the target is truly absent from the current view and the page state is unchanged, continue with page 2+ in the same relevant `element_type`."
            in description
        )

    def test_highlight_prompt_requires_exact_text_keywords_and_pagination_before_guessing(
        self,
    ) -> None:
        description = get_highlight_tool_description()

        assert (
            "Use `keywords` only for exact literal text you can already see on the target itself"
            in description
        )
        assert '{ "keywords": ["Continue with Email"] }' in description
        assert "`star`, `favorite`, or `bookmark`" in description
        assert "Examples of broad search" not in description
        assert "Phase 2: Broad Search" not in description

    def test_highlight_prompt_uses_current_observation_before_calling_highlight(
        self,
    ) -> None:
        description = get_highlight_tool_description()

        assert (
            "Use that returned observation first. Do not re-run `highlight` "
            "just because the page changed." in description
        )
        assert (
            "Call `highlight` when you need more inventory: page 2+, a "
            "narrower `element_type`, exact-text filtering, or a fresh "
            "inventory after a command that did not return an interactive "
            "observation" in description
        )

    def test_highlight_prompt_uses_page_number_pagination_without_snapshot_reuse(
        self,
    ) -> None:
        description = get_highlight_tool_description()

        assert '{ "page": 2 }' in description
        assert "same frozen inventory" not in description

    def test_highlight_prompt_omits_clickable_mode_from_agent_guidance(self) -> None:
        description = get_highlight_tool_description()

        assert "`clickable`" not in description

    def test_highlight_prompt_requires_click_before_keyboard_input_for_inputable_targets(
        self,
    ) -> None:
        description = get_highlight_tool_description()

        assert (
            "always `click` it first and complete that confirmation before `keyboard_input`"
            in description
        )

    def test_small_model_highlight_prompt_omits_keywords_guidance(self) -> None:
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

        assert "`keywords`" not in description
        assert '{ "keywords": ["Continue with Email"] }' not in description

    def test_small_model_highlight_action_omits_keywords_field(self) -> None:
        with patch.object(
            highlight_tool_module,
            "get_prompt_render_context",
            return_value={
                "model_name": "dashscope/qwen3.5-flash",
                "model_profile": "small",
                "small_model": True,
            },
        ):
            action_type = get_highlight_action_type()

        assert "keywords" not in action_type.model_fields

    def test_tab_prompt_points_agents_to_tab_view_for_clean_screenshots(self) -> None:
        description = get_tab_tool_description()

        assert "tab view" in description
        assert "clean screenshot" in description.lower()
        assert 'default `highlight` `element_type: "any"` page 1' in description

    def test_element_interaction_prompt_requires_click_before_keyboard_input(
        self,
    ) -> None:
        description = get_element_interaction_tool_description()

        assert (
            "Always `click` the target first and complete that confirmation before `keyboard_input`."
            in description
        )
        assert (
            "only after you already clicked the same input target and completed that click confirmation"
            in description
        )
        assert (
            "If the current observation already contains the right `element_id`, "
            "act on it directly." in description
        )
        assert "YELLOW preview screenshot" in description
        assert "Is this the element you wanted to click?" in description
        assert (
            'default `highlight` `element_type: "any"` page 1 screenshot' in description
        )
        assert (
            "treat that as a geometry problem first and use `scroll` to reposition it before clicking, typing, or asking `highlight` for more pages."
            in description
        )

    def test_element_interaction_prompt_recovers_from_stale_targets(self) -> None:
        description = get_element_interaction_tool_description()

        assert (
            "If an error says the document changed, the target identity changed, or the cached element is stale, stop using the old `element_id` and rebuild inventory with `highlight` before retrying."
            in description
        )

    def test_element_interaction_prompt_explains_swipe_semantics(self) -> None:
        description = get_element_interaction_tool_description()

        assert '`direction: "next"` means show the next picture' in description
        assert '`direction: "prev"` means show the previous picture' in description
        assert "not finger or gesture directions" in description

    def test_element_interaction_confirm_examples_use_pending_state_only(self) -> None:
        description = get_element_interaction_tool_description()

        assert '{ "action": "confirm_click" }' in description
        assert '{ "action": "confirm_keyboard_input" }' in description
        assert '"element_id": "A1H"' in description

    def test_element_interaction_action_schema_explains_swipe_semantics(self) -> None:
        description = ElementInteractionAction.model_fields["direction"].description

        assert description is not None
        assert "next picture/item" in description
        assert "previous picture/item" in description
        assert "Do not reinterpret swipe as left/right" in description

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
