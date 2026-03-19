"""Helpers for rendering model-aware tool prompts."""

from __future__ import annotations

from typing import Any

from server.core.llm_config import llm_config_manager
from server.core.model_profiles import get_model_profile, is_small_model
from server.core.session_manager import session_manager


def _get_conversation_id(conv_state: Any = None) -> str | None:
    """Best-effort extraction of conversation ID from SDK conversation state."""
    conversation_id = getattr(conv_state, "id", None)
    if conversation_id is None:
        return None
    return str(conversation_id)


def get_prompt_render_context(conv_state: Any = None) -> dict[str, Any]:
    """Build shared Jinja context for tool prompt rendering."""
    conversation_id = _get_conversation_id(conv_state)
    model_name: str | None = None

    if conversation_id is not None:
        session = session_manager.get_session(conversation_id)
        if session is not None:
            raw_model = session.metadata.get("model")
            if isinstance(raw_model, str) and raw_model:
                model_name = raw_model

            if model_name is None:
                raw_model_alias = session.metadata.get("model_alias")
                if isinstance(raw_model_alias, str) and raw_model_alias:
                    try:
                        model_name = llm_config_manager.get_llm_config(
                            raw_model_alias
                        ).model
                    except ValueError:
                        model_name = None

    profile = get_model_profile(model_name)

    return {
        "model_name": model_name,
        "model_profile": profile,
        "small_model": is_small_model(model_name),
    }
