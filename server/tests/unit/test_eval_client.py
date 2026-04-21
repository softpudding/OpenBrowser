"""Tests for eval client conversation creation and model resolution."""

from unittest.mock import MagicMock

import pytest

from eval import evaluate_browser_agent as eval_module
from eval.evaluate_browser_agent import (
    EvaluationRunLock,
    Evaluator,
    LLMTarget,
    MessageRunResult,
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


def test_extract_cost_treats_dashscope_models_as_rmb() -> None:
    """DashScope usage metrics should not be converted from USD."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")

    sse_events = [
        {
            "type": "usage_metrics",
            "data": {
                "metrics": {
                    "accumulated_cost": 0.758196,
                    "model_name": "dashscope/qwen3.6-plus",
                    "accumulated_token_usage": {
                        "model": "dashscope/qwen3.6-plus",
                    },
                }
            },
        }
    ]

    assert evaluator._extract_cost_from_sse_events(sse_events) == pytest.approx(
        0.758196
    )


def test_merge_persisted_usage_metrics_inserts_missing_final_snapshot() -> None:
    """Persisted usage snapshots should be inserted before the complete event."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")

    sse_events = [
        {"type": "agent_event", "data": {"text": "hello"}, "timestamp": 1.0},
        {
            "type": "usage_metrics",
            "data": {"metrics": {"accumulated_cost": 0.1}},
            "timestamp": 2.0,
        },
        {"type": "complete", "data": {"conversation_id": "conv-123"}, "timestamp": 3.0},
    ]
    persisted_events = [
        {
            "event_type": "usage_metrics",
            "event_data": {"metrics": {"accumulated_cost": 0.1}},
            "event_index": 5,
            "created_at": "2026-04-02T21:23:43.805294",
        },
        {
            "event_type": "usage_metrics",
            "event_data": {"metrics": {"accumulated_cost": 0.8}},
            "event_index": 31,
            "created_at": "2026-04-02T21:25:14.866591",
        },
    ]

    merged_events = evaluator._merge_persisted_usage_metrics(
        sse_events,
        persisted_events,
        source="conversation_events",
    )

    usage_costs = [
        event["data"]["metrics"]["accumulated_cost"]
        for event in merged_events
        if event["type"] == "usage_metrics"
    ]
    assert usage_costs == [0.1, 0.8]
    assert merged_events[-2]["type"] == "usage_metrics"
    assert merged_events[-1]["type"] == "complete"


def test_cleanup_managed_tabs_closes_all_tabs() -> None:
    """Eval client should close every managed tab for the conversation."""
    client = OpenBrowserClient(
        base_url="http://example.test", chrome_uuid="browser-uuid-123"
    )
    client.session = MagicMock()

    get_response = MagicMock()
    get_response.status_code = 200
    get_response.json.return_value = {
        "success": True,
        "data": {
            "tabs": [
                {"tabId": 11, "url": "https://example.com/a"},
                {"tabId": 22, "url": "https://example.com/b"},
            ]
        },
    }
    close_response = MagicMock()
    close_response.status_code = 200
    close_response.json.return_value = {"success": True}

    client.session.get.return_value = get_response
    client.session.post.return_value = close_response

    assert client.cleanup_managed_tabs("conv-123") is True

    client.session.get.assert_called_once_with(
        "http://example.test/tabs",
        params={
            "browser_id": "browser-uuid-123",
            "conversation_id": "conv-123",
            "managed_only": "true",
        },
        timeout=5,
    )
    assert client.session.post.call_count == 2
    assert client.session.post.call_args_list[0].kwargs == {
        "params": {
            "action": "close",
            "browser_id": "browser-uuid-123",
            "conversation_id": "conv-123",
            "tab_id": 11,
        },
        "timeout": 5,
    }
    assert client.session.post.call_args_list[1].kwargs == {
        "params": {
            "action": "close",
            "browser_id": "browser-uuid-123",
            "conversation_id": "conv-123",
            "tab_id": 22,
        },
        "timeout": 5,
    }


def test_run_test_cleans_managed_tabs_before_delete(tmp_path, monkeypatch) -> None:
    """Test teardown should close managed tabs before deleting the conversation."""
    evaluator = Evaluator(chrome_uuid="browser-uuid-123")
    evaluator.output_dir = tmp_path
    evaluator.current_model = "dashscope/qwen3.5-plus"
    evaluator.current_target = LLMTarget(
        name="dashscope/qwen3.5-plus",
        alias="plus",
        model_name="dashscope/qwen3.5-plus",
    )
    evaluator._save_track_events = MagicMock(return_value=None)
    evaluator._extract_images = MagicMock(return_value=[])
    evaluator._save_sse_events = MagicMock(return_value=None)
    evaluator._extract_cost_from_sse_events = MagicMock(return_value=0.0)
    evaluator._evaluate_criteria = MagicMock(return_value=(True, 1.0, 1.0))

    # Stub the per-test eval server so we don't actually spawn a subprocess.
    fake_proc = MagicMock()
    fake_proc.start.return_value = 17000
    fake_proc.stop.return_value = None
    monkeypatch.setattr(
        eval_module, "EvalServerProcess", MagicMock(return_value=fake_proc)
    )
    fake_client = MagicMock()
    fake_client.get_events.return_value = []
    monkeypatch.setattr(
        eval_module, "EvalServerClient", MagicMock(return_value=fake_client)
    )

    teardown_calls: list[str] = []

    evaluator.openbrowser = MagicMock()
    evaluator.openbrowser.create_conversation.return_value = "conv-123"
    evaluator.openbrowser.send_message.return_value = MessageRunResult(events=[])
    evaluator.openbrowser.cleanup_managed_tabs.side_effect = (
        lambda conversation_id: teardown_calls.append(f"cleanup:{conversation_id}")
        or False
    )
    evaluator.openbrowser.delete_conversation.side_effect = (
        lambda conversation_id: teardown_calls.append(f"delete:{conversation_id}")
        or True
    )

    test_case = eval_module.TestCase(
        id="demo",
        name="Demo",
        description="",
        instruction="Do the thing",
        start_url="",
        criteria=[],
    )

    result = evaluator.run_test(test_case)

    assert result.conversation_id == "conv-123"
    assert teardown_calls == ["cleanup:conv-123", "delete:conv-123"]
    fake_proc.stop.assert_called_once()
