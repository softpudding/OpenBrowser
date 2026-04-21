"""Tests for configuration routes."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from server.api.main import app
from server.core.llm_config import LLMConfig


def test_get_full_config_returns_multiple_llm_configs() -> None:
    """Full config response should include llm_configs and default alias."""
    client = TestClient(app)

    mock_config = type(
        "MockConfig",
        (),
        {
            "llm": LLMConfig(
                alias="default",
                model="dashscope/qwen3.5-plus",
                base_url="https://example.com/v1",
                api_key="secret",
            ),
            "llm_configs": [
                LLMConfig(
                    alias="default",
                    model="dashscope/qwen3.5-plus",
                    base_url="https://example.com/v1",
                    api_key="secret",
                ),
                LLMConfig(
                    alias="flash",
                    model="dashscope/qwen3.5-flash",
                    base_url="https://example.com/v1",
                    api_key="secret-2",
                ),
            ],
            "default_llm_alias": "default",
            "default_compiler_alias": None,
            "default_cwd": "/tmp",
        },
    )()

    with (
        patch(
            "server.api.routes.config.llm_config_manager.get_full_config",
            return_value=mock_config,
        ),
        patch(
            "server.api.routes.config.llm_config_manager.is_configured",
            return_value=True,
        ),
    ):
        response = client.get("/api/config")

    assert response.status_code == 200
    data = response.json()["config"]
    assert data["default_llm_alias"] == "default"
    assert len(data["llm_configs"]) == 2
    assert data["llm_configs"][1]["alias"] == "flash"
    assert data["llm"]["has_api_key"] is True


def test_update_llm_config_accepts_multi_config_payload() -> None:
    """POST /api/config/llm should accept the new multi-config payload."""
    client = TestClient(app)
    stored_configs = [
        LLMConfig(
            alias="default",
            model="dashscope/qwen3.5-plus",
            base_url="https://example.com/v1",
            api_key="secret",
        )
    ]
    updated_config = type(
        "UpdatedConfig",
        (),
        {
            "llm": LLMConfig(
                alias="flash",
                model="dashscope/qwen3.5-flash",
                base_url="https://example.com/v1",
                api_key="new-secret",
            ),
            "llm_configs": [
                LLMConfig(
                    alias="default",
                    model="dashscope/qwen3.5-plus",
                    base_url="https://example.com/v1",
                    api_key="secret",
                ),
                LLMConfig(
                    alias="flash",
                    model="dashscope/qwen3.5-flash",
                    base_url="https://example.com/v1",
                    api_key="new-secret",
                ),
            ],
            "default_llm_alias": "flash",
            "default_compiler_alias": None,
            "default_cwd": "/tmp",
        },
    )()

    with (
        patch(
            "server.api.routes.config.llm_config_manager.get_llm_configs",
            return_value=stored_configs,
        ),
        patch(
            "server.api.routes.config.llm_config_manager.set_llm_configs",
            return_value=updated_config,
        ) as mock_set_llm_configs,
        patch(
            "server.api.routes.config.llm_config_manager.get_full_config",
            return_value=updated_config,
        ),
        patch(
            "server.api.routes.config.llm_config_manager.is_configured",
            return_value=True,
        ),
    ):
        response = client.post(
            "/api/config/llm",
            json={
                "configs": [
                    {
                        "alias": "default",
                        "model": "dashscope/qwen3.5-plus",
                        "base_url": "https://example.com/v1",
                        "api_key": "********",
                    },
                    {
                        "alias": "flash",
                        "model": "dashscope/qwen3.5-flash",
                        "base_url": "https://example.com/v1",
                        "api_key": "new-secret",
                    },
                ],
                "default_alias": "flash",
            },
        )

    assert response.status_code == 200
    assert mock_set_llm_configs.called
    data = response.json()
    assert data["default_alias"] == "flash"
    assert len(data["configs"]) == 2


def test_update_llm_config_rejects_unknown_compiler_alias_without_saving() -> None:
    """Invalid default_compiler_alias must 400 before set_llm_configs runs."""
    client = TestClient(app)

    with (
        patch(
            "server.api.routes.config.llm_config_manager.get_llm_configs",
            return_value=[],
        ),
        patch(
            "server.api.routes.config.llm_config_manager.set_llm_configs",
        ) as mock_set_llm_configs,
        patch(
            "server.api.routes.config.llm_config_manager.set_default_compiler_alias",
        ) as mock_set_compiler,
    ):
        response = client.post(
            "/api/config/llm",
            json={
                "configs": [
                    {
                        "alias": "default",
                        "model": "dashscope/qwen3.5-plus",
                        "base_url": "https://example.com/v1",
                        "api_key": "secret",
                    },
                ],
                "default_alias": "default",
                "default_compiler_alias": "does-not-exist",
            },
        )

    assert response.status_code == 400
    assert "default_compiler_alias" in response.json()["detail"]
    assert not mock_set_llm_configs.called
    assert not mock_set_compiler.called


def test_update_llm_config_persists_compiler_alias() -> None:
    """Valid default_compiler_alias should be saved via set_default_compiler_alias."""
    client = TestClient(app)
    updated_config = type(
        "UpdatedConfig",
        (),
        {
            "llm": LLMConfig(
                alias="plus",
                model="dashscope/qwen3.5-plus",
                base_url="https://example.com/v1",
                api_key="secret",
            ),
            "llm_configs": [
                LLMConfig(
                    alias="flash",
                    model="dashscope/qwen3.5-flash",
                    base_url="https://example.com/v1",
                    api_key="secret",
                ),
                LLMConfig(
                    alias="plus",
                    model="dashscope/qwen3.5-plus",
                    base_url="https://example.com/v1",
                    api_key="secret",
                ),
            ],
            "default_llm_alias": "flash",
            "default_compiler_alias": "plus",
            "default_cwd": "/tmp",
        },
    )()

    with (
        patch(
            "server.api.routes.config.llm_config_manager.get_llm_configs",
            return_value=[],
        ),
        patch(
            "server.api.routes.config.llm_config_manager.set_llm_configs",
        ),
        patch(
            "server.api.routes.config.llm_config_manager.set_default_compiler_alias",
        ) as mock_set_compiler,
        patch(
            "server.api.routes.config.llm_config_manager.get_full_config",
            return_value=updated_config,
        ),
        patch(
            "server.api.routes.config.llm_config_manager.is_configured",
            return_value=True,
        ),
    ):
        response = client.post(
            "/api/config/llm",
            json={
                "configs": [
                    {
                        "alias": "flash",
                        "model": "dashscope/qwen3.5-flash",
                        "base_url": "https://example.com/v1",
                        "api_key": "secret",
                    },
                    {
                        "alias": "plus",
                        "model": "dashscope/qwen3.5-plus",
                        "base_url": "https://example.com/v1",
                        "api_key": "secret",
                    },
                ],
                "default_alias": "flash",
                "default_compiler_alias": "plus",
            },
        )

    assert response.status_code == 200
    mock_set_compiler.assert_called_once_with("plus")
    assert response.json()["default_compiler_alias"] == "plus"
