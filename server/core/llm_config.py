"""
LLM Configuration Manager

Manages LLM configuration entries and default CWD stored in
~/.openbrowser/llm_config.json.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic.json import pydantic_encoder

DEFAULT_MODEL = "dashscope/qwen3.5-plus"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_ALIAS = "default"


class LLMConfig(BaseModel):
    """LLM configuration model."""

    alias: str = DEFAULT_ALIAS
    model: str = DEFAULT_MODEL
    base_url: str = DEFAULT_BASE_URL
    api_key: str | None = None  # API key must be provided by user


class AppConfig(BaseModel):
    """Application configuration model."""

    llm_configs: list[LLMConfig] = Field(default_factory=list)
    default_llm_alias: str = DEFAULT_ALIAS
    default_cwd: str = "/tmp"


class LLMConfigManager:
    """Manager for LLM and app configuration persisted to file."""

    def __init__(self) -> None:
        self.config_dir = Path.home() / ".openbrowser"
        self.config_file = self.config_dir / "llm_config.json"
        self._config: AppConfig | None = None

    def _ensure_config_dir(self) -> None:
        """Ensure configuration directory exists."""
        self.config_dir.mkdir(parents=True, exist_ok=True)

    def _normalize_config(self, config: AppConfig) -> AppConfig:
        """Normalize config to keep compatibility and invariants."""
        configs_by_alias: dict[str, LLMConfig] = {}

        for llm_config in config.llm_configs:
            alias = (llm_config.alias or "").strip() or DEFAULT_ALIAS
            configs_by_alias[alias] = llm_config.model_copy(update={"alias": alias})

        config.llm_configs = list(configs_by_alias.values())

        normalized_default_alias = (
            config.default_llm_alias or ""
        ).strip() or DEFAULT_ALIAS
        if not config.llm_configs:
            config.default_llm_alias = normalized_default_alias
            return config
        if normalized_default_alias not in configs_by_alias:
            normalized_default_alias = config.llm_configs[0].alias

        config.default_llm_alias = normalized_default_alias
        return config

    def _load_config(self) -> AppConfig:
        """Load configuration from file."""
        if self._config is not None:
            return self._config

        config = AppConfig()

        if self.config_file.exists():
            try:
                with self.config_file.open("r", encoding="utf-8") as f:
                    data = json.load(f)

                raw_llm_configs = data.get("llm_configs", [])
                parsed_configs: list[LLMConfig] = []
                if isinstance(raw_llm_configs, list):
                    for raw_config in raw_llm_configs:
                        if isinstance(raw_config, dict):
                            parsed_configs.append(LLMConfig(**raw_config))

                if parsed_configs:
                    config.llm_configs = parsed_configs

                if "default_llm_alias" in data:
                    config.default_llm_alias = (
                        data["default_llm_alias"] or DEFAULT_ALIAS
                    )

                if "default_cwd" in data:
                    config.default_cwd = data["default_cwd"]
            except Exception as e:
                print(f"Warning: Error loading config file: {e}")

        self._config = self._normalize_config(config)
        return self._config

    def _save_config(self, config: AppConfig) -> None:
        """Save configuration to file."""
        self._ensure_config_dir()
        normalized_config = self._normalize_config(config)

        try:
            with self.config_file.open("w", encoding="utf-8") as f:
                json.dump(
                    normalized_config.model_dump(),
                    f,
                    indent=2,
                    default=pydantic_encoder,
                )
            self._config = normalized_config
        except Exception as e:
            raise RuntimeError(f"Failed to save configuration: {e}")

    def get_llm_config(self, alias: str | None = None) -> LLMConfig:
        """Get one LLM configuration by alias or the default configuration."""
        config = self._load_config()
        if alias is None:
            # Return the config pointed to by default_llm_alias
            for llm_config in config.llm_configs:
                if llm_config.alias == config.default_llm_alias:
                    return llm_config
            # Fallback to first config if default_alias not found
            if config.llm_configs:
                return config.llm_configs[0]
            raise ValueError("No LLM configs configured")

        normalized_alias = alias.strip()
        for llm_config in config.llm_configs:
            if llm_config.alias == normalized_alias:
                return llm_config

        raise ValueError(f"Unknown LLM config alias: {alias}")

    def get_llm_configs(self) -> list[LLMConfig]:
        """Get all configured LLM entries."""
        config = self._load_config()
        return [llm_config.model_copy() for llm_config in config.llm_configs]

    def set_llm_configs(
        self, llm_configs: list[LLMConfig], default_alias: str | None = None
    ) -> AppConfig:
        """Replace all configured LLM entries."""
        config = self._load_config()
        config.llm_configs = llm_configs
        if default_alias is not None:
            config.default_llm_alias = default_alias
        self._save_config(config)
        return self.get_full_config()

    def delete_llm_config(self, alias: str) -> AppConfig:
        """Delete one LLM config entry."""
        normalized_alias = alias.strip()
        config = self._load_config()
        config.llm_configs = [
            llm_config
            for llm_config in config.llm_configs
            if llm_config.alias != normalized_alias
        ]
        self._save_config(config)
        return self.get_full_config()

    def get_default_cwd(self) -> str:
        """Get default working directory."""
        config = self._load_config()
        return config.default_cwd

    def set_default_cwd(self, cwd: str) -> str:
        """Set default working directory."""
        config = self._load_config()
        config.default_cwd = cwd
        self._save_config(config)
        return config.default_cwd

    def get_full_config(self) -> AppConfig:
        """Get full application configuration."""
        return self._load_config()

    def is_configured(self) -> bool:
        """Check whether at least one LLM config has an API key."""
        config = self._load_config()
        return any(
            llm_config.api_key is not None and len(llm_config.api_key) > 0
            for llm_config in config.llm_configs
        )

    def reload_config(self) -> AppConfig:
        """Force reload configuration from disk, bypassing cache."""
        self._config = None
        return self._load_config()

    def reset_config(self) -> None:
        """Reset configuration to defaults."""
        self._config = None
        if self.config_file.exists():
            try:
                self.config_file.unlink()
            except Exception:
                pass


# Global singleton instance
llm_config_manager = LLMConfigManager()
