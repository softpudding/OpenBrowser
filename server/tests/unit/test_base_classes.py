"""Contract tests for OpenBrowser tool base models."""

import importlib.util
import sys
from pathlib import Path

from openhands.sdk import ImageContent, TextContent

TOOLS_DIR = Path(__file__).resolve().parents[2] / "agent" / "tools"


def _load_module(module_name: str, filename: str):
    module_path = TOOLS_DIR / filename
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


base_module = _load_module("server.agent.tools.base", "base.py")
OpenBrowserAction = base_module.OpenBrowserAction
OpenBrowserObservation = base_module.OpenBrowserObservation


def _text_content(observation: OpenBrowserObservation) -> str:
    llm_content = observation.to_llm_content
    assert isinstance(llm_content[0], TextContent)
    return llm_content[0].text


class TestOpenBrowserAction:
    def test_model_dump_preserves_conversation_id(self) -> None:
        action = OpenBrowserAction(conversation_id="conv-456")

        dumped = action.model_dump()

        assert dumped["conversation_id"] == "conv-456"
        assert dumped["kind"] == "OpenBrowserAction"


class TestOpenBrowserObservation:
    def test_javascript_result_truncates_large_payload_and_hides_script_source(
        self,
    ) -> None:
        observation = OpenBrowserObservation(
            success=True,
            message="Executed JavaScript: (() => window.secretToken)()",
            javascript_result="x" * 50010,
        )

        text = _text_content(observation)

        assert "**Action**: JavaScript code executed successfully" in text
        assert "window.secretToken" not in text
        assert "... (truncated)" in text

    def test_browser_state_prefers_tab_id_field_and_attaches_screenshot(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            tabs=[
                {
                    "id": 1,
                    "tabId": 99,
                    "title": "Example",
                    "url": "https://example.com",
                    "active": True,
                }
            ],
            screenshot_data_url="data:image/png;base64,abc123",
        )

        llm_content = observation.to_llm_content

        assert len(llm_content) == 2
        assert isinstance(llm_content[0], TextContent)
        assert isinstance(llm_content[1], ImageContent)
        assert "**[99]** Example" in llm_content[0].text
        assert llm_content[1].image_urls == ["data:image/png;base64,abc123"]

    def test_highlighted_elements_truncate_long_html_for_non_selectable_results(
        self,
    ) -> None:
        long_html = "<button>" + ("x" * 220) + "</button>"
        observation = OpenBrowserObservation(
            success=True,
            element_type="clickable",
            highlighted_elements=[
                {"id": "abc123", "type": "clickable", "html": long_html}
            ],
            total_elements=1,
        )

        text = _text_content(observation)

        assert "abc123(clickable):" in text
        assert "...(Truncated)" in text

    def test_selectable_elements_keep_full_html_so_options_remain_visible(self) -> None:
        select_html = (
            "<select>"
            + "".join(f"<option value='{i}'>Option {i}</option>" for i in range(12))
            + "</select>"
        )
        observation = OpenBrowserObservation(
            success=True,
            element_type="selectable",
            highlighted_elements=[
                {"id": "sel999", "type": "selectable", "html": select_html}
            ],
            total_elements=1,
        )

        text = _text_content(observation)

        assert select_html in text
        assert "...(Truncated)" not in text

    def test_highlighted_elements_include_detected_type_suffix(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            element_type="any",
            highlighted_elements=[
                {
                    "id": "vrtbj5",
                    "type": "clickable",
                    "html": '<div class="search-icon"></div>',
                },
                {
                    "id": "q4w08w",
                    "type": "inputable",
                    "html": '<input id="search-input" />',
                },
            ],
            total_elements=2,
        )

        text = _text_content(observation)

        assert "vrtbj5(clickable):" in text
        assert "q4w08w(inputable):" in text

    def test_highlighted_elements_include_interaction_hints_in_suffix(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            element_type="any",
            highlighted_elements=[
                {
                    "id": "swp123",
                    "type": "clickable",
                    "interactionHints": ["swipable"],
                    "html": '<div class="swiper-slide"></div>',
                }
            ],
            total_elements=1,
        )

        text = _text_content(observation)

        assert "swp123(clickable, swipable):" in text

    def test_pending_confirmation_includes_follow_up_command(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            pending_confirmation={
                "element_id": "a1b2c3",
                "action_type": "click",
                "full_html": "<button>Delete</button>",
            },
        )

        text = _text_content(observation)

        assert "## ⚠️ Action Pending Confirmation" in text
        assert "use the `element_interaction` tool" in text
        assert '"action": "confirm_click"' in text
        assert '"element_id": "a1b2c3"' in text

    def test_pending_keyboard_confirmation_uses_matching_follow_up_command(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            pending_confirmation={
                "element_id": "inp789",
                "action_type": "keyboard_input",
                "full_html": '<input type="text" />',
            },
        )

        text = _text_content(observation)

        assert '"action": "confirm_keyboard_input"' in text
        assert '"element_id": "inp789"' in text

    def test_auto_accepted_dialogs_render_history_and_note(self) -> None:
        observation = OpenBrowserObservation(
            success=True,
            auto_accepted_dialogs=[
                {
                    "type": "alert",
                    "message": "Saved successfully",
                    "url": "https://example.com/settings",
                },
                {
                    "type": "alert",
                    "message": "Background sync complete",
                },
            ],
        )

        text = _text_content(observation)

        assert "## ✅ Auto-Accepted Dialogs" in text
        assert "**Total Auto-Accepted**: 2" in text
        assert '1. **ALERT**: "Saved successfully"' in text
        assert "URL: https://example.com/settings" in text
        assert "Alert dialogs are auto-accepted by the system." in text
