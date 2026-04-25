"""Tests for LLMConfigManager compiler-alias resolution."""

from __future__ import annotations

import json
from pathlib import Path

from server.core.llm_config import LLMConfigManager


def _write_config(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _manager_with_config(tmp_path: Path, payload: dict) -> LLMConfigManager:
    manager = LLMConfigManager()
    manager.config_dir = tmp_path
    manager.config_file = tmp_path / "llm_config.json"
    _write_config(manager.config_file, payload)
    manager.reload_config()
    return manager


def test_get_compiler_llm_config_uses_configured_alias(tmp_path: Path) -> None:
    manager = _manager_with_config(
        tmp_path,
        {
            "llm_configs": [
                {
                    "alias": "flash",
                    "model": "m1",
                    "base_url": "http://x",
                    "api_key": "a",
                },
                {
                    "alias": "plus",
                    "model": "m2",
                    "base_url": "http://y",
                    "api_key": "b",
                },
            ],
            "default_llm_alias": "flash",
            "default_compiler_alias": "plus",
        },
    )
    assert manager.get_compiler_llm_config().alias == "plus"
    assert manager.get_llm_config(None).alias == "flash"


def test_get_compiler_llm_config_falls_back_when_unset(tmp_path: Path) -> None:
    manager = _manager_with_config(
        tmp_path,
        {
            "llm_configs": [
                {
                    "alias": "flash",
                    "model": "m1",
                    "base_url": "http://x",
                    "api_key": "a",
                },
            ],
            "default_llm_alias": "flash",
        },
    )
    assert manager.get_compiler_llm_config().alias == "flash"


def test_compiler_alias_reset_when_pointing_at_removed_alias(tmp_path: Path) -> None:
    """If the configured compiler alias no longer exists, normalization clears it."""
    manager = _manager_with_config(
        tmp_path,
        {
            "llm_configs": [
                {
                    "alias": "flash",
                    "model": "m1",
                    "base_url": "http://x",
                    "api_key": "a",
                },
            ],
            "default_llm_alias": "flash",
            "default_compiler_alias": "ghost",
        },
    )
    assert manager.get_full_config().default_compiler_alias is None
    assert manager.get_compiler_llm_config().alias == "flash"
