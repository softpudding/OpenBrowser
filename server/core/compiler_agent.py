"""Compiler Agent: turn a recording trace into an executable Browser Routine
via an SDK agent.

Uses the openhands-sdk Agent/Conversation pattern with:
- TraceViewerTool — lets the agent navigate through recording events
- FileEditorTool — lets the agent write the Routine file
- AskUserTool — lets the agent ask the user clarification questions
- SubmitWorkflowTool — validates the Routine file and finishes the conversation
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import queue
import re
import tempfile
import threading
import time
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import Field, SecretStr
from rich.text import Text

from openhands.sdk import (
    Action,
    Agent,
    AgentContext,
    Conversation,
    ImageContent,
    LLM,
    Observation,
    TextContent,
)
from openhands.sdk.conversation.state import ConversationExecutionStatus
from openhands.sdk.event import ActionEvent, MessageEvent, ObservationEvent
from openhands.sdk.event.base import Event
from openhands.sdk.tool import (
    ToolAnnotations,
    ToolDefinition,
    ToolExecutor,
    Tool,
    register_tool,
)
from openhands.tools.file_editor import FileEditorTool

from server.agent.visualizer import QueueVisualizer
from server.api.sse import SSEEvent
from server.core.llm_config import llm_config_manager
from server.core.workflow_compiler import normalize_trace_events

logger = logging.getLogger(__name__)

COMPILER_PROMPT_FILENAME = "system_prompt_compiler.j2"
DRAFT_FILENAME = "workflow_draft.md"
DEFAULT_EVENT_PAGE_SIZE = 15

TRACE_DIR = Path.home() / ".openbrowser" / "compiler_traces"
TRACE_MAX_STRING_LENGTH = 2000


# ---------------------------------------------------------------------------
#  TraceViewerTool
# ---------------------------------------------------------------------------


class TraceViewerAction(Action):
    """Navigate through recording trace events."""

    command: Literal[
        "summary",
        "events",
        "event_detail",
        "normalized_steps",
    ] = Field(description="The trace viewer command to execute.")
    start: int = Field(
        default=0,
        description="Start index for the 'events' command (0-based).",
    )
    count: int = Field(
        default=DEFAULT_EVENT_PAGE_SIZE,
        description="Number of events to return for the 'events' command.",
    )
    event_index: int = Field(
        default=0,
        description="Event index for the 'event_detail' command.",
    )

    @property
    def visualize(self) -> Text:
        content = Text()
        content.append(f"trace_viewer {self.command}", style="bold cyan")
        if self.command == "events":
            content.append(f" start={self.start} count={self.count}")
        elif self.command == "event_detail":
            content.append(f" event_index={self.event_index}")
        return content


class TraceViewerObservation(Observation):
    """Observation from browsing recording events."""

    success: bool = Field(default=True)
    text_result: str = Field(default="")
    image_urls: list[str] = Field(default_factory=list)

    @property
    def visualize(self) -> Text:
        return Text(self.text_result)

    @property
    def to_llm_content(self) -> Sequence[TextContent | ImageContent]:
        items: list[TextContent | ImageContent] = []
        for url in self.image_urls:
            items.append(ImageContent(image_urls=[url]))
        items.append(TextContent(text=self.text_result))
        return items


class TraceViewerExecutor(ToolExecutor[TraceViewerAction, TraceViewerObservation]):
    """Executor that serves recording trace data to the compiler agent."""

    def __init__(
        self,
        events: list[dict[str, Any]],
        normalized_steps: list[dict[str, Any]],
        intent_note: str | None,
        recording_name: str | None,
    ) -> None:
        self.events = events
        self.normalized_steps = normalized_steps
        self.intent_note = intent_note
        self.recording_name = recording_name
        self._events_by_index: dict[int, dict[str, Any]] = {
            e.get("event_index", i): e for i, e in enumerate(events)
        }

    def __call__(
        self, action: TraceViewerAction, conversation: Any = None
    ) -> TraceViewerObservation:
        if action.command == "summary":
            return self._handle_summary()
        if action.command == "events":
            return self._handle_events(action.start, action.count)
        if action.command == "event_detail":
            return self._handle_event_detail(action.event_index)
        if action.command == "normalized_steps":
            return self._handle_normalized_steps()
        return TraceViewerObservation(
            success=False, text_result=f"Unknown command: {action.command}"
        )

    def _handle_summary(self) -> TraceViewerObservation:
        type_counts: dict[str, int] = {}
        pages: set[str] = set()
        keyframe_count = 0

        for event in self.events:
            event_type = event.get("event_type", "unknown")
            type_counts[event_type] = type_counts.get(event_type, 0) + 1
            event_data = event.get("event_data") or {}
            page = event_data.get("page") or event_data.get("tab") or {}
            url = page.get("url")
            if isinstance(url, str) and url:
                pages.add(url)
            kf = event_data.get("keyframe")
            if isinstance(kf, dict) and kf.get("imageData"):
                keyframe_count += 1

        lines: list[str] = []
        lines.append(f"Total events: {len(self.events)}")
        lines.append(f"Normalized steps: {len(self.normalized_steps)}")
        lines.append(f"Keyframes available: {keyframe_count}")
        if self.intent_note:
            lines.append(f"User intent note: {self.intent_note}")
        if self.recording_name:
            lines.append(f"Recording name: {self.recording_name}")
        lines.append("")
        lines.append("Event type counts:")
        for event_type, count in sorted(type_counts.items()):
            lines.append(f"  {event_type}: {count}")
        lines.append("")
        lines.append(f"Pages visited ({len(pages)}):")
        for url in sorted(pages):
            lines.append(f"  {url[:150]}")
        lines.append("")
        lines.append(
            f"Use 'events' command with start/count to browse events "
            f"(0 to {len(self.events) - 1})."
        )

        return TraceViewerObservation(success=True, text_result="\n".join(lines))

    def _handle_events(self, start: int, count: int) -> TraceViewerObservation:
        start = max(0, start)
        count = min(count, 50)
        end = min(start + count, len(self.events))
        page_events = self.events[start:end]

        lines: list[str] = []
        lines.append(f"Events {start} to {end - 1} (of {len(self.events)} total):")
        lines.append("")

        for event in page_events:
            event_type = event.get("event_type", "?")
            event_index = event.get("event_index", "?")
            event_data = event.get("event_data") or {}

            page = event_data.get("page") or event_data.get("tab") or {}
            url = page.get("url", "")
            title = page.get("title", "")

            element = event_data.get("element") or {}
            tag = element.get("tagName", "")
            text = (element.get("text") or "")[:80]
            selector = (element.get("selector") or "")[:80]
            aria = element.get("ariaLabel") or ""
            html = element.get("html") or ""
            has_keyframe = bool(
                isinstance(event_data.get("keyframe"), dict)
                and event_data["keyframe"].get("imageData")
            )
            has_keyframe_after = bool(
                isinstance(event_data.get("keyframeAfter"), dict)
                and event_data["keyframeAfter"].get("imageData")
            )

            parts = [f"[{event_index}] {event_type}"]
            if url:
                parts.append(f"page={url[:120]}")
            if title:
                parts.append(f"title={title[:80]}")

            # For drag_and_drop events, show source and target elements
            if event_type == "drag_and_drop":
                source_el = event_data.get("sourceElement") or {}
                target_el = event_data.get("targetElement") or {}
                src_text = (source_el.get("text") or "")[:60]
                src_sel = (source_el.get("selector") or "")[:60]
                tgt_text = (target_el.get("text") or "")[:60]
                tgt_sel = (target_el.get("selector") or "")[:60]
                if src_text:
                    parts.append(f'source="{src_text}"')
                elif src_sel:
                    parts.append(f"source_sel={src_sel}")
                if tgt_text:
                    parts.append(f'target="{tgt_text}"')
                elif tgt_sel:
                    parts.append(f"target_sel={tgt_sel}")
                src_html = source_el.get("html") or ""
                if src_html:
                    peek = src_html[:120]
                    if len(src_html) > 120:
                        peek += "…"
                    parts.append(f"source_html={peek}")
                tgt_html = target_el.get("html") or ""
                if tgt_html:
                    peek = tgt_html[:120]
                    if len(tgt_html) > 120:
                        peek += "…"
                    parts.append(f"target_html={peek}")
            elif event_type == "set_slider":
                if tag:
                    parts.append(f"tag={tag}")
                if text:
                    parts.append(f'text="{text}"')
                if selector:
                    parts.append(f"sel={selector}")
                slider_value = event_data.get("value")
                if slider_value is not None:
                    parts.append(f"value={slider_value}")
                slider_min = event_data.get("min")
                slider_max = event_data.get("max")
                if slider_min is not None:
                    parts.append(f"min={slider_min}")
                if slider_max is not None:
                    parts.append(f"max={slider_max}")
                if html:
                    html_peek = html[:140]
                    if len(html) > 140:
                        html_peek += "…"
                    parts.append(f"html={html_peek}")
            else:
                if tag:
                    parts.append(f"tag={tag}")
                if text:
                    parts.append(f'text="{text}"')
                if selector:
                    parts.append(f"sel={selector}")
                if aria:
                    parts.append(f"aria={aria[:60]}")
                if html:
                    # Show the opening tag + attributes so the agent can spot
                    # native controls (<select>, <input type=checkbox>, <a href>)
                    # without expanding to event_detail. Full HTML is available
                    # via the event_detail command.
                    html_peek = html[:140]
                    if len(html) > 140:
                        html_peek += "…"
                    parts.append(f"html={html_peek}")

            if has_keyframe:
                parts.append("[has keyframe]")
            if has_keyframe_after:
                parts.append("[has after]")

            value = element.get("value")
            if isinstance(value, str) and value and event_type != "set_slider":
                parts.append(f'value="{value[:80]}"')

            selected_text = element.get("selectedText")
            if isinstance(selected_text, str) and selected_text:
                parts.append(f'selectedText="{selected_text[:80]}"')

            lines.append(" | ".join(parts))

        if end < len(self.events):
            lines.append("")
            lines.append(
                f"More events available. Use start={end} to see the next page."
            )

        return TraceViewerObservation(success=True, text_result="\n".join(lines))

    def _handle_event_detail(self, event_index: int) -> TraceViewerObservation:
        event = self._events_by_index.get(event_index)
        if event is None:
            return TraceViewerObservation(
                success=False,
                text_result=f"Event index {event_index} not found. "
                f"Valid range: 0 to {len(self.events) - 1}.",
            )

        detail = json.loads(json.dumps(event))
        event_data = detail.get("event_data") or {}

        # Strip imageData from the JSON payload (it would explode the text size)
        # and instead surface the keyframes as inline images in the observation.
        image_urls: list[str] = []
        image_captions: list[str] = []
        for slot, label in (("keyframe", "before"), ("keyframeAfter", "after")):
            kf = event_data.get(slot)
            if not (isinstance(kf, dict) and kf.get("imageData")):
                continue
            image_data = kf["imageData"]
            kf["imageData"] = (
                f"[{label}-keyframe attached as image #{len(image_urls) + 1}]"
            )
            url = (
                image_data
                if image_data.startswith("data:")
                else f"data:image/png;base64,{image_data}"
            )
            image_urls.append(url)
            caption = f"Image #{len(image_urls)} ({label})"
            annotation = kf.get("annotationMessage")
            if annotation:
                caption += f": {annotation}"
            image_captions.append(caption)

        formatted = json.dumps(detail, indent=2, ensure_ascii=False)
        if image_captions:
            formatted = (
                "Attached keyframes:\n  "
                + "\n  ".join(image_captions)
                + "\n\n"
                + formatted
            )
        return TraceViewerObservation(
            success=True,
            text_result=formatted,
            image_urls=image_urls,
        )

    def _handle_normalized_steps(self) -> TraceViewerObservation:
        lines: list[str] = []
        lines.append(f"Normalized steps ({len(self.normalized_steps)}):")
        lines.append("")

        for step in self.normalized_steps:
            step_id = step.get("id", "?")
            step_type = step.get("type", "?")
            desc = step.get("description", "")
            source = step.get("source_event_indexes", [])
            lines.append(f"{step_id} [{step_type}] {desc}  (events: {source})")

        return TraceViewerObservation(success=True, text_result="\n".join(lines))


TRACE_VIEWER_TOOL_NAME = "trace_viewer"


class TraceViewerTool(ToolDefinition[TraceViewerAction, TraceViewerObservation]):
    name = TRACE_VIEWER_TOOL_NAME

    @classmethod
    def create(cls, conv_state=None, **params: Any) -> Sequence["TraceViewerTool"]:
        events = params.get("events", [])
        normalized_steps = params.get("normalized_steps", [])
        intent_note = params.get("intent_note")
        recording_name = params.get("recording_name")

        return [
            cls(
                description=(
                    "Browse the recorded browser trace. Use commands: "
                    "summary, events (with start/count), event_detail "
                    "(with event_index), normalized_steps. "
                    "event_detail returns the full event JSON plus any "
                    "attached keyframes inline: a before-keyframe (page "
                    "state immediately before the action) and, when the "
                    "event is listed with [has after], an after-keyframe "
                    "(page state immediately after the action)."
                ),
                action_type=TraceViewerAction,
                observation_type=TraceViewerObservation,
                executor=TraceViewerExecutor(
                    events=events,
                    normalized_steps=normalized_steps,
                    intent_note=intent_note,
                    recording_name=recording_name,
                ),
                annotations=ToolAnnotations(
                    title="Trace Viewer",
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=True,
                    openWorldHint=False,
                ),
            )
        ]


register_tool(TRACE_VIEWER_TOOL_NAME, TraceViewerTool.create)


# ---------------------------------------------------------------------------
#  AskUserTool — lets the compiler agent ask clarification questions
# ---------------------------------------------------------------------------

ASK_USER_TOOL_NAME = "ask_user"


class AskUserAction(Action):
    """Ask the user a clarification question about the recording."""

    question: str = Field(
        description=(
            "The question to ask the user. Be specific about what is "
            "ambiguous in the recording trace and what you need to know "
            "to produce an accurate Browser Routine."
        )
    )

    @property
    def visualize(self) -> Text:
        content = Text()
        content.append("ask_user:\n", style="bold yellow")
        content.append(self.question)
        return content


class AskUserObservation(Observation):
    """Observation after an ask_user request is emitted."""

    question: str = Field(description="The question shown to the user.")

    @property
    def visualize(self) -> Text:
        return Text("Waiting for user's answer")

    @property
    def to_llm_content(self) -> Sequence[TextContent]:
        return [TextContent(text="Waiting for user's answer")]


class AskUserExecutor(ToolExecutor[AskUserAction, AskUserObservation]):
    """Pauses compilation so the user can answer a clarification question."""

    def __call__(
        self, action: AskUserAction, conversation: Any = None
    ) -> AskUserObservation:
        if conversation is not None:
            conversation.state.execution_status = ConversationExecutionStatus.FINISHED

        return AskUserObservation(
            question=action.question,
        )


class AskUserTool(ToolDefinition[AskUserAction, AskUserObservation]):
    name = ASK_USER_TOOL_NAME

    @classmethod
    def create(cls, conv_state=None, **params: Any) -> Sequence["AskUserTool"]:
        return [
            cls(
                description=(
                    "Ask the user a clarification question when the recording "
                    "trace is ambiguous. For example, if it's unclear which "
                    "option was selected, whether a step was intentional, or "
                    "what value should be used in a repeated workflow. The "
                    "compilation will pause until the user answers."
                ),
                action_type=AskUserAction,
                observation_type=AskUserObservation,
                executor=AskUserExecutor(),
                annotations=ToolAnnotations(
                    title="Ask User",
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=False,
                    openWorldHint=False,
                ),
            )
        ]


register_tool(ASK_USER_TOOL_NAME, AskUserTool.create)


# ---------------------------------------------------------------------------
#  SubmitWorkflowTool — validates the Routine file and ends the conversation
# ---------------------------------------------------------------------------

# Routine required sections
ROUTINE_REQUIRED_TITLE_PREFIX = "# Workflow:"
ROUTINE_REQUIRED_PREREQUISITES = "## Prerequisites"
ROUTINE_STEP_PATTERN = re.compile(r"^## Step \d+:", re.MULTILINE)
ROUTINE_KEYWORDS_LINE_PREFIX = "**Keywords:**"


class SubmitWorkflowAction(Action):
    """Submit the Browser Routine file for validation."""

    file_path: str = Field(
        description="Path to the Browser Routine Markdown file to validate and submit."
    )

    @property
    def visualize(self) -> Text:
        content = Text()
        content.append("submit_workflow ", style="bold green")
        content.append(self.file_path)
        return content


class SubmitWorkflowObservation(Observation):
    """Result of Browser Routine validation."""

    success: bool = Field(default=True)
    message: str = Field(default="")
    problems: list[str] = Field(default_factory=list)

    @property
    def visualize(self) -> Text:
        if self.success:
            return Text(self.message, style="green")
        return Text(f"Validation failed: {'; '.join(self.problems)}", style="red")

    @property
    def to_llm_content(self) -> Sequence[TextContent]:
        if self.success:
            return [TextContent(text=self.message)]
        text = "Browser Routine validation failed. Fix these problems and resubmit:\n\n"
        for i, problem in enumerate(self.problems, 1):
            text += f"{i}. {problem}\n"
        return [TextContent(text=text)]


class SubmitWorkflowExecutor(
    ToolExecutor[SubmitWorkflowAction, SubmitWorkflowObservation]
):
    """Validates the Routine file has the required structure."""

    def __init__(self) -> None:
        self.submitted_routine: dict[str, Any] | None = None

    def __call__(
        self, action: SubmitWorkflowAction, conversation: Any = None
    ) -> SubmitWorkflowObservation:
        # Read the file
        try:
            content = Path(action.file_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return SubmitWorkflowObservation(
                success=False,
                message="File not found.",
                problems=[f"File does not exist: {action.file_path}"],
            )
        except Exception as exc:
            return SubmitWorkflowObservation(
                success=False,
                message=str(exc),
                problems=[f"Cannot read file: {exc}"],
            )

        problems, summary = validate_routine_markdown(content)
        if problems or summary is None:
            return SubmitWorkflowObservation(
                success=False,
                message="Validation failed.",
                problems=problems,
            )

        self.submitted_routine = {
            "routine_markdown": content,
            "goal": summary["goal"],
            "step_count": summary["step_count"],
        }

        # NOTE: do NOT mark the conversation as FINISHED here. The agent should
        # get one more turn to send a plain-language wrap-up message to the
        # user. The conversation goes idle on its own once the LLM responds
        # with text and no further tool calls. The user can then either
        # finalize the Routine or send revision feedback.

        return SubmitWorkflowObservation(
            success=True,
            message=(
                "Browser Routine validated and submitted successfully. "
                "Now send ONE short plain-language message to the user "
                "summarizing what the Routine does, calling out any "
                "assumptions you made, and inviting corrections. Do NOT "
                "call any more tools — just send the message and stop."
            ),
        )


def validate_routine_markdown(content: str) -> tuple[list[str], dict[str, Any] | None]:
    """Validate the structure of a Browser Routine markdown document.

    Returns a tuple ``(problems, summary)``:
    - ``problems`` is a list of human-readable issues. Empty if the Routine
      passes.
    - ``summary`` is a dict with ``goal`` and ``step_count`` if validation
      passed; ``None`` otherwise.

    Used by both ``SubmitWorkflowExecutor`` (compile-time validation) and the
    routines API (validating user edits).
    """
    if not isinstance(content, str) or not content.strip():
        return (["Routine markdown is empty."], None)

    problems: list[str] = []

    if not any(line.strip().startswith("# Workflow:") for line in content.split("\n")):
        problems.append(
            "Missing '# Workflow: ...' title. The first heading must start with '# Workflow:'."
        )

    if ROUTINE_REQUIRED_PREREQUISITES not in content:
        problems.append(
            "Missing '## Prerequisites' section. Include at least a Starting URL."
        )

    steps = ROUTINE_STEP_PATTERN.findall(content)
    if not steps:
        problems.append(
            "No '## Step N: ...' sections found. The Routine must have at least one step."
        )

    step_sections = ROUTINE_STEP_PATTERN.split(content)
    for i, section_body in enumerate(step_sections[1:], 1):
        next_heading = section_body.find("\n## ")
        body = section_body[:next_heading] if next_heading >= 0 else section_body
        stripped = body.strip()
        body_lines = stripped.split("\n")
        instruction_lines = [
            line
            for line in body_lines
            if line.strip()
            and not line.strip().startswith("**Reasoning:")
            and not line.strip().startswith(ROUTINE_KEYWORDS_LINE_PREFIX)
        ]
        if not instruction_lines:
            problems.append(f"Step {i} has no instruction text.")

        # Optional '**Keywords:** <token>' line. Missing is always fine.
        # When present, require exactly one per step and a single bare token
        # (no quotes, no whitespace, no commas).
        keywords_lines = [
            line
            for line in body_lines
            if line.strip().startswith(ROUTINE_KEYWORDS_LINE_PREFIX)
        ]
        if len(keywords_lines) > 1:
            problems.append(
                f"Step {i} has multiple '**Keywords:**' lines. "
                "Only one bare token per step is allowed."
            )
        elif len(keywords_lines) == 1:
            token = (
                keywords_lines[0].strip()[len(ROUTINE_KEYWORDS_LINE_PREFIX) :].strip()
            )
            if not token:
                problems.append(
                    f"Step {i} has an empty '**Keywords:**' line. "
                    "Remove it or provide a single bare token."
                )
            elif any(ch.isspace() for ch in token) or any(
                ch in token for ch in (",", '"', "'", "`")
            ):
                problems.append(
                    f"Step {i} '**Keywords:**' value must be a single bare "
                    "token without quotes, spaces, or commas. "
                    f"Got: {token!r}"
                )

    if problems:
        return (problems, None)

    goal = ""
    for line in content.split("\n"):
        if line.strip().startswith("# Workflow:"):
            goal = line.strip()[len("# Workflow:") :].strip()
            break

    return ([], {"goal": goal, "step_count": len(steps)})


SUBMIT_WORKFLOW_TOOL_NAME = "submit_workflow"

SUBMIT_WORKFLOW_DESCRIPTION = """\
Validate and submit the Browser Routine file. Pass the file path of the \
Markdown Routine you wrote with the file tool.

The Routine file MUST have this structure:

- A `# Workflow: ...` title (one sentence describing the user's goal)
- A `## Prerequisites` section with at least a Starting URL
- One or more `## Step N: ...` sections, each with instruction text

Writing principles:

- Each step is a plain-language instruction OpenBrowser will follow at \
runtime. Describe target elements the way a human would point them out \
— by visible label (quote literal text when you can verify it from \
`element.text`/`element.html`), surrounding context, or position. \
Never paste CSS selectors, XPaths, or element IDs into a step.
- Choose the action that matches the element's real control type, not \
the literal trace event. The trace records what the user's mouse did; \
your job is to translate that into what OpenBrowser should do. When \
in doubt, use `event_detail` to read the element's HTML before \
deciding.
- For native `<select>` dropdowns, the runtime matches options by the \
HTML `value` attribute, not the visible label. Recorded `change` \
events carry both `value` (literal `option.value`) and `selectedText` \
(human label) — instruct OpenBrowser to use the `value`, with the \
`selectedText` shown parenthetically as a human cue (e.g. `select the \
option \\`largeover\\` (\"+Large (over $10bln)\") from the Market Cap \
dropdown`). Naming only the visible label will make the runtime fail.
- Merge low-level trace events into meaningful, high-level steps. \
One user intent (e.g. "set the date filter to last 7 days") usually \
spans multiple raw events — collapse them into a single step.
- Include a `**Reasoning:**` block under a step only when the purpose \
is not obvious from the instruction itself. Don't pad every step with \
reasoning.
- Skip incidental events that don't change state (accidental clicks, \
hover-only events, redundant tab switches the user immediately undid).
- **Add a `**Keywords:** <token>` line whenever the target's recorded \
`element.html` exposes a clean, stable identifier** — a test-hook \
attribute (`data-testid` / `data-test` / `data-test-id` / `data-cy` / \
`data-qa`), a semantic `data-*` value, a human-written `id` or \
`name`, a distinctive word from a short `aria-label`, a non-hashed \
semantic class token, or a distinctive word from the element's own \
visible text. One bare token per step — no quotes, no spaces, no \
commas. Reject auto-generated tokens (`css-x4j8b27`, `sc-bdfBQB`, \
`ember-87`, `react-aria-12345`, `Mui…`, random-suffix names) and \
overly generic words (`btn`, `submit`, `link`, `wrapper`). Skip the \
line only when the target is a per-row item inside a dynamic list \
whose contents rotate. **If you cannot find a clean candidate, OMIT \
the entire line — never emit `**Keywords:**` with no token after \
it.** See the system prompt's **Keywords** section for the full \
priority list.

If validation fails, fix the listed problems and resubmit.\
"""


class SubmitWorkflowTool(
    ToolDefinition[SubmitWorkflowAction, SubmitWorkflowObservation]
):
    name = SUBMIT_WORKFLOW_TOOL_NAME

    @classmethod
    def create(cls, conv_state=None, **params: Any) -> Sequence["SubmitWorkflowTool"]:
        executor = params.get("executor")
        if executor is None:
            executor = SubmitWorkflowExecutor()

        return [
            cls(
                description=SUBMIT_WORKFLOW_DESCRIPTION,
                action_type=SubmitWorkflowAction,
                observation_type=SubmitWorkflowObservation,
                executor=executor,
                annotations=ToolAnnotations(
                    title="Submit Workflow",
                    readOnlyHint=True,
                    destructiveHint=False,
                    idempotentHint=True,
                    openWorldHint=False,
                ),
            )
        ]


register_tool(SUBMIT_WORKFLOW_TOOL_NAME, SubmitWorkflowTool.create)


# ---------------------------------------------------------------------------
#  Compiler session store — keeps Conversation alive between requests
# ---------------------------------------------------------------------------


@dataclass
class CompilerSession:
    """In-memory state for an active compiler conversation."""

    recording_id: str
    conversation: Conversation
    draft_path: str
    workspace_dir: str
    model: str
    trace_path: str | None = None


# Active compiler sessions keyed by recording_id
_compiler_sessions: dict[str, CompilerSession] = {}


def has_compiler_session(recording_id: str) -> bool:
    """Check whether an active compiler session exists for a recording."""
    return recording_id in _compiler_sessions


def close_compiler_session(recording_id: str) -> bool:
    """Tear down any active compiler session for this recording.

    Safe to call whether or not a session exists. Returns True when a
    session was actually popped (useful for logging), False otherwise.
    Used by the delete-recording route so stray compiler state does not
    outlive its recording.
    """
    session = _compiler_sessions.pop(recording_id, None)
    if session is None:
        return False
    try:
        session.conversation.close()
    except Exception:
        pass
    return True


def _truncate_long_strings(value: Any) -> Any:
    """Recursively truncate base64 / very long strings in a JSON-able structure."""
    if isinstance(value, str):
        if len(value) > TRACE_MAX_STRING_LENGTH:
            return f"{value[:TRACE_MAX_STRING_LENGTH]}…[truncated {len(value) - TRACE_MAX_STRING_LENGTH} chars]"
        return value
    if isinstance(value, dict):
        return {k: _truncate_long_strings(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_truncate_long_strings(v) for v in value]
    return value


def _dump_trace(
    session: CompilerSession,
    error: str | None = None,
) -> str | None:
    """Write the conversation event log to session.trace_path. Returns the path."""
    if not session.trace_path:
        return None
    try:
        events_payload: list[Any] = []
        for evt in session.conversation.state.events:
            try:
                dumped = evt.model_dump(mode="json")
            except Exception:
                dumped = {"_repr": repr(evt), "_type": type(evt).__name__}
            events_payload.append(_truncate_long_strings(dumped))

        trace_doc = {
            "recording_id": session.recording_id,
            "model": session.model,
            "draft_path": session.draft_path,
            "workspace_dir": session.workspace_dir,
            "dumped_at": datetime.now().isoformat(),
            "error": error,
            "event_count": len(events_payload),
            "events": events_payload,
        }
        Path(session.trace_path).parent.mkdir(parents=True, exist_ok=True)
        Path(session.trace_path).write_text(
            json.dumps(trace_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return session.trace_path
    except Exception as exc:
        logger.warning("Failed to dump compiler trace: %s", exc)
        return None


def _get_pending_question(events: Sequence[Event]) -> str | None:
    """Return the pending ask_user question, or None if resolved."""
    for event in reversed(events):
        if isinstance(event, MessageEvent) and event.source == "user":
            return None
        if (
            isinstance(event, ActionEvent)
            and event.source == "agent"
            and event.tool_name == ASK_USER_TOOL_NAME
        ):
            action = event.action
            question = getattr(action, "question", None)
            if isinstance(question, str) and question.strip():
                return question
    return None


def _extract_message_text(event: MessageEvent) -> str:
    """Pull plain text out of a MessageEvent's llm_message content."""
    parts: list[str] = []
    content = getattr(getattr(event, "llm_message", None), "content", None) or []
    for chunk in content:
        text = getattr(chunk, "text", None)
        if isinstance(text, str) and text.strip():
            parts.append(text)
    return "\n".join(parts).strip()


def _detect_review_state(
    events: Sequence[Event],
) -> tuple[bool, str | None]:
    """Detect post-submit review state.

    Walks events from newest to oldest. Returns:
    - (True, summary_message) if the latest submit_workflow call succeeded
      (summary_message is the most recent agent text after that submit, or
      None if the agent didn't send a wrap-up).
    - (False, None) otherwise.
    """
    summary_message: str | None = None
    for event in reversed(events):
        # Most recent agent text message (above the latest submit) is the wrap-up.
        if (
            summary_message is None
            and isinstance(event, MessageEvent)
            and event.source == "agent"
        ):
            text = _extract_message_text(event)
            if text:
                summary_message = text
            continue

        # Stop at the latest submit_workflow ObservationEvent.
        if (
            isinstance(event, ObservationEvent)
            and event.tool_name == SUBMIT_WORKFLOW_TOOL_NAME
        ):
            obs = getattr(event, "observation", None)
            if obs is not None and getattr(obs, "success", False):
                return True, summary_message
            # Last submit failed → not in review state.
            return False, None

    return False, None


# ---------------------------------------------------------------------------
#  Public API
# ---------------------------------------------------------------------------


def _run_conversation_thread(
    session: CompilerSession,
    event_queue: queue.Queue,
    message: str | None = None,
) -> None:
    """Run conversation.run() in a background thread, emit complete event when done."""
    try:
        if message is not None:
            session.conversation.send_message(message)

        run_method = session.conversation.run
        if inspect.iscoroutinefunction(run_method):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(run_method())
            finally:
                pass
        else:
            run_method()

        # Build completion payload
        result = _collect_result(session)
        event_queue.put(
            SSEEvent(
                "complete",
                {
                    "recording_id": session.recording_id,
                    "result": result,
                },
            )
        )

    except Exception as exc:
        logger.error("Compiler agent thread error: %s", exc, exc_info=True)
        dumped_trace_path = _dump_trace(session, error=str(exc))
        event_queue.put(
            SSEEvent(
                "error",
                {
                    "recording_id": session.recording_id,
                    "error": str(exc),
                    "trace_path": dumped_trace_path,
                },
            )
        )


async def _stream_compiler_events(
    event_queue: queue.Queue,
    thread: threading.Thread,
    recording_id: str,
) -> AsyncGenerator[str, None]:
    """Yield SSE strings from the compiler event queue until complete/error."""
    timeout_seconds = 600.0
    last_event_time = time.time()

    while True:
        if not thread.is_alive() and event_queue.empty():
            break

        idle_time = time.time() - last_event_time
        if idle_time > timeout_seconds:
            logger.warning("Compiler SSE timeout for %s", recording_id)
            yield SSEEvent(
                "error",
                {
                    "recording_id": recording_id,
                    "error": "Timeout waiting for compiler agent",
                },
            ).to_sse_format()
            break

        loop = asyncio.get_event_loop()
        try:
            sse_event = await loop.run_in_executor(
                None,
                event_queue.get,
                True,
                10.0,
            )
            last_event_time = time.time()
        except queue.Empty:
            continue
        except Exception as exc:
            logger.error("Error reading compiler queue: %s", exc)
            yield SSEEvent(
                "error",
                {
                    "recording_id": recording_id,
                    "error": str(exc),
                },
            ).to_sse_format()
            break

        if not isinstance(sse_event, SSEEvent):
            continue

        yield sse_event.to_sse_format()

        if sse_event.event_type in ("complete", "error"):
            # Drain remaining events
            while True:
                try:
                    extra = event_queue.get_nowait()
                    if isinstance(extra, SSEEvent):
                        yield extra.to_sse_format()
                except queue.Empty:
                    break
            break

    # Wait for thread to finish
    await asyncio.get_event_loop().run_in_executor(None, thread.join, 5.0)


async def compile_with_agent(
    recording_id: str,
    events: list[dict[str, Any]],
    intent_note: str | None = None,
    recording_name: str | None = None,
    model_alias: str | None = None,
) -> AsyncGenerator[str, None]:
    """Start the Compiler Agent and yield SSE events as it works.

    Yields SSE strings. The final event is either:
    - "complete" with result.status == "asking" (agent has a question)
    - "complete" with result.status == "completed" (Routine is ready)
    - "error" on failure
    """
    # Discard any previous session for this recording
    old = _compiler_sessions.pop(recording_id, None)
    if old is not None:
        try:
            old.conversation.close()
        except Exception:
            pass

    if model_alias is None:
        llm_config = llm_config_manager.get_compiler_llm_config()
    else:
        llm_config = llm_config_manager.get_llm_config(model_alias)
    if not llm_config.api_key:
        raise ValueError("LLM API key is not configured")

    normalized_steps = normalize_trace_events(events)

    llm = LLM(
        usage_id="compiler-agent",
        model=llm_config.model,
        base_url=llm_config.base_url,
        api_key=SecretStr(llm_config.api_key),
    )

    workspace_dir = tempfile.mkdtemp(prefix="compiler_agent_")
    draft_path = str(Path(workspace_dir) / DRAFT_FILENAME)
    trace_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    trace_path = str(TRACE_DIR / f"{recording_id}_{trace_timestamp}.json")

    # Create visualizer with queue for SSE streaming
    event_queue: queue.Queue = queue.Queue()
    visualizer = QueueVisualizer(event_queue=event_queue)

    agent = Agent(
        llm=llm,
        tools=[
            Tool(
                name=TRACE_VIEWER_TOOL_NAME,
                params={
                    "events": events,
                    "normalized_steps": normalized_steps,
                    "intent_note": intent_note,
                    "recording_name": recording_name,
                },
            ),
            Tool(name=FileEditorTool.name),
            Tool(name=ASK_USER_TOOL_NAME),
            Tool(name=SUBMIT_WORKFLOW_TOOL_NAME),
        ],
        agent_context=AgentContext(
            system_message_suffix="",
        ),
        system_prompt_filename=COMPILER_PROMPT_FILENAME,
        # Keep every keyframe in context — compiler reasoning depends on
        # seeing all trace_viewer screenshots, not just the most recent.
        tool_image_window=None,
    )

    # Build the initial user message
    user_msg_parts: list[str] = [
        "Compile the recorded browser trace into an executable Browser Routine.",
        "",
        f"Write the Routine to: {draft_path}",
        "When the Routine is complete, call `submit_workflow` with that path.",
        "If the trace is ambiguous, call `ask_user` with your question.",
    ]
    if intent_note:
        user_msg_parts.append(f"\nUser intent note: {intent_note}")
    if recording_name:
        user_msg_parts.append(f"Recording name: {recording_name}")
    user_msg_parts.append(
        f"\nThe trace has {len(events)} events. Start by calling "
        f"`trace_viewer` with command `summary` to get an overview, "
        f"then browse events and keyframes as needed before writing "
        f"the Routine file."
    )

    conversation = Conversation(
        agent=agent,
        workspace=workspace_dir,
        # Bumped from 40: each user revision burns iterations on
        # file edits + submit + wrap-up, and the user may iterate
        # several times before approving the Routine.
        max_iteration_per_run=80,
        visualizer=visualizer,
    )

    session = CompilerSession(
        recording_id=recording_id,
        conversation=conversation,
        draft_path=draft_path,
        workspace_dir=workspace_dir,
        model=llm_config.model,
        trace_path=trace_path,
    )
    _compiler_sessions[recording_id] = session

    # Run conversation in background thread
    thread = threading.Thread(
        target=_run_conversation_thread,
        args=(session, event_queue, "\n".join(user_msg_parts)),
        daemon=True,
    )
    thread.start()

    async for sse_payload in _stream_compiler_events(event_queue, thread, recording_id):
        yield sse_payload


async def continue_compilation(
    recording_id: str,
    user_answer: str,
) -> AsyncGenerator[str, None]:
    """Continue a paused compilation with the user's answer.

    Yields SSE events as the compiler agent resumes.
    """
    session = _compiler_sessions.get(recording_id)
    if session is None:
        raise ValueError(
            f"No active compiler session for recording {recording_id}. "
            f"Call compile first."
        )

    # Re-attach a fresh event queue to the visualizer
    event_queue: queue.Queue = queue.Queue()
    vis = getattr(session.conversation, "_visualizer", None)
    if vis is not None and hasattr(vis, "set_event_queue"):
        vis.set_event_queue(event_queue)

    thread = threading.Thread(
        target=_run_conversation_thread,
        args=(session, event_queue, user_answer),
        daemon=True,
    )
    thread.start()

    async for sse_payload in _stream_compiler_events(event_queue, thread, recording_id):
        yield sse_payload


def _read_routine_from_session(session: CompilerSession) -> dict[str, Any]:
    """Read the Routine draft file and return goal/step_count metadata.

    Falls back to the last text event if the file doesn't exist.
    """
    try:
        file_content = Path(session.draft_path).read_text(encoding="utf-8")
        goal = ""
        for line in file_content.split("\n"):
            if line.strip().startswith("# Workflow:"):
                goal = line.strip()[len("# Workflow:") :].strip()
                break
        step_count = len(ROUTINE_STEP_PATTERN.findall(file_content))
        return {
            "routine_markdown": file_content,
            "goal": goal,
            "step_count": step_count,
        }
    except FileNotFoundError:
        last_text = ""
        for evt in reversed(list(session.conversation.state.events)):
            evt_content = getattr(evt, "content", None)
            if isinstance(evt_content, str) and evt_content.strip():
                last_text = evt_content.strip()
                break
        return {"routine_markdown": last_text, "goal": "", "step_count": 0}


def _get_last_agent_message(events: Sequence[Event]) -> str | None:
    """Return the most recent agent MessageEvent text, or None."""
    for event in reversed(events):
        if isinstance(event, MessageEvent) and event.source == "agent":
            text = _extract_message_text(event)
            if text:
                return text
    return None


def _collect_result(session: CompilerSession) -> dict[str, Any]:
    """Check conversation state and return the appropriate result.

    Possible outcomes:
    - "asking"    — ask_user is pending; keep session alive
    - "review"    — submit_workflow succeeded and the agent is waiting for
                    the user to approve or send revision feedback; keep
                    session alive
    - "stalled"   — the agent stopped without calling ask_user or
                    submit_workflow (e.g. it replied in free-form prose to a
                    vague user answer). Keep the session alive so the user
                    can send a follow-up via /compile/answer.
    """
    recording_id = session.recording_id

    # Snapshot the trace to disk regardless of outcome — overwrites the
    # per-run trace file each time so partial state is captured.
    dumped_trace_path = _dump_trace(session)

    events = session.conversation.state.events

    # 1. Pending ask_user question?
    question = _get_pending_question(events)
    if question is not None:
        _compiler_sessions[recording_id] = session
        return {
            "status": "asking",
            "question": question,
            "recording_id": recording_id,
            "model": session.model,
            "trace_path": dumped_trace_path,
        }

    # 2. Post-submit review?
    in_review, summary_message = _detect_review_state(events)
    if in_review:
        routine_doc = _read_routine_from_session(session)
        routine_doc.update(
            {
                "status": "review",
                "recording_id": recording_id,
                "model": session.model,
                "trace_path": dumped_trace_path,
                "summary_message": summary_message or "",
            }
        )
        # Keep session alive — user will either finalize or send revision.
        _compiler_sessions[recording_id] = session
        return routine_doc

    # 3. Agent stalled — no submit happened and no ask_user is pending, but
    # the conversation ran out of work. Treat this as a resumable state: the
    # agent most likely replied in prose to the previous user message instead
    # of calling ask_user. Keep the session alive and surface the agent's
    # last message so the frontend can prompt the user for a follow-up.
    stalled_message = _get_last_agent_message(events)
    _compiler_sessions[recording_id] = session
    return {
        "status": "stalled",
        "message": stalled_message or "",
        "recording_id": recording_id,
        "model": session.model,
        "trace_path": dumped_trace_path,
    }


def finalize_compiler_session(recording_id: str) -> dict[str, Any]:
    """Approve the Routine currently in review and tear down the session.

    Called when the user clicks "Looks right — finalize" in the UI. Refuses
    to finalize unless the compiler session has actually reached post-submit
    review state (i.e. ``submit_workflow`` succeeded). This is the guard that
    prevents a client from calling finalize while the agent is still in an
    ``asking`` state and persisting a half-formed draft.

    The final markdown is re-validated through ``validate_routine_markdown``
    before the session is torn down, so a broken draft cannot be saved as a
    routine — and a validation failure leaves the session alive so the user
    can send revision feedback via ``/compile/answer`` instead of being
    stranded.

    Returns the final Routine metadata with status "completed".
    """
    session = _compiler_sessions.get(recording_id)
    if session is None:
        raise ValueError(
            f"No active compiler session for recording {recording_id}. "
            f"Nothing to finalize."
        )

    # Guard 1: the session must be in post-submit review state. If the agent
    # is still asking a clarifying question (or hasn't submitted at all), the
    # draft is not a real routine yet and must not be persisted.
    in_review, _ = _detect_review_state(session.conversation.state.events)
    if not in_review:
        raise ValueError(
            f"Cannot finalize compiler session for {recording_id}: the "
            f"agent has not reached post-submit review state yet. Answer any "
            f"pending questions and let the agent call submit_workflow first."
        )

    # Guard 2: re-validate the draft markdown before committing. Keeps the
    # finalize path symmetric with the /routines create/update paths, which
    # both run validate_routine_markdown via _validate_or_raise.
    routine_doc = _read_routine_from_session(session)
    routine_markdown = (routine_doc.get("routine_markdown") or "").strip()
    problems, summary = validate_routine_markdown(routine_markdown)
    if problems or summary is None:
        joined = "; ".join(problems) if problems else "unknown validation error"
        raise ValueError(
            f"Cannot finalize compiler session for {recording_id}: routine "
            f"markdown failed validation. Problems: {joined}"
        )

    # Validation passed — safe to tear the session down and return a final
    # routine_doc. Use the validator's summary so goal/step_count are
    # consistent with what /routines would compute for the same markdown.
    dumped_trace_path = _dump_trace(session)
    routine_doc.update(
        {
            "status": "completed",
            "recording_id": recording_id,
            "model": session.model,
            "trace_path": dumped_trace_path,
            "goal": summary.get("goal", routine_doc.get("goal", "")),
            "step_count": summary.get("step_count", routine_doc.get("step_count", 0)),
        }
    )

    _compiler_sessions.pop(recording_id, None)
    try:
        session.conversation.close()
    except Exception:
        pass

    return routine_doc
