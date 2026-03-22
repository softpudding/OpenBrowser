"""Tests for model-aware prompt rendering context."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


def _import_module(module_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


PROMPT_CONTEXT_PATH = (
    Path(__file__).parent.parent.parent / "agent" / "tools" / "prompt_context.py"
)
prompt_context_module = _import_module(
    PROMPT_CONTEXT_PATH, "server_tests_prompt_context"
)
get_prompt_render_context = prompt_context_module.get_prompt_render_context


def test_prompt_context_defaults_to_large_profile_without_conversation() -> None:
    context = get_prompt_render_context(None)

    assert context == {
        "model_name": None,
        "model_profile": "large",
        "small_model": False,
        "disable_javascript": False,
    }


def test_prompt_context_resolves_model_from_model_alias(monkeypatch) -> None:
    fake_session = SimpleNamespace(metadata={"model_alias": "flash"})
    fake_config = SimpleNamespace(model="dashscope/qwen3.5-flash")

    monkeypatch.setattr(
        prompt_context_module.session_manager,
        "get_session",
        lambda conversation_id: fake_session,
    )
    monkeypatch.setattr(
        prompt_context_module.llm_config_manager,
        "get_llm_config",
        lambda alias: fake_config,
    )

    context = get_prompt_render_context(SimpleNamespace(id="conv-1"))

    assert context["model_name"] == "dashscope/qwen3.5-flash"
    assert context["model_profile"] == "small"
    assert context["small_model"] is True


def test_prompt_context_ignores_invalid_model_alias(monkeypatch) -> None:
    fake_session = SimpleNamespace(metadata={"model_alias": "missing"})

    monkeypatch.setattr(
        prompt_context_module.session_manager,
        "get_session",
        lambda conversation_id: fake_session,
    )
    monkeypatch.setattr(
        prompt_context_module.llm_config_manager,
        "get_llm_config",
        lambda alias: (_ for _ in ()).throw(ValueError("unknown alias")),
    )

    context = get_prompt_render_context(SimpleNamespace(id="conv-err"))

    assert context["model_name"] is None
    assert context["model_profile"] == "large"
    assert context["small_model"] is False


def test_prompt_context_prefers_explicit_model(monkeypatch) -> None:
    fake_session = SimpleNamespace(
        metadata={
            "model": "dashscope/qwen3.5-plus",
            "model_alias": "flash",
        }
    )

    monkeypatch.setattr(
        prompt_context_module.session_manager,
        "get_session",
        lambda conversation_id: fake_session,
    )

    context = get_prompt_render_context(SimpleNamespace(id="conv-2"))

    assert context["model_name"] == "dashscope/qwen3.5-plus"
    assert context["model_profile"] == "large"
    assert context["small_model"] is False
