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
    with patch(
        "server.agent.tools.highlight_tool.get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-flash",
            "model_profile": "small",
            "small_model": True,
        },
    ):
        description = get_highlight_tool_description()

    assert "## Core Rules" in description
    assert 'Prefer `element_type: "any"` first.' in description
    assert "Phase 1: Precise Search" not in description
    assert "Collision-Aware Pagination" not in description


def test_large_model_highlight_prompt_keeps_detailed_search_and_pagination_guidance() -> (
    None
):
    with patch(
        "server.agent.tools.highlight_tool.get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-plus",
            "model_profile": "large",
            "small_model": False,
        },
    ):
        description = get_highlight_tool_description()

    assert "Collision-Aware Pagination" in description
    assert "Phase 1: Precise Search" in description
    assert "Phase 2: Broad Search" in description
