"""Tests for multi-model LLM config persistence."""

import json

from server.core.llm_config import LLMConfig, LLMConfigManager


def create_manager(tmp_path):
    manager = LLMConfigManager()
    manager.config_dir = tmp_path
    manager.config_file = tmp_path / "llm_config.json"
    manager._config = None
    return manager


def test_legacy_single_config_loads_as_default_alias(tmp_path) -> None:
    """Legacy single-llm config files should map to alias=default."""
    config_file = tmp_path / "llm_config.json"
    config_file.write_text(
        json.dumps(
            {
                "llm": {
                    "model": "dashscope/qwen3.5-plus",
                    "base_url": "https://example.com/v1",
                    "api_key": "secret-key",
                },
                "default_cwd": "/work",
            }
        ),
        encoding="utf-8",
    )

    manager = create_manager(tmp_path)
    config = manager.get_full_config()

    assert config.default_llm_alias == "default"
    assert config.llm.alias == "default"
    assert len(config.llm_configs) == 1
    assert config.llm_configs[0].alias == "default"
    assert config.default_cwd == "/work"


def test_set_multiple_llm_configs_persists_default_alias(tmp_path) -> None:
    """Multiple configs should persist with the selected default alias."""
    manager = create_manager(tmp_path)
    config = manager.set_llm_configs(
        [
            LLMConfig(
                alias="default",
                model="dashscope/qwen3.5-plus",
                base_url="https://example.com/v1",
                api_key="key-plus",
            ),
            LLMConfig(
                alias="flash",
                model="dashscope/qwen3.5-flash",
                base_url="https://example.com/v1",
                api_key="key-flash",
            ),
        ],
        default_alias="flash",
    )

    assert config.default_llm_alias == "flash"
    assert config.llm.alias == "flash"
    assert manager.get_llm_config("default").api_key == "key-plus"
    assert manager.get_llm_config("flash").api_key == "key-flash"


def test_is_configured_checks_any_model_api_key(tmp_path) -> None:
    """App should be configured when any stored model has an API key."""
    manager = create_manager(tmp_path)
    manager.set_llm_configs(
        [
            LLMConfig(
                alias="default",
                model="dashscope/qwen3.5-plus",
                base_url="https://example.com/v1",
                api_key=None,
            ),
            LLMConfig(
                alias="flash",
                model="dashscope/qwen3.5-flash",
                base_url="https://example.com/v1",
                api_key="flash-key",
            ),
        ],
        default_alias="default",
    )

    assert manager.is_configured() is True

