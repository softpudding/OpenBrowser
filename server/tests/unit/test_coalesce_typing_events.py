"""Tests for ``coalesce_typing_events`` in ``workflow_compiler``.

The recorder emits one ``input`` event per keystroke on text fields and one
per intra-IME-composition slice on contenteditable editors, so a 10-letter
title produces 10 near-identical events. The compiler-agent's trace viewer
feeds raw events to an LLM, so leaving them uncoalesced buries the useful
actions (clicks, navigations) in typing noise. These tests lock in the
merge semantics.
"""

from __future__ import annotations

from server.core.workflow_compiler import coalesce_typing_events


def _mk_input(
    event_index: int,
    selector: str,
    text: str,
    keyframe: dict | None = None,
    event_type: str = "input",
) -> dict:
    data: dict = {
        "source": "content",
        "element": {
            "tagName": "textarea",
            "selector": selector,
            "text": text,
            "html": f"<textarea>{text}</textarea>",
            "ariaLabel": None,
            "placeholder": None,
        },
    }
    if keyframe is not None:
        data["keyframe"] = keyframe
    return {
        "event_index": event_index,
        "event_type": event_type,
        "event_data": data,
    }


def _mk_click(event_index: int, selector: str) -> dict:
    return {
        "event_index": event_index,
        "event_type": "click",
        "event_data": {
            "element": {
                "tagName": "button",
                "selector": selector,
                "text": "Submit",
                "placeholder": None,
                "ariaLabel": None,
            }
        },
    }


def test_consecutive_keystrokes_on_same_element_fold_into_last_event() -> None:
    events = [
        _mk_input(0, "textarea#title", ""),
        _mk_input(1, "textarea#title", "T"),
        _mk_input(2, "textarea#title", "Tr"),
        _mk_input(3, "textarea#title", "Trend"),
    ]
    out = coalesce_typing_events(events)
    assert len(out) == 1
    survivor = out[0]
    assert survivor["event_index"] == 3
    assert survivor["event_data"]["element"]["text"] == "Trend"
    assert survivor["event_data"]["coalescedEventIndexes"] == [0, 1, 2, 3]
    assert survivor["event_data"]["coalescedCount"] == 4


def test_typing_on_different_elements_does_not_fold() -> None:
    events = [
        _mk_input(0, "textarea#title", "T"),
        _mk_input(1, "textarea#body", "B"),
        _mk_input(2, "textarea#title", "Ti"),
    ]
    out = coalesce_typing_events(events)
    # Three distinct identities → three surviving events, nothing absorbed.
    assert [e["event_index"] for e in out] == [0, 1, 2]
    for e in out:
        assert "coalescedCount" not in (e["event_data"])


def test_non_typing_event_between_keystrokes_breaks_the_run() -> None:
    events = [
        _mk_input(0, "textarea#title", "T"),
        _mk_input(1, "textarea#title", "Ti"),
        _mk_click(2, "button.save"),
        _mk_input(3, "textarea#title", "Tit"),
    ]
    out = coalesce_typing_events(events)
    # First two fold into idx=1; click stays; third keystroke stands alone.
    assert [e["event_index"] for e in out] == [1, 2, 3]
    first = out[0]
    assert first["event_data"]["coalescedEventIndexes"] == [0, 1]
    last = out[2]
    assert "coalescedCount" not in last["event_data"]


def test_change_and_beforeinput_are_treated_as_typing_events() -> None:
    events = [
        _mk_input(0, "textarea#title", "T", event_type="beforeinput"),
        _mk_input(1, "textarea#title", "Ti", event_type="input"),
        _mk_input(2, "textarea#title", "Tit", event_type="change"),
    ]
    out = coalesce_typing_events(events)
    assert len(out) == 1
    survivor = out[0]
    assert survivor["event_index"] == 2
    assert survivor["event_type"] == "change"
    assert survivor["event_data"]["coalescedEventIndexes"] == [0, 1, 2]


def test_first_keyframe_is_promoted_forward_if_last_lacks_one() -> None:
    events = [
        _mk_input(
            0,
            "textarea#title",
            "T",
            keyframe={"imageData": "IMG0", "trigger": "focus"},
        ),
        _mk_input(1, "textarea#title", "Ti"),  # no keyframe
        _mk_input(2, "textarea#title", "Tit"),  # no keyframe
    ]
    out = coalesce_typing_events(events)
    assert len(out) == 1
    survivor = out[0]
    # Keyframe from event 0 should have been promoted onto the survivor.
    assert survivor["event_data"]["keyframe"]["imageData"] == "IMG0"


def test_survivor_keeps_its_own_keyframe_over_earlier_ones() -> None:
    events = [
        _mk_input(
            0,
            "textarea#title",
            "T",
            keyframe={"imageData": "IMG0"},
        ),
        _mk_input(
            1,
            "textarea#title",
            "Ti",
            keyframe={"imageData": "IMG1"},
        ),
    ]
    out = coalesce_typing_events(events)
    assert len(out) == 1
    assert out[0]["event_data"]["keyframe"]["imageData"] == "IMG1"


def test_empty_input_and_non_typing_inputs_pass_through() -> None:
    assert coalesce_typing_events([]) == []
    # Pure non-typing events pass through unchanged.
    events = [_mk_click(0, ".a"), _mk_click(1, ".b")]
    out = coalesce_typing_events(events)
    assert [e["event_index"] for e in out] == [0, 1]
    # Object identity preserved — no unnecessary copying.
    assert out[0] is events[0]
    assert out[1] is events[1]


def test_runs_separated_by_non_typing_each_coalesce_independently() -> None:
    events = [
        _mk_input(0, "textarea#title", "T"),
        _mk_input(1, "textarea#title", "Tr"),
        _mk_click(2, "button.intermediate"),
        _mk_input(3, "textarea#title", "Tre"),
        _mk_input(4, "textarea#title", "Tren"),
        _mk_input(5, "textarea#title", "Trend"),
    ]
    out = coalesce_typing_events(events)
    assert [e["event_index"] for e in out] == [1, 2, 5]
    assert out[0]["event_data"]["coalescedEventIndexes"] == [0, 1]
    assert out[2]["event_data"]["coalescedEventIndexes"] == [3, 4, 5]
