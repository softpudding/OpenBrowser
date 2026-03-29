"""Tests for model-aware prompt variants."""

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import patch

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


_import_module("server.agent.tools.base", "base.py")
_import_module("server.agent.tools.prompt_context", "prompt_context.py")
highlight_tool_module = _import_module(
    "server.agent.tools.highlight_tool", "highlight_tool.py"
)
element_interaction_tool_module = _import_module(
    "server.agent.tools.element_interaction_tool", "element_interaction_tool.py"
)
get_highlight_tool_description = highlight_tool_module.get_highlight_tool_description
get_highlight_action_type = highlight_tool_module.get_highlight_action_type
get_element_interaction_tool_description = (
    element_interaction_tool_module.get_element_interaction_tool_description
)


def test_small_model_highlight_prompt_stays_compact_and_actionable() -> None:
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

    assert "## Core Rules" in description
    assert (
        "Outside of `tab view`, completed browser actions already return the "
        'default `highlight` `element_type: "any"` page 1 observation'
        in description
    )
    assert "Use that current observation first." in description
    assert (
        "Call `highlight` when you need page 2+, a narrower `element_type`, "
        "or a fresh inventory after a command that did not return an "
        "interactive observation." in description
    )
    assert '`element_type: "any"` is the default mixed inventory' in description
    assert "If highlight shows `swipable`, use `swipe`." in description
    assert "before `keyboard_input`" in description
    assert "`keywords`" not in description
    assert "`clickable`" not in description
    assert "When a search results page loads" not in description
    assert "use `tab back`" not in description
    assert "Collision-Aware Pagination" not in description


def test_small_model_highlight_action_schema_omits_keywords() -> None:
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


def test_large_model_highlight_prompt_keeps_detailed_pagination_guidance_without_broad_search() -> (
    None
):
    with patch.object(
        highlight_tool_module,
        "get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-plus",
            "model_profile": "large",
            "small_model": False,
        },
    ):
        description = get_highlight_tool_description()

    assert "## Core Contract" in description
    assert (
        "Most completed browser actions already return the default `highlight` "
        '`element_type: "any"` page 1 observation'
        in description
    )
    assert "Use that returned observation first." in description
    assert "If you need a clean screenshot without overlays, use `tab view`" in description
    assert "A1H(scrollable, swipable)" in description
    assert "icon-only" in description
    assert "On the same unchanged page state, stay on the same `element_type`" in description
    assert (
        "always `click` it first and complete that confirmation before `keyboard_input`"
        in description
    )
    assert (
        "Use `keywords` only for exact literal text you can already see on the target itself"
        in description
    )
    assert '{ "keywords": ["Continue with Email"] }' in description
    assert "`star`, `favorite`, or `bookmark`" in description
    assert "`clickable`" not in description
    assert "Phase 2: Broad Search" not in description
    assert "Examples of broad search" not in description
    assert "Collision-Aware Pagination" not in description
    assert "Exact-Text Search Only" not in description


def test_small_model_element_interaction_requires_click_before_keyboard_input() -> None:
    with patch.object(
        element_interaction_tool_module,
        "get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-flash",
            "model_profile": "small",
            "small_model": True,
        },
    ):
        description = get_element_interaction_tool_description()

    assert (
        "If the target is `inputable`, always `click` it first and complete that confirmation before `keyboard_input`."
        in description
    )
    assert "YELLOW preview" in description
    assert "Use the current observation first." in description
    assert 'default `highlight` `element_type: "any"` page 1 screenshot' in description
    assert "always `click` first, then use `keyboard_input`" in description
    assert '`direction: "next"` means show the next picture' in description
    assert '`direction: "prev"` means show the previous picture' in description
    assert "not hand or finger movement directions" in description


def test_large_model_element_interaction_requires_click_before_keyboard_input() -> None:
    with patch.object(
        element_interaction_tool_module,
        "get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-plus",
            "model_profile": "large",
            "small_model": False,
        },
    ):
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
    assert 'default `highlight` `element_type: "any"` page 1 screenshot' in description
    assert '`direction: "next"` means show the next picture' in description
    assert '`direction: "prev"` means show the previous picture' in description
    assert "not finger or gesture directions" in description
