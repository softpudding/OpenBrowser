"""Tests for model profile resolution."""

from server.core.model_profiles import (
    PROFILE_LARGE,
    PROFILE_SMALL,
    get_model_profile,
    is_small_model,
)


def test_known_large_model_uses_large_profile() -> None:
    """Configured large models should resolve to the large profile."""
    assert get_model_profile("dashscope/qwen3.5-plus") == PROFILE_LARGE


def test_known_small_model_uses_small_profile() -> None:
    """Configured small models should resolve to the small profile."""
    assert get_model_profile("dashscope/qwen3.5-flash") == PROFILE_SMALL
    assert is_small_model("dashscope/qwen3.5-flash") is True


def test_unknown_model_defaults_to_large_profile() -> None:
    """Unlisted models should keep the large-model behavior."""
    assert get_model_profile("unknown/model") == PROFILE_LARGE
    assert is_small_model("unknown/model") is False

