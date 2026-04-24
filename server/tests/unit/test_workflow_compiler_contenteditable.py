"""Regression tests for contenteditable text recovery in workflow_compiler.

Yuque (and other rich editors) use contenteditable `<div>` elements for the
document body. The old extension content script filtered input events to
form controls only, so no per-keystroke `input` events were emitted for the
body — the only surviving record of typed text was the `element.html`
snapshot attached to surrounding keydown events. These tests lock in the
compiler-side fallback that recovers that text from `element.html` when
`element.value` is missing.
"""

from __future__ import annotations

from server.core.workflow_compiler import (
    _extract_input_value,
    _extract_visible_text_from_html,
)


YUQUE_BODY_HTML = (
    '<div class="ne-engine ne-typography-classic" contenteditable="true">'
    '<ne-p><ne-link><ne-link-content><ne-text>'
    'https://github.com/zilliztech/claude-context'
    '</ne-text></ne-link-content></ne-link>'
    '<ne-text> </ne-text>'
    '<ne-link><ne-link-content><ne-text>'
    'https://github.com/KeygraphHQ/shannon'
    '</ne-text></ne-link-content></ne-link>'
    '<ne-text> Why these projects are trending? '
    'What does each of them do?</ne-text>'
    '<span class="ne-b-filler"><br></span></ne-p></div>'
)


def test_visible_text_extracts_typed_questions_from_yuque_body() -> None:
    extracted = _extract_visible_text_from_html(YUQUE_BODY_HTML)
    assert extracted is not None
    assert "Why these projects are trending?" in extracted
    assert "What does each of them do?" in extracted
    assert "https://github.com/zilliztech/claude-context" in extracted


def test_visible_text_handles_empty_and_malformed_inputs() -> None:
    assert _extract_visible_text_from_html(None) is None
    assert _extract_visible_text_from_html("") is None
    assert _extract_visible_text_from_html("   <br>  ") is None
    # Malformed HTML must not raise.
    result = _extract_visible_text_from_html("<div>hello<scr")
    assert result is not None and "hello" in result


def test_visible_text_skips_script_and_style() -> None:
    html = (
        "<div>visible <script>secret()</script> "
        "<style>.x{color:red}</style>more</div>"
    )
    extracted = _extract_visible_text_from_html(html)
    assert extracted is not None
    assert "visible" in extracted
    assert "more" in extracted
    assert "secret()" not in extracted
    assert "color:red" not in extracted


def test_extract_input_value_falls_back_to_html_when_value_missing() -> None:
    event_data = {
        "element": {
            "tagName": "div",
            "value": None,
            "html": YUQUE_BODY_HTML,
            "isSensitive": False,
        }
    }
    value, is_sensitive = _extract_input_value(event_data)
    assert is_sensitive is False
    assert value is not None
    assert "Why these projects are trending?" in value


def test_extract_input_value_prefers_explicit_value_over_html() -> None:
    event_data = {
        "element": {
            "tagName": "textarea",
            "value": "explicit title text",
            "html": "<div>ignored fallback</div>",
            "isSensitive": False,
        }
    }
    value, _ = _extract_input_value(event_data)
    assert value == "explicit title text"


def test_extract_input_value_refuses_html_fallback_for_sensitive_fields() -> None:
    event_data = {
        "element": {
            "tagName": "input",
            "value": None,
            "html": "<input value='hunter2'>",
            "isSensitive": True,
        }
    }
    value, is_sensitive = _extract_input_value(event_data)
    assert value is None
    assert is_sensitive is True


def test_extract_input_value_falls_back_to_text_field() -> None:
    event_data = {
        "element": {
            "tagName": "div",
            "value": None,
            "html": None,
            "text": "raw text snapshot",
            "isSensitive": False,
        }
    }
    value, _ = _extract_input_value(event_data)
    assert value == "raw text snapshot"
