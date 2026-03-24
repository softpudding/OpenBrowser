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
get_highlight_tool_description = highlight_tool_module.get_highlight_tool_description
get_highlight_action_type = highlight_tool_module.get_highlight_action_type


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
    assert 'default first pass for each new page state' in description
    assert 'extension-derived page insight across element types' in description
    assert "Treat highlight pagination as reliable" in description
    assert "After any significant page-state change" in description
    assert "Do not jump away from `element_type: \"any\"` on a newly changed page" in description
    assert "icon-only toolbar or header control" in description
    assert "continue `any` pagination and inspect the next pages instead of switching modes" in description
    assert "you may narrow to `inputable`" in description
    assert "after typing, continue discovery with `any`" in description
    assert "When a search results page loads, call `highlight` with `element_type: \"any\"`" in description
    assert "use `tab back`" in description
    assert "Do not use guessed labels such as \"settings\", \"gear\", \"bell\", \"next\", \"prev\", or \"close\"" in description
    assert "icon button next to a count or badge" in description
    assert "`keywords`" not in description
    assert '`clickable`' not in description
    assert "Phase 1: Precise Search" not in description
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

    assert "Collision-Aware Pagination" in description
    assert '## Any-First Discovery Rule' in description
    assert 'default first pass for each new page state' in description
    assert 'extension-derived page insight across element types' in description
    assert "After any significant page-state change, restart with `highlight` on `element_type: \"any\"`" in description
    assert "Do not jump away from `element_type: \"any\"` on that changed page" in description
    assert "Exact-Text Search Only" in description
    assert "icon-only controls" in description
    assert 'Prefer `element_type: "any"` as the default first pass' in description
    assert "Treat pages as reliable collision-free slices of the same candidate set" in description
    assert "Do not jump from a first-page miss to `keywords`" in description
    assert "prefer more `any` pages over broad keyword search or a narrower generic-control mode" in description
    assert (
        'DO NOT search for unlabeled toolbar icons or ambiguous controls with guessed words like "settings", "gear", "bell", "chat", "next", "prev", or "close"'
        in description
    )
    assert "Use keywords only for exact literal text characters you can already see on the target itself in the current screenshot" in description
    assert "the actual button may simply be on the next page" in description
    assert '`clickable`' not in description
    assert "Phase 2: Broad Search" not in description
    assert "Examples of broad search" not in description
