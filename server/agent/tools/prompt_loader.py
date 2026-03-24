"""Helpers for rendering model-aware tool prompts from split template dirs."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import jinja2

from server.agent.tools.prompt_context import get_prompt_render_context

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
_TEMPLATE_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(_PROMPTS_DIR),
    autoescape=jinja2.select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


@lru_cache(maxsize=None)
def _get_tool_prompt_template(template_path: str) -> jinja2.Template:
    """Load and cache a tool prompt template by relative path."""
    return _TEMPLATE_ENV.get_template(template_path)


def render_tool_prompt(
    template_name: str,
    conv_state: Any = None,
    context: dict[str, Any] | None = None,
    **extra_context: Any,
) -> str:
    """Render a tool prompt from the model-specific template directory."""
    context = context or get_prompt_render_context(conv_state)
    model_dir = "small_model" if context["small_model"] else "big_model"
    template = _get_tool_prompt_template(f"{model_dir}/{template_name}")

    if extra_context:
        context = {**context, **extra_context}

    return template.render(**context)
