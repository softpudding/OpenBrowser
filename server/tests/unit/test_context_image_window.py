"""Tests for the live tool-image window configuration helpers."""

from server.agent.context_image_window import (
    DEFAULT_CONTEXT_IMAGE_WINDOW,
    ENV_CONTEXT_IMAGE_WINDOW,
    get_context_image_window,
)


class TestContextImageWindowConfig:
    def test_default_value_keeps_latest_image(self, monkeypatch) -> None:
        monkeypatch.delenv(ENV_CONTEXT_IMAGE_WINDOW, raising=False)

        assert get_context_image_window() == DEFAULT_CONTEXT_IMAGE_WINDOW

    def test_invalid_env_value_falls_back_to_default(self, monkeypatch) -> None:
        monkeypatch.setenv(ENV_CONTEXT_IMAGE_WINDOW, "invalid")

        assert get_context_image_window() == DEFAULT_CONTEXT_IMAGE_WINDOW

    def test_negative_value_disables_sdk_filtering(self, monkeypatch) -> None:
        monkeypatch.setenv(ENV_CONTEXT_IMAGE_WINDOW, "-1")

        assert get_context_image_window() is None

    def test_zero_value_keeps_no_tool_images(self, monkeypatch) -> None:
        monkeypatch.setenv(ENV_CONTEXT_IMAGE_WINDOW, "0")

        assert get_context_image_window() == 0
