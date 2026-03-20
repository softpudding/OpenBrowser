"""Tests for eval client conversation creation and model resolution."""

from unittest.mock import MagicMock

import pytest

from eval.evaluate_browser_agent import Evaluator, LLMTarget, OpenBrowserClient


def test_create_conversation_uses_model_alias_payload() -> None:
    """Eval client should create conversations using model_alias."""
    client = OpenBrowserClient(
        base_url="http://example.test", chrome_uuid="browser-uuid-123"
    )
    client.session = MagicMock()
    client.session.post.return_value.status_code = 200
    client.session.post.return_value.json.return_value = {"conversation_id": "conv-123"}

    assert client.create_conversation(model_alias="flash") == "conv-123"

    client.session.post.assert_called_once_with(
        "http://example.test/agent/conversations",
        json={
            "model_alias": "flash",
            "browser_id": "browser-uuid-123",
        },
        timeout=5,
    )


def test_get_llm_configs_returns_configured_models() -> None:
    """Eval client should return llm_configs from /api/config."""
    client = OpenBrowserClient(base_url="http://example.test")
    client.session = MagicMock()
    client.session.get.return_value.status_code = 200
    client.session.get.return_value.json.return_value = {
        "config": {
            "llm_configs": [
                {"alias": "default", "model": "dashscope/qwen3.5-plus"},
                {"alias": "flash", "model": "dashscope/qwen3.5-flash"},
            ]
        }
    }

    assert client.get_llm_configs() == [
        {"alias": "default", "model": "dashscope/qwen3.5-plus"},
        {"alias": "flash", "model": "dashscope/qwen3.5-flash"},
    ]


def test_resolve_targets_uses_raw_model_name() -> None:
    """Resolved eval targets should expose raw model names for reporting."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")
    evaluator.openbrowser = MagicMock()
    evaluator.openbrowser.get_llm_configs.return_value = [
        {"alias": "plus", "model": "dashscope/qwen3.5-plus"},
        {"alias": "flash", "model": "dashscope/qwen3.5-flash"},
    ]

    targets = evaluator.resolve_targets(
        [
            LLMTarget(name="plus", alias="plus"),
            LLMTarget(name="flash", alias="flash"),
        ]
    )

    assert [target.model_name for target in targets] == [
        "dashscope/qwen3.5-plus",
        "dashscope/qwen3.5-flash",
    ]
    assert [target.name for target in targets] == [
        "dashscope/qwen3.5-plus",
        "dashscope/qwen3.5-flash",
    ]


def test_resolve_targets_rejects_unknown_alias() -> None:
    """Unknown eval aliases should fail early with a clear message."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")
    evaluator.openbrowser = MagicMock()
    evaluator.openbrowser.get_llm_configs.return_value = [
        {"alias": "plus", "model": "dashscope/qwen3.5-plus"}
    ]

    with pytest.raises(ValueError, match="Unknown model alias"):
        evaluator.resolve_targets([LLMTarget(name="flash", alias="flash")])
