"""Compile recording traces into normalized steps and workflow draft IR."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Any, Literal

AmbientEventType = Literal[
    "recording_started",
    "recording_stopped",
]


@dataclass(frozen=True)
class CompiledWorkflowDraft:
    """Compiled draft artifacts from a recording trace."""

    normalized_steps: list[dict[str, Any]]
    workflow: dict[str, Any]


def _normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def _event_timestamp(event: dict[str, Any]) -> float:
    event_data = event.get("event_data")
    if isinstance(event_data, dict):
        for key in ("timestamp", "recordedAt"):
            raw_value = event_data.get(key)
            if isinstance(raw_value, (int, float)):
                return float(raw_value)
            if isinstance(raw_value, str) and raw_value.isdigit():
                return float(raw_value)
            if isinstance(raw_value, str):
                parsed = _parse_iso_datetime(raw_value)
                if parsed is not None:
                    return parsed.timestamp() * 1000

    created_at = event.get("created_at")
    if isinstance(created_at, str):
        parsed = _parse_iso_datetime(created_at)
        if parsed is not None:
            return parsed.timestamp() * 1000

    event_index = event.get("event_index")
    if isinstance(event_index, (int, float)):
        return float(event_index)

    return 0.0


def _parse_iso_datetime(value: str) -> datetime | None:
    candidate = value.strip()
    if not candidate:
        return None
    try:
        return datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None


def _event_type(event: dict[str, Any]) -> str:
    raw = event.get("event_type")
    return str(raw) if raw is not None else ""


def _event_data(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("event_data")
    if isinstance(payload, dict):
        return payload
    return {}


def _element_payload(event_data: dict[str, Any]) -> dict[str, Any]:
    element = event_data.get("element")
    if isinstance(element, dict):
        return element
    return {}


def _get_page_url(event_data: dict[str, Any]) -> str | None:
    for key in ("page", "tab"):
        container = event_data.get(key)
        if isinstance(container, dict):
            url = _normalize_text(container.get("url"))
            if url:
                return url
    return _normalize_text(event_data.get("url"))


def _get_page_title(event_data: dict[str, Any]) -> str | None:
    for key in ("page", "tab"):
        container = event_data.get(key)
        if isinstance(container, dict):
            title = _normalize_text(container.get("title"))
            if title:
                return title
    return _normalize_text(event_data.get("title"))


def _element_identity(event_data: dict[str, Any]) -> str:
    element = _element_payload(event_data)
    container = element.get("container")
    if not isinstance(container, dict):
        container = {}

    parts = [
        _normalize_text(element.get("selector")) or "",
        _normalize_text(element.get("text")) or "",
        _normalize_text(element.get("ariaLabel")) or "",
        _normalize_text(element.get("placeholder")) or "",
        _normalize_text(container.get("selector")) or "",
    ]
    return "|".join(parts)


def _build_anchor(event_data: dict[str, Any]) -> dict[str, Any]:
    element = _element_payload(event_data)
    container = element.get("container")
    if not isinstance(container, dict):
        container = {}

    return {
        "selector": _normalize_text(element.get("selector")),
        "text": _normalize_text(element.get("text")),
        "aria_label": _normalize_text(element.get("ariaLabel")),
        "placeholder": _normalize_text(element.get("placeholder")),
        "container": {
            "kind": _normalize_text(container.get("kind")),
            "selector": _normalize_text(container.get("selector")),
            "title": _normalize_text(container.get("title")),
            "href": _normalize_text(container.get("href")),
        },
        "page_url": _get_page_url(event_data),
    }


def _is_ambient_event(event_type: str) -> bool:
    ambient_types: set[AmbientEventType] = {
        "recording_started",
        "recording_stopped",
    }
    return event_type in ambient_types


def _is_form_event(event_type: str) -> bool:
    return event_type in {"focus", "input", "change", "keydown", "submit"}


def _build_navigation_step(
    event: dict[str, Any],
    sorted_index: int,
) -> dict[str, Any] | None:
    event_data = _event_data(event)
    url = _get_page_url(event_data)
    if not url:
        return None

    title = _get_page_title(event_data)
    index = event.get("event_index")

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "navigate",
        "action": "navigate",
        "description": f"Navigate to {title or url}",
        "target": {"url": url, "title": title},
        "source_event_indexes": [index] if index is not None else [],
        "anchors": [],
        "preconditions": [],
        "postconditions": [
            {
                "type": "page_loaded",
                "url": url,
            }
        ],
        "executor_preference": "agent",
    }


class _VisibleTextExtractor(HTMLParser):
    _SKIP_TAGS = {"script", "style"}
    _BLOCK_TAGS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section"}

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
        if tag in self._BLOCK_TAGS:
            self._parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag in self._BLOCK_TAGS:
            self._parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def _extract_visible_text_from_html(html: Any) -> str | None:
    """Extract visible text from an HTML snapshot, or None if nothing usable.

    Used as a fallback for contenteditable edits where per-keystroke `input`
    events don't fire (the old extension filter ignored contenteditables).
    The final HTML of the target element is often captured on the surrounding
    keydown event and contains the full typed content.
    """
    if not isinstance(html, str) or not html:
        return None
    parser = _VisibleTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return None
    return _normalize_text(parser.text())


def _extract_input_value(event_data: dict[str, Any]) -> tuple[str | None, bool]:
    element = _element_payload(event_data)
    is_sensitive = bool(element.get("isSensitive"))

    value = element.get("value")
    normalized_value = _normalize_text(value)
    if normalized_value:
        return normalized_value, is_sensitive

    if not is_sensitive:
        html_text = _extract_visible_text_from_html(element.get("html"))
        if html_text:
            return html_text, is_sensitive

        text_fallback = _normalize_text(element.get("text"))
        if text_fallback:
            return text_fallback, is_sensitive

    placeholder = _normalize_text(element.get("placeholder"))
    if placeholder and is_sensitive:
        return None, True

    return None, is_sensitive


def _build_click_step(
    event: dict[str, Any],
    sorted_index: int,
) -> dict[str, Any]:
    event_data = _event_data(event)
    anchor = _build_anchor(event_data)
    event_index = event.get("event_index")

    selector = anchor.get("selector")
    label = anchor.get("text") or anchor.get("aria_label") or selector or "target"

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "click",
        "action": "click",
        "description": f"Click {label}",
        "target": anchor,
        "source_event_indexes": [event_index] if event_index is not None else [],
        "anchors": [anchor],
        "preconditions": [
            {
                "type": "page_url_contains",
                "value": _get_page_url(event_data),
            }
        ],
        "postconditions": [],
        "executor_preference": "agent",
    }


def _get_scroll_position(
    event_data: dict[str, Any],
) -> tuple[float | None, float | None]:
    scroll_x = event_data.get("scrollX")
    scroll_y = event_data.get("scrollY")

    return (
        float(scroll_x) if isinstance(scroll_x, (int, float)) else None,
        float(scroll_y) if isinstance(scroll_y, (int, float)) else None,
    )


def _build_scroll_step(
    cluster: list[dict[str, Any]],
    next_event: dict[str, Any] | None,
    sorted_index: int,
) -> dict[str, Any] | None:
    if not cluster:
        return None

    first_event_data = _event_data(cluster[0])
    last_event_data = _event_data(cluster[-1])
    _, first_scroll_y = _get_scroll_position(first_event_data)
    scroll_x, last_scroll_y = _get_scroll_position(last_event_data)

    if last_scroll_y is None:
        return None

    max_scroll_y_raw = last_event_data.get("maxScrollY")
    max_scroll_y = (
        float(max_scroll_y_raw) if isinstance(max_scroll_y_raw, (int, float)) else None
    )
    source_event_indexes = [
        int(raw)
        for raw in (event.get("event_index") for event in cluster)
        if isinstance(raw, int)
    ]
    page_url = _get_page_url(last_event_data)
    next_event_type = _event_type(next_event) if next_event is not None else None
    next_page_url = (
        _get_page_url(_event_data(next_event)) if next_event is not None else None
    )

    cluster_size = len(cluster)
    absolute_scroll_y = abs(last_scroll_y)
    delta_scroll_y = (
        last_scroll_y - first_scroll_y if first_scroll_y is not None else last_scroll_y
    )
    absolute_delta_y = abs(delta_scroll_y)
    near_bottom = bool(
        max_scroll_y and max_scroll_y > 0 and last_scroll_y / max_scroll_y >= 0.82
    )
    has_following_same_page_action = bool(
        next_event_type in {"click", "focus", "input", "change", "keydown", "submit"}
        and page_url
        and next_page_url == page_url
    )

    if not (
        has_following_same_page_action
        and (
            cluster_size >= 2
            or absolute_delta_y >= 480
            or absolute_scroll_y >= 720
            or near_bottom
        )
    ):
        return None

    direction = "down" if delta_scroll_y >= 0 else "up"
    description = (
        "Scroll down to reveal more content before the next action"
        if direction == "down"
        else "Scroll up to return to earlier content before the next action"
    )

    target: dict[str, Any] = {
        "direction": direction,
        "scroll_y": round(last_scroll_y),
        "page_url": page_url,
        "cluster_size": cluster_size,
    }
    if absolute_delta_y > 0:
        target["delta_y"] = round(delta_scroll_y)
    if scroll_x is not None:
        target["scroll_x"] = round(scroll_x)
    if max_scroll_y is not None:
        target["max_scroll_y"] = round(max_scroll_y)
    if near_bottom:
        target["near_page_bottom"] = True
    if next_event_type:
        target["reveals_for_next_action"] = next_event_type

    preconditions: list[dict[str, Any]] = []
    if page_url:
        preconditions.append(
            {
                "type": "page_url_contains",
                "value": page_url,
            }
        )

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "scroll",
        "action": "scroll_to_reveal",
        "description": description,
        "target": target,
        "source_event_indexes": source_event_indexes,
        "anchors": [],
        "preconditions": preconditions,
        "postconditions": [],
        "executor_preference": "agent",
    }


def _build_form_step(
    cluster: list[dict[str, Any]],
    sorted_index: int,
) -> dict[str, Any] | None:
    input_events = [
        event for event in cluster if _event_type(event) in {"input", "change"}
    ]
    if not input_events and not any(
        _event_type(event) == "submit" for event in cluster
    ):
        return None

    field_map: dict[str, dict[str, Any]] = {}
    for event in input_events:
        event_data = _event_data(event)
        identity = _element_identity(event_data)
        if not identity:
            identity = f"anonymous:{event.get('event_index', 0)}"

        value, sensitive = _extract_input_value(event_data)
        anchor = _build_anchor(event_data)

        field = field_map.setdefault(
            identity,
            {
                "anchor": anchor,
                "value": value,
                "is_sensitive": sensitive,
                "source_event_indexes": [],
            },
        )

        if value is not None:
            field["value"] = value
        if sensitive:
            field["is_sensitive"] = True

        event_index = event.get("event_index")
        if event_index is not None:
            field["source_event_indexes"].append(event_index)

    field_entries = list(field_map.values())
    has_submit = any(_event_type(event) == "submit" for event in cluster)

    source_event_indexes: list[int] = []
    for event in cluster:
        raw = event.get("event_index")
        if isinstance(raw, int):
            source_event_indexes.append(raw)

    fields_payload: list[dict[str, Any]] = []
    for position, field in enumerate(field_entries, start=1):
        anchor = field["anchor"]
        value = field.get("value")
        is_sensitive = bool(field.get("is_sensitive"))

        variable_name = f"input_{position}"
        value_spec: dict[str, Any]
        if is_sensitive:
            value_spec = {
                "kind": "variable",
                "name": variable_name,
                "required": True,
                "sensitive": True,
            }
        elif isinstance(value, str) and value:
            value_spec = {
                "kind": "variable",
                "name": variable_name,
                "required": False,
                "default": value,
                "sensitive": False,
            }
        else:
            value_spec = {
                "kind": "variable",
                "name": variable_name,
                "required": True,
                "sensitive": False,
            }

        fields_payload.append(
            {
                "anchor": anchor,
                "value": value_spec,
                "source_event_indexes": field.get("source_event_indexes", []),
            }
        )

    first_event_data = _event_data(cluster[0]) if cluster else {}
    action = "form_fill_submit" if has_submit else "form_fill"
    description = "Fill fields and submit form" if has_submit else "Fill form fields"

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "form",
        "action": action,
        "description": description,
        "target": {
            "form": _normalize_text(
                (_event_data(cluster[-1]).get("form") or {}).get("selector")
                if cluster
                else None
            ),
            "fields": fields_payload,
        },
        "source_event_indexes": sorted(source_event_indexes),
        "anchors": [field["anchor"] for field in field_entries],
        "preconditions": [
            {
                "type": "page_url_contains",
                "value": _get_page_url(first_event_data),
            }
        ],
        "postconditions": [
            {
                "type": "form_submitted",
                "expected": has_submit,
            }
        ],
        "executor_preference": "agent",
    }


def _build_anchor_from_element(
    element: dict[str, Any], event_data: dict[str, Any]
) -> dict[str, Any]:
    """Build an anchor dict from an element payload (not necessarily event_data['element'])."""
    container = element.get("container")
    if not isinstance(container, dict):
        container = {}

    return {
        "selector": _normalize_text(element.get("selector")),
        "text": _normalize_text(element.get("text")),
        "aria_label": _normalize_text(element.get("ariaLabel")),
        "placeholder": _normalize_text(element.get("placeholder")),
        "container": {
            "kind": _normalize_text(container.get("kind")),
            "selector": _normalize_text(container.get("selector")),
            "title": _normalize_text(container.get("title")),
            "href": _normalize_text(container.get("href")),
        },
        "page_url": _get_page_url(event_data),
    }


def _build_drag_and_drop_step(
    event: dict[str, Any],
    sorted_index: int,
) -> dict[str, Any]:
    event_data = _event_data(event)
    event_index = event.get("event_index")

    source_element = event_data.get("sourceElement")
    if not isinstance(source_element, dict):
        source_element = {}
    target_element = event_data.get("targetElement")
    if not isinstance(target_element, dict):
        target_element = {}

    source_anchor = _build_anchor_from_element(source_element, event_data)
    target_anchor = _build_anchor_from_element(target_element, event_data)

    source_label = (
        _normalize_text(source_element.get("text"))
        or _normalize_text(source_element.get("ariaLabel"))
        or _normalize_text(source_element.get("selector"))
        or "source"
    )
    target_label = (
        _normalize_text(target_element.get("text"))
        or _normalize_text(target_element.get("ariaLabel"))
        or _normalize_text(target_element.get("selector"))
        or "target"
    )

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "drag_and_drop",
        "action": "drag_and_drop",
        "description": f"Drag {source_label} to {target_label}",
        "target": {
            "source": source_anchor,
            "destination": target_anchor,
        },
        "source_event_indexes": [event_index] if event_index is not None else [],
        "anchors": [source_anchor, target_anchor],
        "preconditions": [
            {
                "type": "page_url_contains",
                "value": _get_page_url(event_data),
            }
        ],
        "postconditions": [],
        "executor_preference": "agent",
    }


def _build_set_slider_step(
    event: dict[str, Any],
    sorted_index: int,
) -> dict[str, Any]:
    event_data = _event_data(event)
    anchor = _build_anchor(event_data)
    event_index = event.get("event_index")

    label = (
        anchor.get("text")
        or anchor.get("aria_label")
        or anchor.get("selector")
        or "slider"
    )
    value = event_data.get("value")
    min_val = event_data.get("min")
    max_val = event_data.get("max")

    value_desc = f" to {value}" if value else ""
    description = f"Set {label}{value_desc}"

    target: dict[str, Any] = {"anchor": anchor}
    if value is not None:
        target["value"] = value
    if min_val is not None:
        target["min"] = min_val
    if max_val is not None:
        target["max"] = max_val

    return {
        "id": f"step_{sorted_index + 1:03d}",
        "type": "set_slider",
        "action": "set_slider",
        "description": description,
        "target": target,
        "source_event_indexes": [event_index] if event_index is not None else [],
        "anchors": [anchor],
        "preconditions": [
            {
                "type": "page_url_contains",
                "value": _get_page_url(event_data),
            }
        ],
        "postconditions": [],
        "executor_preference": "agent",
    }


def normalize_trace_events(
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert low-level recording events into executable normalized steps."""
    sorted_events = sorted(
        events,
        key=lambda event: (_event_timestamp(event), int(event.get("event_index", 0))),
    )

    steps: list[dict[str, Any]] = []
    index = 0

    while index < len(sorted_events):
        event = sorted_events[index]
        event_type = _event_type(event)

        if _is_ambient_event(event_type):
            index += 1
            continue

        if event_type == "scroll":
            cluster: list[dict[str, Any]] = []
            while (
                index < len(sorted_events)
                and _event_type(sorted_events[index]) == "scroll"
            ):
                cluster.append(sorted_events[index])
                index += 1

            next_event = sorted_events[index] if index < len(sorted_events) else None
            step = _build_scroll_step(cluster, next_event, len(steps))
            if step is not None:
                steps.append(step)
            continue

        if event_type in {"tab_ready", "tab_navigated", "page_view"}:
            step = _build_navigation_step(event, len(steps))
            if step is not None:
                previous = steps[-1] if steps else None
                previous_target = (previous or {}).get("target")
                duplicate_navigation = (
                    previous is not None
                    and previous.get("type") == "navigate"
                    and isinstance(previous_target, dict)
                    and previous_target.get("url") == step["target"]["url"]
                )
                if not duplicate_navigation:
                    steps.append(step)
            index += 1
            continue

        if event_type == "click":
            steps.append(_build_click_step(event, len(steps)))
            index += 1
            continue

        if event_type == "drag_and_drop":
            steps.append(_build_drag_and_drop_step(event, len(steps)))
            index += 1
            continue

        if event_type == "set_slider":
            steps.append(_build_set_slider_step(event, len(steps)))
            index += 1
            continue

        if _is_form_event(event_type):
            cluster: list[dict[str, Any]] = []
            while index < len(sorted_events) and _is_form_event(
                _event_type(sorted_events[index])
            ):
                cluster.append(sorted_events[index])
                index += 1

            step = _build_form_step(cluster, len(steps))
            if step is not None:
                steps.append(step)
            continue

        index += 1

    return steps


def _extract_inputs_from_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    inputs: list[dict[str, Any]] = []
    seen: set[str] = set()

    for step in steps:
        target = step.get("target")
        if not isinstance(target, dict):
            continue

        fields = target.get("fields")
        if not isinstance(fields, list):
            continue

        for field in fields:
            if not isinstance(field, dict):
                continue
            value = field.get("value")
            if not isinstance(value, dict):
                continue

            name = value.get("name")
            if not isinstance(name, str) or name in seen:
                continue

            seen.add(name)
            anchor = field.get("anchor")
            if not isinstance(anchor, dict):
                anchor = {}

            selector = _normalize_text(anchor.get("selector"))
            text = _normalize_text(anchor.get("text"))
            description = text or selector or name

            inputs.append(
                {
                    "name": name,
                    "required": bool(value.get("required", False)),
                    "sensitive": bool(value.get("sensitive", False)),
                    "default": value.get("default"),
                    "description": f"Value for {description}",
                }
            )

    return inputs


def _extract_global_anchors(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    anchors: list[dict[str, Any]] = []
    seen: set[str] = set()

    for step in steps:
        raw_anchors = step.get("anchors")
        if not isinstance(raw_anchors, list):
            continue

        for anchor in raw_anchors:
            if not isinstance(anchor, dict):
                continue

            key = "|".join(
                [
                    str(anchor.get("selector") or ""),
                    str(anchor.get("text") or ""),
                    str(anchor.get("aria_label") or ""),
                    str(
                        (anchor.get("container") or {}).get("selector")
                        if isinstance(anchor.get("container"), dict)
                        else ""
                    ),
                    str(anchor.get("page_url") or ""),
                ]
            )
            if key in seen:
                continue

            seen.add(key)
            anchors.append(anchor)

    return anchors


def _infer_goal(steps: list[dict[str, Any]], recording_name: str | None) -> str:
    if recording_name:
        return recording_name

    if not steps:
        return "Replay captured browser workflow"

    last_step = steps[-1]
    action = str(last_step.get("action") or "complete workflow")

    target = last_step.get("target")
    if isinstance(target, dict):
        url = target.get("url")
        if isinstance(url, str) and url:
            return f"{action} on {url}"

    return f"Execute workflow ending with {action}"


def build_workflow_ir(
    recording_id: str,
    steps: list[dict[str, Any]],
    recording_name: str | None = None,
) -> dict[str, Any]:
    """Convert normalized steps into workflow IR JSON."""
    inputs = _extract_inputs_from_steps(steps)
    anchors = _extract_global_anchors(steps)

    return {
        "version": "workflow_ir/v0",
        "recording_id": recording_id,
        "goal": {
            "text": _infer_goal(steps, recording_name),
        },
        "inputs": inputs,
        "steps": steps,
        "anchors": anchors,
        "preconditions": [
            {
                "type": "browser_connected",
                "required": True,
            }
        ],
        "postconditions": [
            {
                "type": "workflow_completed",
                "expected_step_count": len(steps),
            }
        ],
        "executor_preference": "agent",
    }


def compile_recording_trace(
    recording_id: str,
    events: list[dict[str, Any]],
    recording_name: str | None = None,
) -> CompiledWorkflowDraft:
    """Compile raw trace events into normalized steps and workflow IR draft."""
    steps = normalize_trace_events(events)
    workflow = build_workflow_ir(recording_id, steps, recording_name)
    return CompiledWorkflowDraft(normalized_steps=steps, workflow=workflow)


_TYPING_EVENT_TYPES: frozenset[str] = frozenset(
    {"input", "change", "beforeinput"}
)


def _stable_element_identity(event_data: dict[str, Any]) -> str:
    """Identity that stays constant as the user types into an element.

    :func:`_element_identity` folds ``element.text`` into the hash because
    downstream form-step logic wants to detect *which field* changed even
    when users reuse a selector. That's the wrong shape for coalescing
    consecutive keystrokes on the *same* field, where ``element.text`` is
    exactly what changes on every event. This variant drops the mutating
    pieces (``text``, any ``value`` snapshot) and keeps only the stable
    anchors: selector, ARIA label, placeholder, and container selector.
    """
    element = _element_payload(event_data)
    container = element.get("container")
    if not isinstance(container, dict):
        container = {}

    parts = [
        _normalize_text(element.get("selector")) or "",
        _normalize_text(element.get("ariaLabel")) or "",
        _normalize_text(element.get("placeholder")) or "",
        _normalize_text(container.get("selector")) or "",
    ]
    return "|".join(parts)


def coalesce_typing_events(
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fold runs of consecutive typing events on the same element into one.

    Raw recordings emit one ``input`` event per keystroke on text fields and
    one per intra-IME-composition slice on contenteditable editors, so a
    single typed phrase can produce 100+ near-identical events. For the
    compiler-agent's trace view the only useful snapshot per typing burst is
    the *last* one (it already carries the final text/html of the element);
    every prior keystroke is noise that blows up the event list and hides
    meaningful actions (clicks, navigations) in between.

    Rule: walk events in order; whenever the next event's type is in
    ``_TYPING_EVENT_TYPES`` and its element identity (via
    :func:`_element_identity`) matches the *immediately previous surviving*
    event, keep the newer event and drop the prior one from the output list.
    The surviving event picks up two annotations on its ``event_data``:

    - ``coalescedEventIndexes``: list of every absorbed ``event_index``
      (including the surviving event's own) so the agent can still drill
      into any individual keystroke via ``event_detail``.
    - ``coalescedCount``: convenience count, mirrors ``len(...Indexes)``.

    If the surviving event lacks a ``keyframe`` but a prior one in the same
    run had one (typical: the first keystroke fires a pre-action capture),
    that keyframe is promoted forward so the agent still has a before-state
    screenshot for the typing burst.

    The returned list preserves input ordering and object identity for every
    non-absorbed event; only the surviving event of a merged run is a new
    dict with merged ``event_data``.
    """

    coalesced: list[dict[str, Any]] = []

    for event in events:
        event_type = _event_type(event)
        if event_type not in _TYPING_EVENT_TYPES:
            coalesced.append(event)
            continue

        if not coalesced:
            coalesced.append(event)
            continue

        prior = coalesced[-1]
        prior_type = _event_type(prior)
        if prior_type not in _TYPING_EVENT_TYPES:
            coalesced.append(event)
            continue

        prior_data = _event_data(prior)
        curr_data = _event_data(event)
        prior_id = _stable_element_identity(prior_data)
        curr_id = _stable_element_identity(curr_data)
        if not prior_id or prior_id != curr_id:
            coalesced.append(event)
            continue

        # Absorb the prior event into the current one.
        merged_data = dict(curr_data)

        # Promote the earliest keyframe in the run if the survivor doesn't
        # already have one. The before-state screenshot of the first
        # keystroke is a useful anchor for the whole burst.
        if not merged_data.get("keyframe") and prior_data.get("keyframe"):
            merged_data["keyframe"] = prior_data["keyframe"]

        prior_indexes = prior_data.get("coalescedEventIndexes")
        absorbed: list[Any]
        if isinstance(prior_indexes, list) and prior_indexes:
            absorbed = list(prior_indexes)
        else:
            prior_idx = prior.get("event_index")
            absorbed = [prior_idx] if prior_idx is not None else []

        curr_idx = event.get("event_index")
        if curr_idx is not None and curr_idx not in absorbed:
            absorbed.append(curr_idx)

        if absorbed:
            merged_data["coalescedEventIndexes"] = absorbed
            merged_data["coalescedCount"] = len(absorbed)

        merged_event = dict(event)
        merged_event["event_data"] = merged_data
        coalesced[-1] = merged_event

    return coalesced
