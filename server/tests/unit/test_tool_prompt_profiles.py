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
    assert 'Start with `element_type: "any"` for general exploration.' in description
    assert "Treat highlight pagination as reliable" in description
    assert "Do not switch to `keywords` just because page 1 did not show the target" in description
    assert "icon-only toolbar or header control" in description
    assert 'use `element_type: "clickable"` only as a targeted fallback' in description
    assert "Never use `keywords` for guessed labels, unread text, or icon-only controls such as `×` or `🔍`" in description
    assert "highlight `inputable`" in description
    assert "highlight `clickable` and paginate to find the submit control" in description
    assert "use `tab back`" in description
    assert (
        'Do not use guessed `keywords` such as `"settings"`, `"gear"`, `"bell"`, `"next"`, `"prev"`, or `"close"`'
        in description
    )
    assert "copying exact observed readable text" in description
    assert "icon button next to a count or badge" in description
    assert "Phase 1: Precise Search" not in description
    assert "Collision-Aware Pagination" not in description


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
    assert "Exact-Text Search Only" in description
    assert "icon-only controls" in description
    assert 'Prefer `element_type: "any"` as the default first pass' in description
    assert "Treat pages as reliable collision-free slices of the same candidate set" in description
    assert "Do not jump from a first-page miss to `keywords`" in description
    assert (
        'Use `element_type: "clickable"` as a targeted fallback for icon-only controls'
        in description
    )
    assert (
        'DO NOT search for unlabeled toolbar icons or ambiguous controls with guessed words like "settings", "gear", "bell", "chat", "next", "prev", or "close"'
        in description
    )
    assert "Use keywords only for exact observed readable text or stable tokens you can already see" in description
    assert "the actual button may simply be on the next page" in description
    assert "Phase 2: Broad Search" not in description
    assert "Examples of broad search" not in description
