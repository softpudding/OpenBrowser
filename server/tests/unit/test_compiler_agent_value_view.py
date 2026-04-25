"""Tests for the trace_viewer value-rendering helpers.

The compiler agent previously truncated input values at 80 characters in
the `events` view and omitted them entirely from `normalized_steps`.
That hid agent-investigation prompts users typed at the *end* of a
contenteditable body — the URL prefix occupied the first 80 chars and
the trailing instructions were never visible to the LLM.

These tests pin two things:

  1. ``_format_value_with_tail`` always shows both ends of a long
     string with an explicit `…(N more chars; use event_detail)…`
     middle marker so the LLM has a clear signal to drill in.
  2. ``_handle_normalized_steps`` surfaces the final value of each
     anchor in form-fill steps, so the LLM does not need to drill
     into every typing event to find the user's actual text.
"""

from __future__ import annotations

from server.core.compiler_agent import TraceViewerExecutor

YUQUE_BODY_FINAL_VALUE = (
    "https://github.com/huggingface/ml-intern 🤗 ml-intern: "
    "an open-source ML engineer that reads papers, trains models, "
    "and ships ML models Write also: 1. A brief intro 2. What's "
    "special 3. Why's it trending"
)


def test_format_value_with_tail_returns_short_strings_unchanged() -> None:
    short = "Most trending project 2026-04-24"
    assert TraceViewerExecutor._format_value_with_tail(short) == short


def test_format_value_with_tail_keeps_head_and_tail_visible() -> None:
    rendered = TraceViewerExecutor._format_value_with_tail(
        YUQUE_BODY_FINAL_VALUE, head=80, tail=80
    )
    # URL anchor is in the head — the LLM needs to see it to know which
    # element/page is being typed into.
    assert rendered.startswith("https://github.com/huggingface/ml-intern")
    # The user's instructions are in the tail — these are the part that
    # was previously invisible at 80-char single-end truncation.
    assert "Why's it trending" in rendered
    assert "more chars; use event_detail" in rendered


def test_format_value_with_tail_omitted_count_matches_actual_omission() -> None:
    value = "x" * 1000
    rendered = TraceViewerExecutor._format_value_with_tail(value, head=100, tail=100)
    assert "(800 more chars; use event_detail)" in rendered


def test_format_value_with_tail_handles_non_string_safely() -> None:
    assert TraceViewerExecutor._format_value_with_tail(None) == ""  # type: ignore[arg-type]
    assert TraceViewerExecutor._format_value_with_tail(123) == ""  # type: ignore[arg-type]


def _build_form_step_with_anchor_value(selector: str, value: str) -> dict:
    return {
        "id": "step_001",
        "type": "form",
        "description": "Fill form fields",
        "source_event_indexes": [10, 11, 12],
        "target": {
            "form": None,
            "fields": [
                {
                    "anchor": {
                        "selector": selector,
                        "placeholder": "请输入标题",
                    },
                    "value": {
                        "kind": "variable",
                        "default": value[: max(1, len(value) // 3)],
                    },
                },
                {
                    "anchor": {"selector": selector},
                    "value": {
                        "kind": "variable",
                        "default": value[: max(1, len(value) // 2)],
                    },
                },
                {
                    "anchor": {"selector": selector},
                    "value": {
                        "kind": "variable",
                        "default": value,  # final, longest
                    },
                },
            ],
        },
    }


def test_normalized_steps_view_emits_final_value_for_form_anchor() -> None:
    step = _build_form_step_with_anchor_value(
        selector=(
            "div.ne-editor-wrap-box > div.ne-editor-box:nth-of-type(2) "
            "> div.ne-engine-box > div.ne-engine.ne-typography-classic"
            ":nth-of-type(1)"
        ),
        value=YUQUE_BODY_FINAL_VALUE,
    )

    executor = TraceViewerExecutor(
        events=[],
        normalized_steps=[step],
        intent_note=None,
        recording_name=None,
    )
    output = executor._handle_normalized_steps().text_result

    assert "step_001 [form]" in output
    # Final value is surfaced inline with the step.
    assert "final_value=" in output
    # User's typed instructions (the tail of the value) appear in the
    # output — they were previously hidden.
    assert "Why's it trending" in output


def test_normalized_steps_view_picks_latest_value_per_anchor_in_event_order() -> None:
    """The surfaced summary must reflect the LAST snapshot per anchor in
    event order — not the longest. Picking longest breaks paste-then-trim,
    backspace-heavy edits, and clear-and-rewrite flows where the user's
    final state is shorter than an intermediate maximum.
    """
    selector = "textarea.example"
    # Fields in event order: type "long initial draft text", then clear
    # and rewrite as "short final". A longest-wins picker would surface
    # "long initial draft text" — wrong. Latest-wins surfaces "short final".
    fields = [
        {
            "anchor": {"selector": selector},
            "value": {"kind": "variable", "default": "long initial draft text"},
        },
        {
            "anchor": {"selector": selector},
            "value": {"kind": "variable", "default": "long initial draft te"},
        },
        {
            "anchor": {"selector": selector},
            "value": {"kind": "variable", "default": ""},
        },
        {
            "anchor": {"selector": selector},
            "value": {"kind": "variable", "default": "short final"},
        },
    ]
    step = {
        "id": "step_001",
        "type": "form",
        "description": "Fill form fields",
        "source_event_indexes": [10, 11, 12, 13],
        "target": {"form": None, "fields": fields},
    }
    executor = TraceViewerExecutor(
        events=[],
        normalized_steps=[step],
        intent_note=None,
        recording_name=None,
    )
    output = executor._handle_normalized_steps().text_result

    assert 'final_value="short final"' in output
    assert "long initial draft" not in output
