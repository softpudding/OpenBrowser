"""
Base classes for OpenBrowser tool actions and observations.

This module provides the foundation classes that all OpenBrowser tool types
will inherit from, following the OpenHands SDK pattern.
"""

from collections.abc import Sequence
from typing import Any, Dict, List, Optional

from openhands.sdk import Action, ImageContent, Observation, TextContent
from pydantic import Field


class OpenBrowserAction(Action):
    """Base class for all OpenBrowser actions.

    This base class provides common fields needed by all browser automation
    actions, enabling proper type hierarchy and conversation isolation.
    """

    conversation_id: Optional[str] = Field(
        default=None,
        description="Conversation ID for session isolation. Required for multi-session support.",
    )


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
        description="Type of elements highlighted (clickable/scrollable/inputable/hoverable/selectable)",
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
        confirm_cmd = (
            f'{{"action": "confirm_{action_type}", "element_id": "{element_id}"}}'
        )

        text_parts = [
            "## Pending Confirmation",
            "",
            "Inspect the screenshot first.",
            "Confirm only if the single highlighted element is exactly the intended target.",
            "",
            f"**Element ID**: {element_id}",
            f"**Action Type**: {action_type}",
            "",
        ]

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
        text_parts.append("")
        text_parts.append("Use a different action to cancel.")

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
        if not self.success:
            text_parts.append(f"**Status**: FAILED")
            text_parts.append(f"**Error**: {self.error}")
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
            text_parts.append(
                f"**Total Elements**: {self.total_elements if self.total_elements is not None else len(self.highlighted_elements)}"
            )
            text_parts.append("")
            # Format: id: <html> for each element
            element_descriptions = []
            for el in self.highlighted_elements:
                el_id = el.get("id", "unknown")
                el_type = el.get("type")
                raw_hints = (
                    el.get("interactionHints") or el.get("interaction_hints") or []
                )
                interaction_hints = [
                    hint
                    for hint in raw_hints
                    if isinstance(hint, str) and len(hint) > 0
                ]
                suffix_parts = []
                if isinstance(el_type, str) and el_type:
                    suffix_parts.append(el_type)
                suffix_parts.extend(interaction_hints)
                display_id = (
                    f"{el_id}({', '.join(suffix_parts)})" if suffix_parts else el_id
                )
                html = (el.get("html") or "").strip()
                # Skip truncation for selectable elements (show full options)
                if len(html) > 200 and self.element_type != "selectable":
                    html = html[:190] + "...(Truncated)"
                if html:
                    element_descriptions.append(f"{display_id}: {html}")
                else:
                    tag = el.get("tagName", "").upper()
                    element_descriptions.append(f"{display_id} ({tag})")
            text_parts.append("\n".join(element_descriptions))
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
        content_items.append(TextContent(text=text_content))

        # Add image content if screenshot is available
        if self.screenshot_data_url:
            content_items.append(ImageContent(image_urls=[self.screenshot_data_url]))

        return content_items
