"""Tests for model-aware tool prompt rendering."""

from types import SimpleNamespace
from unittest.mock import patch

from server.agent.tools.highlight_tool import get_highlight_tool_description
from server.agent.tools.prompt_context import get_prompt_render_context


def test_prompt_render_context_uses_session_model() -> None:
    """Prompt context should reflect the model stored in session metadata."""
    conv_state = SimpleNamespace(id="conv-123")
    session = SimpleNamespace(metadata={"model": "dashscope/qwen3.5-flash"})

    with patch(
        "server.agent.tools.prompt_context.session_manager.get_session",
        return_value=session,
    ):
        context = get_prompt_render_context(conv_state)

    assert context["model_name"] == "dashscope/qwen3.5-flash"
    assert context["model_profile"] == "small"
    assert context["small_model"] is True


def test_highlight_prompt_uses_small_model_variant() -> None:
    """Small models should receive the concise highlight instructions."""
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
    assert "Collision-Aware Pagination" not in description


def test_highlight_prompt_uses_large_model_variant() -> None:
    """Large models should keep the detailed highlight instructions."""
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

