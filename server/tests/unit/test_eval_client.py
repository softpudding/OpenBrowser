"""Tests for eval client conversation creation and model resolution."""

from unittest.mock import MagicMock

import pytest

from eval import evaluate_browser_agent as eval_module
from eval.evaluate_browser_agent import (
    EvaluationRunLock,
    Evaluator,
    LLMTarget,
    OpenBrowserClient,
)


def test_create_conversation_uses_model_alias_payload() -> None:
    """Eval client should create conversations using model_alias."""
    client = OpenBrowserClient(
        base_url="http://example.test", chrome_uuid="browser-uuid-123"
    )
    client.session = MagicMock()
    client.wait_for_browser_validity = MagicMock(return_value=True)
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


def test_create_conversation_retries_when_browser_uuid_reconnects() -> None:
    """Eval client should retry after a transient invalid browser UUID error."""
    client = OpenBrowserClient(
        base_url="http://example.test", chrome_uuid="browser-uuid-123"
    )
    client.session = MagicMock()
    client.wait_for_browser_validity = MagicMock(side_effect=[True, True])

    invalid_response = MagicMock()
    invalid_response.status_code = 400
    invalid_response.text = "Invalid or expired browser_id: browser-uuid-123"

    success_response = MagicMock()
    success_response.status_code = 200
    success_response.json.return_value = {"conversation_id": "conv-456"}

    client.session.post.side_effect = [invalid_response, success_response]

    assert client.create_conversation(model_alias="flash") == "conv-456"
    assert client.session.post.call_count == 2


def test_evaluation_run_lock_rejects_second_holder(tmp_path) -> None:
    """A second evaluation should fail fast when the same browser UUID is locked."""
    original_lock_dir = eval_module.LOCK_DIR
    eval_module.LOCK_DIR = tmp_path

    try:
        first = EvaluationRunLock("browser-uuid-123")
        second = EvaluationRunLock("browser-uuid-123")

        first.acquire()
        with pytest.raises(RuntimeError, match="already using browser UUID"):
            second.acquire()
    finally:
        first.release()
        eval_module.LOCK_DIR = original_lock_dir


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


def test_extract_cost_uses_latest_usage_metrics_event() -> None:
    """Eval cost extraction should use the final accumulated usage snapshot."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")

    sse_events = [
        {
            "type": "usage_metrics",
            "data": {
                "metrics": {
                    "accumulated_cost": 0.0306296,
                    "model_name": "dashscope/qwen3.5-plus",
                    "accumulated_token_usage": {
                        "model": "dashscope/qwen3.5-plus",
                    },
                }
            },
        },
        {"type": "message", "data": {"content": "intermediate event"}},
        {
            "type": "usage_metrics",
            "data": {
                "metrics": {
                    "accumulated_cost": 0.9652088,
                    "model_name": "dashscope/qwen3.5-plus",
                    "accumulated_token_usage": {
                        "model": "dashscope/qwen3.5-plus",
                    },
                }
            },
        },
    ]

    assert evaluator._extract_cost_from_sse_events(sse_events) == pytest.approx(
        0.9652088
    )
