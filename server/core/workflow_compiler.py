"""Compile recording traces into normalized steps and workflow draft IR."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

AmbientEventType = Literal[
    "recording_started",
    "recording_stopped",
    "scroll",
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
        "scroll",
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
        "executor_preference": "deterministic",
    }


def _extract_input_value(event_data: dict[str, Any]) -> tuple[str | None, bool]:
    element = _element_payload(event_data)
    is_sensitive = bool(element.get("isSensitive"))

    value = element.get("value")
    normalized_value = _normalize_text(value)
    if normalized_value:
        return normalized_value, is_sensitive

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

    has_locator = bool(
        anchor.get("selector") or anchor.get("text") or anchor.get("aria_label")
    )

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
        "executor_preference": "deterministic" if has_locator else "agent",
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
    needs_agent = False
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
            needs_agent = True
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
            needs_agent = True

        if not (
            anchor.get("selector") or anchor.get("text") or anchor.get("aria_label")
        ):
            needs_agent = True

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
        "executor_preference": "agent" if needs_agent else "deterministic",
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
        "executor_preference": "hybrid",
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
