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
        'default `highlight` `element_type: "any"` page 1 observation' in description
    )
    assert (
        "Treat that current observation as the working inventory for the current "
        "page state." in description
    )
    # Canonical pagination rule (Core Rule #4). Rewritten after the 20260420
    # eval, where flash picked an approximate match from page 1 instead of
    # paginating to page 2 to find the real target. The bolded sentence is
    # the load-bearing instruction; the follow-up sweep and no-approximate-
    # match clauses close the loophole the model exploited previously.
    assert (
        '**If the exact target id is not in the current page and '
        '`current_page < total_pages`, call `highlight` with '
        '`{"page": current_page + 1}` on the same `element_type` before '
        "picking any id.**" in description
    )
    assert (
        "Do not pick an approximate match from page 1 when later pages have "
        "not been checked." in description
    )
    assert "scroll first to reposition it" in description
    assert '`element_type: "any"` is the default mixed inventory' in description
    # Narrowing-by-type is now downstream of the full sweep (Selection
    # Strategy), not intermixed with pagination guidance.
    assert (
        "Narrow to `inputable`, `scrollable`, `selectable`, `draggable`, "
        "`droppable`, or `uploadable` only after sweeping all pages on the "
        "current mode" in description
    )
    # Concrete positive example is the key lever from Anthropic's guide.
    # Must stay generic so the model cannot memorize a benchmark task.
    assert "Paginate before picking: example" in description
    assert "Arigato" not in description
    assert "bluebook" not in description.lower()
    assert "If highlight shows `swipable`, use `swipe`." in description
    assert (
        "If a returned element is marked `draggable`, prefer `drag_and_drop` over `click`."
        in description
    )
    assert '`element_type: "droppable"`' in description
    assert '{ "element_type": "draggable" }' in description
    assert '{ "element_type": "droppable" }' in description
    assert "cached element is stale" in description
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
            "routine_replay_mode": False,
        },
    ):
        action_type = get_highlight_action_type()

    assert action_type is highlight_tool_module.SmallModelHighlightAction
    assert "keywords" not in action_type.model_fields


def test_small_model_routine_replay_highlight_action_allows_restricted_keywords() -> (
    None
):
    with patch.object(
        highlight_tool_module,
        "get_prompt_render_context",
        return_value={
            "model_name": "dashscope/qwen3.5-flash",
            "model_profile": "small",
            "small_model": True,
            "routine_replay_mode": True,
        },
    ):
        action_type = get_highlight_action_type()

    assert action_type is highlight_tool_module.SmallModelRoutineReplayHighlightAction
    assert "keywords" in action_type.model_fields

    keywords_field = action_type.model_fields["keywords"]
    description = keywords_field.description or ""
    # The description should anchor the small model on the Routine-supplied
    # token and defer to the system prompt's <ROUTINE_REPLAY> block for the
    # full rules — duplicating the rules here would re-introduce the
    # multi-source guidance the user pushed back on.
    assert "**Keywords:**" in description
    assert "verbatim" in description
    assert "<ROUTINE_REPLAY>" in description


def test_large_model_highlight_action_keeps_keywords_in_any_mode() -> None:
    for replay_flag in (False, True):
        with patch.object(
            highlight_tool_module,
            "get_prompt_render_context",
            return_value={
                "model_name": "dashscope/qwen3.5-plus",
                "model_profile": "large",
                "small_model": False,
                "routine_replay_mode": replay_flag,
            },
        ):
            action_type = get_highlight_action_type()

        assert action_type is highlight_tool_module.HighlightAction
        assert "keywords" in action_type.model_fields


def test_small_model_highlight_prompt_never_mentions_keywords_in_either_mode() -> None:
    """Routine-replay guidance lives only in the system prompt's
    <ROUTINE_REPLAY> block. The small-model highlight tool prompt itself must
    not mention `keywords` in either mode — duplicating routine-replay rules
    inside the tool prompt makes the overall guidance inconsistent."""
    base_context = {
        "model_name": "dashscope/qwen3.5-flash",
        "model_profile": "small",
        "small_model": True,
    }

    with patch.object(
        highlight_tool_module,
        "get_prompt_render_context",
        return_value={**base_context, "routine_replay_mode": False},
    ):
        non_replay_description = get_highlight_tool_description()

    with patch.object(
        highlight_tool_module,
        "get_prompt_render_context",
        return_value={**base_context, "routine_replay_mode": True},
    ):
        replay_description = get_highlight_tool_description()

    for description in (non_replay_description, replay_description):
        assert "`keywords`" not in description
        assert "Routine Replay" not in description
        assert "Keywords:" not in description


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
        '`element_type: "any"` page 1 observation' in description
    )
    assert "Use that returned observation first." in description
    assert (
        "If you need a clean screenshot without overlays, use `tab view`" in description
    )
    assert "A1H(scrollable, swipable)" in description
    assert "icon-only" in description
    assert (
        "use `scroll` to reposition it before asking for more `highlight` pages"
        in description
    )
    assert (
        "On the same unchanged page state, stay on the same `element_type`"
        in description
    )
    assert (
        "always `click` it first and complete that confirmation before `keyboard_input`"
        in description
    )
    assert (
        "Use `keywords` only for exact literal text you can already see on the target itself"
        in description
    )
    assert '{ "keywords": ["Continue with Email"] }' in description
    assert '{ "element_type": "draggable" }' in description
    assert '{ "element_type": "droppable" }' in description
    assert (
        "If a returned element is marked `draggable`, prefer `drag_and_drop` over `click`."
        in description
    )
    assert "`star`, `favorite`, or `bookmark`" in description
    assert "`clickable`" not in description
    assert "Phase 2: Broad Search" not in description
    assert "Examples of broad search" not in description
    assert "Collision-Aware Pagination" not in description
    assert "Exact-Text Search Only" not in description
    assert "the cached element is stale" in description


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
    assert (
        "Treat the current observation as the working inventory for the current "
        "page state." in description
    )
    assert 'default `highlight` `element_type: "any"` page 1 screenshot' in description
    assert "scroll first to reposition it" in description
    assert (
        "collision-aware label placement may have split the target across pages"
        in description
    )
    assert "always `click` first, then use `keyboard_input`" in description
    assert '`direction: "next"` means show the next picture' in description
    assert '`direction: "prev"` means show the previous picture' in description
    assert "not hand or finger movement directions" in description
    assert (
        "If a returned element is marked `draggable`, prefer `drag_and_drop` over `click`."
        in description
    )
    assert "confirm_drag_and_drop" in description
    assert "relative_to" in description
    assert "cached element is stale" in description
    assert "HTML all match" not in description


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
    assert "geometry problem first and use `scroll` to reposition it" in description
    assert '`direction: "next"` means show the next picture' in description
    assert '`direction: "prev"` means show the previous picture' in description
    assert "not finger or gesture directions" in description
    assert (
        "If a returned element is marked `draggable`, prefer `drag_and_drop` over `click`."
        in description
    )
    assert "confirm_drag_and_drop" in description
    assert "relative_to" in description
    assert "Target mode (2PC)" in description or "target_element_id" in description
    assert "cached element is stale" in description
