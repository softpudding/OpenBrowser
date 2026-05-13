"""
Base classes for OpenBrowser tool actions and observations.

This module provides the foundation classes that all OpenBrowser tool types
will inherit from, following the OpenHands SDK pattern.
"""

from collections.abc import Sequence
from typing import Any, Dict, List, Optional

from openhands.sdk import Action, ImageContent, Observation, TextContent
from openhands.sdk.utils.visualize import display_dict
from pydantic import Field
from pydantic.json_schema import SkipJsonSchema
from rich.text import Text


def _format_display_id(el: Dict[str, Any]) -> str:
    """Return the `id(type[, hint...])` display string for one highlighted element."""
    el_id = el.get("id", "unknown")
    el_type = el.get("type")
    raw_hints = el.get("interactionHints") or el.get("interaction_hints") or []
    hints = [h for h in raw_hints if isinstance(h, str) and h and h != el_type]
    suffix_parts: List[str] = []
    if isinstance(el_type, str) and el_type:
        suffix_parts.append(el_type)
    suffix_parts.extend(hints)
    if suffix_parts:
        return f"{el_id}({', '.join(suffix_parts)})"
    return str(el_id)


def _clean(value: Any, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = " ".join(value.split())
    if not stripped:
        return None
    if len(stripped) <= limit:
        return stripped
    return stripped[: max(1, limit - 1)] + "…"


# Default cap on rendered <option>s per <select> in the mixed inventory.
# Passes through all options when the caller explicitly requested
# element_type="selectable", so the agent can still see the full option set
# by narrowing the highlight.
SELECT_OPTIONS_DEFAULT_CAP = 20


def _format_highlighted_element_lines(
    display_id: str,
    el: Dict[str, Any],
    element_type: Optional[str] = None,
) -> List[str]:
    """Render one highlighted element as one header line plus option lines.

    Reads the element's structured ``descriptor`` (populated by the extension
    from the live DOM). For ``<select>`` elements, options are capped at
    ``SELECT_OPTIONS_DEFAULT_CAP`` unless the caller requested
    ``element_type="selectable"``, in which case every ``<option>`` is
    emitted so the agent can pick a value before calling the ``select``
    action.
    """
    descriptor = el.get("descriptor") or {}
    tag = descriptor.get("tag") or (el.get("tagName") or "").lower() or "unknown"
    role = descriptor.get("role")

    # Descriptor.text is the primary source; fall back to the element-level
    # text field in case a legacy producer skipped the descriptor.
    text = _clean(descriptor.get("text"), 120) or _clean(el.get("text"), 120)
    name = _clean(descriptor.get("name"), 120)
    if name and name == text:
        name = None

    opening = f"<{tag} role={role}>" if role else f"<{tag}>"
    segments: List[str] = [opening]
    if text:
        segments.append(f'"{text}"')

    attrs: List[str] = []
    input_type = descriptor.get("inputType")
    if isinstance(input_type, str) and input_type and tag in ("input", "button"):
        attrs.append(f"type={input_type}")
    if name:
        attrs.append(f'name="{name}"')
    placeholder = _clean(descriptor.get("placeholder"), 80)
    if placeholder:
        attrs.append(f'placeholder="{placeholder}"')
    value = _clean(descriptor.get("value"), 120)
    if value:
        attrs.append(f'value="{value}"')
    href = _clean(descriptor.get("href"), 120)
    if href:
        attrs.append(f'href="{href}"')
    if not text and not name:
        context = _clean(descriptor.get("context"), 120)
        if context:
            attrs.append(f'context="{context}"')
        class_hint = descriptor.get("classHint")
        if isinstance(class_hint, list) and class_hint:
            tokens = [
                token
                for token in (
                    _clean(item, 40) for item in class_hint if isinstance(item, str)
                )
                if token
            ]
            if tokens:
                attrs.append(f'class="{" ".join(tokens[:3])}"')
        icon_hint = _clean(descriptor.get("icon"), 40)
        if icon_hint:
            attrs.append(f"icon={icon_hint}")
    if attrs:
        segments.append("· " + " · ".join(attrs))

    flags: List[str] = []
    if descriptor.get("disabled"):
        flags.append("disabled")
    if descriptor.get("checked"):
        flags.append("checked")
    expanded = descriptor.get("expanded")
    if expanded is True:
        flags.append("expanded=true")
    elif expanded is False:
        flags.append("expanded=false")
    if descriptor.get("selected"):
        flags.append("selected")
    if descriptor.get("multiple"):
        flags.append("multiple")
    if flags:
        segments.append(" ".join(flags))

    header = f"{display_id}: " + " ".join(segments)
    lines: List[str] = [header]

    options = descriptor.get("options")
    if tag == "select" and isinstance(options, list) and options:
        lines.append("  options:")
        show_all = element_type == "selectable"
        visible = options if show_all else options[:SELECT_OPTIONS_DEFAULT_CAP]
        # Always render the currently-selected option, even if it falls
        # outside the cap, so the agent can see the present value.
        if not show_all:
            visible_ids = {id(o) for o in visible}
            for opt in options[SELECT_OPTIONS_DEFAULT_CAP:]:
                if (
                    isinstance(opt, dict)
                    and opt.get("selected")
                    and id(opt) not in visible_ids
                ):
                    visible = list(visible) + [opt]
                    break
        for opt in visible:
            if not isinstance(opt, dict):
                continue
            opt_value = opt.get("value", "")
            opt_label = opt.get("label", "")
            opt_flags: List[str] = []
            if opt.get("selected"):
                opt_flags.append("selected")
            if opt.get("disabled"):
                opt_flags.append("disabled")
            flag_str = f" ({', '.join(opt_flags)})" if opt_flags else ""
            group = opt.get("group")
            prefix = f"[{group}] " if isinstance(group, str) and group else ""
            lines.append(f'    {prefix}"{opt_value}"="{opt_label}"{flag_str}')
        remaining = len(options) - SELECT_OPTIONS_DEFAULT_CAP
        if not show_all and remaining > 0:
            lines.append(
                f"    …{SELECT_OPTIONS_DEFAULT_CAP} shown, {remaining} more — "
                're-highlight with `element_type: "selectable"` to see all.'
            )

    return lines


class OpenBrowserAction(Action):
    """Base class for all OpenBrowser actions.

    This base class provides common fields needed by all browser automation
    actions, enabling proper type hierarchy and conversation isolation.
    """

    # NOTE: conversation_id is an internal routing field, NOT a tool parameter.
    # It must never be exposed to the LLM — the executor injects the real value
    # from the active conversation state. Wrapping it in SkipJsonSchema keeps it
    # out of the JSON schema generated for the LLM tool call so the model can't
    # be tempted to fill it (e.g. mistaking it for tab_id and sending garbage
    # that the Chrome extension server then rejects with HTTP 400).
    conversation_id: SkipJsonSchema[Optional[str]] = Field(
        default=None,
        description="Internal: conversation ID for session isolation. Set by the executor, never by the LLM.",
        exclude=True,
    )

    # `summary` is the self-annotation convention the agent emits on most
    # action calls ("Summary: <one-line why>"). The openhands-sdk surfaces
    # it as ActionEvent.summary, but the tool Action subclass must also
    # accept it — otherwise Schema(extra="forbid") rejects the whole call
    # and the agent wastes turns recovering. Hidden from the JSON schema
    # so the LLM doesn't see it as a parameter to fill.
    summary: SkipJsonSchema[Optional[str]] = Field(
        default=None,
        description="Internal: LLM self-annotation; accepted but ignored.",
        exclude=True,
    )

    @property
    def visualize(self) -> Text:
        """Render the action so only fields the agent actually set appear.

        The base `Action.visualize` calls `model_dump()` which serializes
        every field with its default — `text: null`, `key: null`,
        `start_coordinate: null`, `count: 1`, etc. These pollute the
        rendered ActionEvent text the SDK persists, condenses, and shows
        to humans / the compiler agent. Use `model_fields_set` (only the
        names the LLM emitted) plus `action` (always included so the verb
        is visible even when defaulted).
        """
        content = Text()
        content.append("Action: ", style="bold")
        content.append(self.__class__.__name__)
        content.append("\n\n")
        content.append("Arguments:", style="bold")
        include = set(self.model_fields_set)
        if "action" in self.__class__.model_fields:
            include.add("action")
        rendered = self.model_dump(include=include) if include else {}
        # `kind` is the discriminator the SDK adds — agent never sees or
        # sets it, so don't display it either.
        rendered.pop("kind", None)
        content.append(display_dict(rendered))
        return content


class OpenBrowserObservation(Observation):
    """Base observation returned by OpenBrowser tools after each action.

    This class contains the common fields shared by all OpenBrowser tool
    observations, providing a consistent interface for success/failure
    reporting, screenshots, and tab information.
    """

    success: bool = Field(description="Whether the operation succeeded")
    screenshot_data_url: Optional[str] = Field(
        default=None,
        description="Screenshot as data URL (base64 encoded PNG, 1280x720 pixels)",
    )
    message: Optional[str] = Field(default=None, description="Result message")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    tabs: List[Dict[str, Any]] = Field(
        default_factory=list, description="List of current tabs"
    )
    javascript_result: Optional[Any] = Field(
        default=None,
        description="Result of JavaScript execution (if action was javascript_execute)",
    )
    console_output: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Console output captured during JavaScript execution (list of {type, args, timestamp})",
    )
    # Dialog-related fields
    dialog_opened: Optional[bool] = Field(
        default=None, description="Whether a dialog is currently open"
    )
    dialog: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Dialog information if a dialog is open (type, message, needsDecision)",
    )
    dialog_auto_accepted: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Information about an auto-accepted alert dialog (type, message, url, timestamp)",
    )
    auto_accepted_dialogs: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="List of all auto-accepted dialogs (for cascading alerts)",
    )
    # Tab creation tracking
    new_tabs_created: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="List of new tabs created during operation (tabId, url, title, loading)",
    )
    # Visual interaction results
    highlighted_elements: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="List of elements highlighted on the screenshot"
    )
    page: Optional[int] = Field(
        default=None, description="Current page number for highlighted elements"
    )
    total_pages: Optional[int] = Field(
        default=None,
        description="Total number of pages available for highlighted elements",
    )
    total_elements: Optional[int] = Field(
        default=None, description="Total number of elements found"
    )
    element_id: Optional[str] = Field(
        default=None, description="ID of the element that was acted upon"
    )
    scroll_effective: Optional[bool] = Field(
        default=None,
        description="Whether the scroll position actually changed (None for non-scroll actions)",
    )
    scroll_warning: Optional[str] = Field(
        default=None, description="Warning message if scroll had no effect"
    )
    pending_confirmation: Optional[Dict[str, Any]] = Field(
        default=None, description="Pending confirmation information for 2PC flow"
    )
    element_type: Optional[str] = Field(
        default=None,
        description="Type of elements highlighted (clickable/scrollable/inputable/selectable/draggable/droppable)",
    )
    small_model: Optional[bool] = Field(
        default=None,
        description="Whether the active conversation uses the small-model profile.",
    )
    # Viewport dimensions in CSS pixels at the time of the most recent screenshot.
    # Surfaced to the model so it can self-correct if it ever drifts away from
    # the [0,1000] normalized convention or the captured viewport changes.
    viewport_width: Optional[int] = Field(
        default=None,
        description="CSS-pixel viewport width at screenshot time (None if unknown).",
    )
    viewport_height: Optional[int] = Field(
        default=None,
        description="CSS-pixel viewport height at screenshot time (None if unknown).",
    )

    def _pending_confirmation_llm_content(
        self,
    ) -> Sequence[TextContent | ImageContent]:
        """Render a minimal, image-first confirmation payload."""
        content_items: list[TextContent | ImageContent] = []

        if self.screenshot_data_url:
            content_items.append(ImageContent(image_urls=[self.screenshot_data_url]))

        pending = self.pending_confirmation or {}
        action_type = str(pending.get("action_type", "unknown"))
        element_id = str(pending.get("element_id", "unknown"))
        requested_element_id = pending.get("requested_element_id")
        resolution_note = pending.get("element_id_resolution_note")
        confirm_cmd = f'{{"action": "confirm_{action_type}"}}'

        text_parts = [
            "## Pending Confirmation",
            "",
            f"**Element ID**: {element_id}",
        ]
        if (
            isinstance(requested_element_id, str)
            and requested_element_id
            and requested_element_id != element_id
        ):
            text_parts.append(
                f"**Matched Requested ID**: {requested_element_id} -> {element_id}"
            )
        if isinstance(resolution_note, str) and resolution_note:
            text_parts.append(f"**Match Note**: {resolution_note}")
        text_parts.extend(
            [
                f"**Action Type**: {action_type}",
                "",
            ]
        )

        if action_type == "drag_and_drop":
            extra_data = pending.get("extra_data") or {}
            target_id = extra_data.get("target_element_id", "unknown")
            inner_elements = extra_data.get("inner_elements") or []
            text_parts.append(f"**Source**: {element_id}")
            text_parts.append(f"**Target Container**: {target_id}")
            text_parts.append("")
            if inner_elements:
                text_parts.append(f"**Inner Elements** ({len(inner_elements)}):")
                text_parts.append("")
                for el in inner_elements:
                    display_id = _format_display_id(el)
                    text_parts.extend(
                        _format_highlighted_element_lines(
                            display_id, el, element_type=self.element_type
                        )
                    )
                text_parts.append("")
            text_parts.append("**Drop at end of container:**")
            text_parts.append('```json\n{"action": "confirm_drag_and_drop"}\n```')
            text_parts.append("")
            text_parts.append("**Drop at a precise position:**")
            text_parts.append(
                '```json\n{"action": "confirm_drag_and_drop", "relative_to": "<inner_element_id>", "position": "before"}\n```'
            )
            content_items.append(TextContent(text="\n".join(text_parts)))
            return content_items

        if action_type == "select":
            extra_data = pending.get("extra_data") or {}
            chosen_value = extra_data.get("value")
            if chosen_value is not None:
                if isinstance(chosen_value, list):
                    rendered_value = ", ".join(f"'{v}'" for v in chosen_value)
                    text_parts.append(f"**Chosen Values**: [{rendered_value}]")
                else:
                    text_parts.append(f"**Chosen Value**: '{chosen_value}'")
                text_parts.append(
                    "Verify this `value` matches the `<option>` you intended in the HTML below before confirming."
                )
                text_parts.append("")

        full_html = str(pending.get("full_html", "")).strip()
        if full_html:
            if len(full_html) > 800:
                full_html = full_html[:800] + "\n... (truncated)"
            text_parts.append("**Secondary HTML Check**:")
            text_parts.append("```html")
            text_parts.append(full_html)
            text_parts.append("```")
            text_parts.append("")

        text_parts.append("**Confirm with:**")
        text_parts.append(f"```json\n{confirm_cmd}\n```")

        content_items.append(TextContent(text="\n".join(text_parts)))
        return content_items

    @property
    def to_llm_content(self) -> Sequence[TextContent | ImageContent]:
        import json

        if self.pending_confirmation:
            return self._pending_confirmation_llm_content()

        content_items = []
        text_parts = []

        # Operation Status Section
        text_parts.append("## Operation Status")
        text_parts.append("")
        # Viewport size is intentionally not surfaced to the agent — the
        # server denormalizes [0,1000] coords to real pixels automatically,
        # so the agent never needs to reason about page dimensions. The
        # cached vw/vh on the executor still drives that conversion.
        if not self.success:
            text_parts.append(f"**Status**: FAILED")
            if self.error:
                text_parts.append(f"**Error**: {self.error}")
            if self.message:
                text_parts.append(f"**Action**: {self.message}")
        else:
            text_parts.append(f"**Status**: SUCCESS")
            # For JavaScript operations, show minimal confirmation
            if self.javascript_result is not None and self.message:
                # Extract just "Executed JavaScript" without the script content
                if "Executed JavaScript:" in self.message:
                    text_parts.append(
                        "**Action**: JavaScript code executed successfully"
                    )
                else:
                    text_parts.append(f"**Action**: {self.message}")
            elif self.message:
                text_parts.append(f"**Action**: {self.message}")

        text_parts.append("")

        # JavaScript Result Section (if applicable)
        if self.javascript_result is not None:
            text_parts.append("## Execution Result")
            text_parts.append("")

            # Format result based on type
            if isinstance(self.javascript_result, (dict, list)):
                try:
                    # Pretty-print JSON with indentation
                    result_str = json.dumps(
                        self.javascript_result, indent=2, ensure_ascii=False
                    )
                    if len(result_str) > 50000:
                        result_str = result_str[:50000] + "\n... (output truncated)"
                    text_parts.append("```json")
                    text_parts.append(result_str)
                    text_parts.append("```")
                except (TypeError, ValueError):
                    # Fallback to string representation
                    result_str = str(self.javascript_result)
                    if len(result_str) > 50000:
                        result_str = result_str[:50000] + "... (truncated)"
                    text_parts.append("```")
                    text_parts.append(result_str)
                    text_parts.append("```")
            else:
                # For non-dict/list results (strings, numbers, etc.)
                result_str = str(self.javascript_result)
                if len(result_str) > 50000:
                    result_str = result_str[:50000] + "... (truncated)"
                text_parts.append("```")
                text_parts.append(result_str)
                text_parts.append("```")
            text_parts.append("")

        # Console Output Section (if applicable)
        if self.console_output and len(self.console_output) > 0:
            text_parts.append("## Console Output")
            text_parts.append("")

            for entry in self.console_output:
                console_type = entry.get("type", "log")
                args = entry.get("args", [])
                timestamp = entry.get("timestamp")

                # Format console type with emoji
                type_emoji = {
                    "log": "📝",
                    "warn": "⚠️",
                    "error": "❌",
                    "info": "ℹ️",
                    "debug": "🔍",
                    "table": "📊",
                    "trace": "🔍",
                    "dir": "📁",
                }.get(console_type, "📝")

                # Format arguments
                formatted_args = []
                for arg in args:
                    if arg is None:
                        formatted_args.append("undefined")
                    elif isinstance(arg, str):
                        formatted_args.append(arg)
                    elif isinstance(arg, (dict, list)):
                        try:
                            formatted_args.append(
                                json.dumps(arg, indent=2, ensure_ascii=False)
                            )
                        except:
                            formatted_args.append(str(arg))
                    else:
                        formatted_args.append(str(arg))

                # Join multiple arguments
                args_str = " ".join(formatted_args)
                if len(args_str) > 1000:
                    args_str = args_str[:1000] + "... (truncated)"

                # Add console line with type
                text_parts.append(f"{type_emoji} **[{console_type}]** {args_str}")

            text_parts.append("")

        # Dialog Section (if applicable)
        if self.dialog_opened and self.dialog:
            text_parts.append("## ⚠️ Dialog Opened")
            text_parts.append("")
            dialog_type = self.dialog.get("type", "unknown")
            dialog_message = self.dialog.get("message", "")
            needs_decision = self.dialog.get("needsDecision", False)

            text_parts.append(f"**Type**: {dialog_type}")
            text_parts.append(f'**Message**: "{dialog_message}"')
            text_parts.append(
                f"**Needs Decision**: {'Yes' if needs_decision else 'No'}"
            )
            text_parts.append("")

            if needs_decision:
                text_parts.append(
                    "**Action Required**: Use the `dialog` tool to respond."
                )
                text_parts.append(
                    '- To accept: use `dialog` with `{"dialog_action": "accept"}`'
                )
                text_parts.append(
                    '- To dismiss: use `dialog` with `{"dialog_action": "dismiss"}`'
                )
                text_parts.append(
                    '- For prompts: use `dialog` with `{"dialog_action": "accept", "prompt_text": "your text"}`'
                )
            else:
                text_parts.append(
                    "**Note**: This dialog was auto-accepted (no decision needed)."
                )
            text_parts.append("")

        # Auto-Accepted Dialogs Section (if any were auto-accepted)
        auto_accepted_dialogs_to_show = []
        if self.auto_accepted_dialogs:
            auto_accepted_dialogs_to_show = self.auto_accepted_dialogs
        elif self.dialog_auto_accepted:
            auto_accepted_dialogs_to_show = [self.dialog_auto_accepted]

        if auto_accepted_dialogs_to_show:
            text_parts.append("## ✅ Auto-Accepted Dialogs")
            text_parts.append("")
            text_parts.append(
                f"**Total Auto-Accepted**: {len(auto_accepted_dialogs_to_show)}"
            )
            text_parts.append("")

            for i, dialog in enumerate(auto_accepted_dialogs_to_show, 1):
                dialog_type = dialog.get("type", "alert")
                dialog_message = dialog.get("message", "")
                dialog_url = dialog.get("url", "")
                timestamp = dialog.get("timestamp", "")

                text_parts.append(f'{i}. **{dialog_type.upper()}**: "{dialog_message}"')
                if dialog_url:
                    text_parts.append(f"   URL: {dialog_url}")
                if timestamp:
                    from datetime import datetime

                    try:
                        dt = datetime.fromtimestamp(timestamp / 1000)
                        text_parts.append(f"   Time: {dt.strftime('%H:%M:%S')}")
                    except:
                        pass
                text_parts.append("")
            text_parts.append(
                "**Note**: Alert dialogs are auto-accepted by the system."
            )
            text_parts.append("")

        # New Tabs Created Section (if applicable)
        if self.new_tabs_created:
            text_parts.append("## 🗂️ New Tabs Created")
            text_parts.append("")
            for tab in self.new_tabs_created:
                tab_id = tab.get("tabId", "unknown")
                url = tab.get("url", "No URL")
                title = tab.get("title", "")
                loading = tab.get("loading", False)

                text_parts.append(f"**Tab [{tab_id}]**: {url}")
                if title:
                    text_parts.append(f"   Title: {title}")
                if loading:
                    text_parts.append("   Loading: Yes")
            text_parts.append("")

        # Highlighted Elements Section (if applicable)
        if self.highlighted_elements:
            text_parts.append("## Highlighted Elements")
            text_parts.append("")
            highlight_page = self.page if self.page is not None else 1
            highlight_total_pages = (
                self.total_pages if self.total_pages is not None else 1
            )
            text_parts.append(f"**Page**: {highlight_page}/{highlight_total_pages}")
            text_parts.append("")
            text_parts.append(
                f"**Total Elements**: {self.total_elements if self.total_elements is not None else len(self.highlighted_elements)}"
            )
            text_parts.append("")
            # Format: id(type): <tag> "text" · attr=val … flags, with
            # multi-line option blocks for <select>.
            element_lines: List[str] = []
            for el in self.highlighted_elements:
                display_id = _format_display_id(el)
                element_lines.extend(
                    _format_highlighted_element_lines(
                        display_id, el, element_type=self.element_type
                    )
                )
            text_parts.append("\n".join(element_lines))
            text_parts.append("")

        if self.element_id:
            text_parts.append("## Element Action Result")
            text_parts.append("")
            text_parts.append(f"**Element ID**: {self.element_id}")
            text_parts.append("")

        # Browser State Section
        if self.tabs:
            text_parts.append("## Browser State")
            text_parts.append("")
            text_parts.append(f"**Open Tabs** ({len(self.tabs)}):")
            text_parts.append("")
            for i, tab in enumerate(self.tabs, 1):
                active_marker = "●" if tab.get("active") else "○"
                title = tab.get("title", "No title")[:50]
                url = tab.get("url", "No URL")
                # ✅ FIX: Use 'tabId' (from Extension ManagedTab) or fallback to 'id'
                tab_id = tab.get("tabId") or tab.get("id", "unknown")
                text_parts.append(f"{i}. {active_marker} **[{tab_id}]** {title}")
                text_parts.append(f"   URL: {url}")
            text_parts.append("")

        text_content = "\n".join(text_parts)
        # Add image content if screenshot is available
        if self.screenshot_data_url:
            content_items.append(ImageContent(image_urls=[self.screenshot_data_url]))
        content_items.append(TextContent(text=text_content))

        return content_items
