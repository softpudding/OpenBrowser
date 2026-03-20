"""Tests for model profile resolution and fallback behavior."""

from server.core import model_profiles


def test_known_models_resolve_to_configured_profiles() -> None:
    model_profiles._load_profile_config.cache_clear()

    assert model_profiles.get_model_profile("dashscope/qwen3.5-plus") == "large"
    assert model_profiles.get_model_profile("dashscope/qwen3.5-flash") == "small"
    assert model_profiles.is_small_model("dashscope/qwen3.5-flash") is True


def test_unknown_or_missing_model_falls_back_to_config_default(monkeypatch) -> None:
    model_profiles._load_profile_config.cache_clear()
    monkeypatch.setattr(
        model_profiles,
        "_load_profile_config",
        lambda: {"default_profile": "small", "profiles": {}},
    )

    assert model_profiles.get_model_profile("unknown/model") == "small"
    assert model_profiles.get_model_profile(None) == "small"


def test_malformed_profile_config_does_not_crash_and_uses_default(monkeypatch) -> None:
    model_profiles._load_profile_config.cache_clear()
    monkeypatch.setattr(
        model_profiles,
        "_load_profile_config",
        lambda: {
            "default_profile": "large",
            "profiles": {"small": ["dashscope/qwen3.5-flash"]},
        },
    )

    assert model_profiles.get_model_profile("dashscope/qwen3.5-flash") == "large"
    assert model_profiles.is_small_model("dashscope/qwen3.5-flash") is False
