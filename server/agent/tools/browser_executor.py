"""
BrowserExecutor - Unified executor for handling all 4 OpenBrowser tool actions.

This executor can handle actions from all 4 focused tools:
- TabAction (from tab_tool.py)
- BaseHighlightAction (from highlight_tool.py)
- ElementInteractionAction (from element_interaction_tool.py)
- DialogHandleAction (from dialog_tool.py)

All actions inherit from OpenBrowserAction and share common conversation_id.
This executor provides consistent command execution and pending confirmation state.
"""

import asyncio
import logging
import threading
from typing import Any, Dict, Optional, Union

from openhands.sdk.tool import ToolExecutor
import requests

from server.core.processor import command_processor
from server.models.commands import (
    TabCommand,
    GetTabsCommand,
    HandleDialogCommand,
    DialogAction,
    TabAction as TabActionEnum,
    ScreenshotCommand,
    HighlightElementsCommand,
    ClickElementCommand,
    HoverElementCommand,
    ScrollElementCommand,
    SwipeElementCommand,
    KeyboardInputCommand,
    GetElementHtmlCommand,
    HighlightSingleElementCommand,
    SelectElementCommand,
)

# Import action types for type checking
from server.agent.tools.tab_tool import TabAction
from server.agent.tools.highlight_tool import BaseHighlightAction
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.agent.tools.dialog_tool import DialogHandleAction

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation

logger = logging.getLogger(__name__)

# Global registry for shared BrowserExecutor instances per conversation
# Key: conversation_id (str), Value: BrowserExecutor instance
_executor_registry: Dict[str, "BrowserExecutor"] = {}


def get_browser_executor(conversation_id: Optional[str] = None) -> "BrowserExecutor":
    """Get or create a BrowserExecutor instance for the given conversation ID.

    If conversation_id is None or not provided, returns a new standalone executor.
    This ensures all tools in the same conversation share the same executor instance.
    """
    if conversation_id is None:
        # No conversation ID, create a new executor (for tests or standalone use)
        return BrowserExecutor()

    if conversation_id not in _executor_registry:
        _executor_registry[conversation_id] = BrowserExecutor()

    return _executor_registry[conversation_id]


def remove_browser_executor(conversation_id: str) -> None:
    """Remove a BrowserExecutor instance from the registry.

    Call this when a conversation ends to clean up resources.
    """
    if conversation_id in _executor_registry:
        del _executor_registry[conversation_id]


class BrowserExecutor(ToolExecutor[OpenBrowserAction, OpenBrowserObservation]):
    """Unified executor for all 4 OpenBrowser tool actions.

    This executor can handle any action that inherits from OpenBrowserAction,
    providing consistent pending confirmation state and command execution
    across all browser automation tools.

    Features:
    - Type-aware action execution (detects action class)
    - Shared pending confirmation state for 2PC actions
    - Conversation isolation (conversation_id)
    - HTTP command execution with proper error handling
    """

    def __init__(self):
        self.conversation_id = None
        # Pending confirmations per conversation for 2PC actions.
        self.pending_confirmations: Dict[str, Dict[str, Any]] = {}

    def __call__(
        self, action: OpenBrowserAction, conversation
    ) -> OpenBrowserObservation:
        """Execute a browser action and return observation"""
        self.conversation_id = str(conversation._state.id)

        logger.debug(
            f"DEBUG: BrowserExecutor.__call__ called with action: {type(action).__name__}, conversation_id: {self.conversation_id}"
        )
        logger.debug(f"DEBUG: Current thread: {threading.current_thread().name}")

        try:
            logger.debug(f"DEBUG: Using command_processor for tool execution")
            obs = self._execute_action_sync(action)
            logger.debug(
                f"DEBUG: BrowserExecutor.__call__ returning observation: success={obs.success}, message={obs.message}, tabs_count={len(obs.tabs)}, has_screenshot={obs.screenshot_data_url is not None}"
            )
            return obs

        except Exception as e:
            logger.debug(f"DEBUG: BrowserExecutor.__call__ exception: {e}")
            import traceback

            logger.error(traceback.format_exc())
            raise

    def _execute_action_sync(self, action: Any) -> OpenBrowserObservation:
        """Execute a browser action synchronously via HTTP.

        This is the main entry point for executing browser actions.
        It detects the action type and routes to the appropriate handler.

        Args:
            action: Any action that inherits from OpenBrowserAction
                   (TabAction, BaseHighlightAction, ElementInteractionAction,
                   DialogHandleAction)

        Returns:
            OpenBrowserObservation with results of the operation
        """
        logger.debug(
            f"DEBUG: _execute_action_sync called with action type: {type(action).__name__}"
        )

        try:
            # Set conversation_id from action if available
            if hasattr(action, "conversation_id") and action.conversation_id:
                self.conversation_id = action.conversation_id

            # Clear pending confirmation if this action is not a confirmation action
            # (AI may have abandoned the previous pending confirmation)
            should_clear = True
            if isinstance(action, ElementInteractionAction):
                # Keep pending confirmation if this is a confirmation action
                if action.action and action.action.startswith("confirm_"):
                    should_clear = False
            if should_clear:
                logger.debug(
                    f"DEBUG: Clearing pending confirmation before action {type(action).__name__}"
                )
                self._clear_pending_confirmation()

            # Route based on action type
            if isinstance(action, TabAction):
                return self._execute_tab_action(action)
            elif isinstance(action, BaseHighlightAction):
                return self._execute_highlight_action(action)
            elif isinstance(action, ElementInteractionAction):
                return self._execute_element_interaction_action(action)
            elif isinstance(action, DialogHandleAction):
                return self._execute_dialog_action(action)
            else:
                raise ValueError(f"Unknown action type: {type(action).__name__}")

        except Exception as e:
            logger.error(f"Error executing action: {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False,
                error=str(e),
                tabs=[],
                screenshot_data_url=None,
                message=f"Failed to execute action: {e}",
            )

    def _execute_tab_action(self, action: TabAction) -> OpenBrowserObservation:
        """Execute a tab management action."""
        logger.debug(
            f"DEBUG: _execute_tab_action called with action.action={action.action}"
        )

        # Validate required parameters
        if action.action is None:
            raise ValueError("tab requires action parameter")

        action_str = action.action
        # Convert action string to TabAction enum
        # TabAction enum values are uppercase, so convert 'open' -> 'OPEN'
        try:
            action_enum = TabActionEnum(action_str.upper())
        except ValueError:
            # If direct conversion fails, try to map common values
            action_map = {
                "init": TabActionEnum.INIT,
                "open": TabActionEnum.OPEN,
                "close": TabActionEnum.CLOSE,
                "switch": TabActionEnum.SWITCH,
                "list": TabActionEnum.LIST,
                "refresh": TabActionEnum.REFRESH,
                "view": TabActionEnum.VIEW,
                "back": TabActionEnum.BACK,
                "forward": TabActionEnum.FORWARD,
            }
            if action_str in action_map:
                action_enum = action_map[action_str]
            else:
                raise ValueError(f"Invalid tab action: {action_str}")

        command = TabCommand(
            action=action_enum,
            url=action.url,
            tab_id=action.tab_id,
            conversation_id=self.conversation_id,
        )
        result_dict = self._execute_command_sync(command)

        # Build appropriate message
        if action_str == "open":
            message = f"Opened tab with URL: {action.url}"
        elif action_str == "init":
            message = f"Initialized session with URL: {action.url}"
        elif action_str == "close":
            message = f"Closed tab ID: {action.tab_id}"
        elif action_str == "switch":
            message = f"Switched to tab ID: {action.tab_id}"
        elif action_str == "refresh":
            message = f"Refreshed tab ID: {action.tab_id}"
        elif action_str == "list":
            message = "Listed tabs"
        elif action_str == "view":
            message = f"Viewed tab {action.tab_id}"
        elif action_str == "back":
            message = f"Navigated back in tab ID: {action.tab_id}"
        elif action_str == "forward":
            message = f"Navigated forward in tab ID: {action.tab_id}"
        else:
            message = f"Tab action: {action_str}"

        # Get tabs data for tab operations (all tab actions should return tabs list)
        tabs_data = []
        tabs_result = self._get_tabs_sync()
        if (
            tabs_result.get("success")
            and tabs_result.get("data")
            and "tabs" in tabs_result["data"]
        ):
            tabs_data = tabs_result["data"]["tabs"]

        return self._build_observation_from_result(
            result_dict, message, tabs_data=tabs_data
        )

    def _execute_highlight_action(
        self, action: BaseHighlightAction
    ) -> OpenBrowserObservation:
        """Execute a highlight elements action."""
        logger.debug(
            f"DEBUG: _execute_highlight_action called with element_type={action.element_type}, page={action.page}"
        )

        # Single element type for stable collision-aware pagination
        element_type = action.element_type or "any"
        page = action.page or 1
        keywords = getattr(action, "keywords", None)
        highlight_snapshot_id = action.highlight_snapshot_id

        command = HighlightElementsCommand(
            element_type=element_type,
            page=page,
            keywords=keywords,
            highlight_snapshot_id=highlight_snapshot_id,
            conversation_id=self.conversation_id,
        )
        result_dict = self._execute_command_sync(command)

        # Check if command succeeded before accessing result data
        if result_dict is None:
            raise RuntimeError(
                "Chrome extension did not respond to highlight_elements command"
            )
        if not result_dict.get("success", False):
            ext_error = result_dict.get("error", "Unknown error from Chrome extension")
            raise RuntimeError(
                f"Chrome extension failed to highlight elements: {ext_error}"
            )

        # Extract elements and pagination info
        elements = result_dict.get("data", {}).get("elements", [])
        total_elements = result_dict.get("data", {}).get("totalElements", 0)
        total_pages = result_dict.get("data", {}).get("totalPages", 1)
        current_page = result_dict.get("data", {}).get("page", 1)
        returned_snapshot_id = result_dict.get("data", {}).get("highlight_snapshot_id")

        # Adjust message based on whether keywords filtering was used
        if keywords:
            keywords_str = ", ".join(keywords)
            message = f"Found {len(elements)} {element_type} elements matching '{keywords_str}' (total: {total_elements})"
        else:
            message = f"Found {len(elements)} {element_type} elements on page {current_page}/{total_pages} (total: {total_elements})"
        if returned_snapshot_id is not None:
            message = f"{message} [highlight_snapshot_id={returned_snapshot_id}]"

        return self._build_observation_from_result(
            result_dict,
            message,
            highlighted_elements=elements,
            total_elements=total_elements,
            element_type=element_type,
            highlight_snapshot_id=returned_snapshot_id,
        )

    def _execute_element_interaction_action(
        self, action: ElementInteractionAction
    ) -> OpenBrowserObservation:
        """Execute an element interaction action."""
        logger.debug(
            f"DEBUG: _execute_element_interaction_action called with action={action.action}, element_id={action.element_id}"
        )

        # Route to appropriate handler based on action type
        action_type = action.action

        # ========== 2PC Phase 1: Actions Requiring Confirmation ==========
        if action_type == "click":
            if not action.element_id:
                raise ValueError("click requires element_id parameter")
            if action.highlight_snapshot_id is None:
                raise ValueError("click requires highlight_snapshot_id parameter")
            full_html, screenshot = self._get_element_full_html(
                action.element_id, action.highlight_snapshot_id
            )
            self._set_pending_confirmation(
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
                action_type="click",
                full_html=full_html,
                extra_data={
                    "tab_id": action.tab_id,
                    "highlight_snapshot_id": action.highlight_snapshot_id,
                },
                screenshot_data_url=screenshot,
            )
            result_dict = {"success": True, "data": {}}
            message = (
                f"Click action pending confirmation for element: {action.element_id}"
            )
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
            )

        elif action_type == "hover":
            if not action.element_id:
                raise ValueError("hover requires element_id parameter")
            if action.highlight_snapshot_id is None:
                raise ValueError("hover requires highlight_snapshot_id parameter")
            command = HoverElementCommand(
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(
                command, "hover element"
            )
            return self._build_observation_from_result(
                result_dict,
                f"Hovered element: {action.element_id}",
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
            )

        elif action_type == "scroll":
            if action.element_id:
                if action.highlight_snapshot_id is None:
                    raise ValueError(
                        "scroll requires highlight_snapshot_id when element_id is provided"
                    )
                command = ScrollElementCommand(
                    element_id=action.element_id,
                    highlight_snapshot_id=action.highlight_snapshot_id,
                    direction=action.direction,
                    scroll_amount=action.scroll_amount or 0.5,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_element_command(
                    command, "scroll element"
                )
                return self._build_observation_from_result(
                    result_dict,
                    f"Scrolled element: {action.element_id}",
                    element_id=action.element_id,
                    highlight_snapshot_id=action.highlight_snapshot_id,
                )
            else:
                command = ScrollElementCommand(
                    direction=action.direction,
                    scroll_amount=action.scroll_amount or 0.5,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_element_command(command, "scroll element")
                return self._build_observation_from_result(
                    result_dict, f"Scrolled page: {action.direction}"
                )

        elif action_type == "swipe":
            if not action.element_id:
                raise ValueError("swipe requires element_id parameter")
            if action.highlight_snapshot_id is None:
                raise ValueError("swipe requires highlight_snapshot_id parameter")

            swipe_direction = "next"
            if "direction" in action.model_fields_set:
                if action.direction not in {"next", "prev"}:
                    raise ValueError("swipe direction must be 'next' or 'prev'")
                swipe_direction = action.direction
            swipe_count = action.swipe_count or 1
            command = SwipeElementCommand(
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
                direction=swipe_direction,
                swipe_count=swipe_count,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(command, "swipe element")
            return self._build_observation_from_result(
                result_dict,
                f"Swiped element: {action.element_id}",
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
            )

        elif action_type == "keyboard_input":
            if not action.element_id:
                raise ValueError("keyboard_input requires element_id parameter")
            if not action.text:
                raise ValueError("keyboard_input requires text parameter")
            if action.highlight_snapshot_id is None:
                raise ValueError("keyboard_input requires highlight_snapshot_id parameter")
            full_html, screenshot = self._get_element_full_html(
                action.element_id, action.highlight_snapshot_id
            )
            self._set_pending_confirmation(
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
                action_type="keyboard_input",
                full_html=full_html,
                extra_data={
                    "text": action.text,
                    "tab_id": action.tab_id,
                    "highlight_snapshot_id": action.highlight_snapshot_id,
                },
                screenshot_data_url=screenshot,
            )
            result_dict = {"success": True, "data": {}}
            message = f"Keyboard input action pending confirmation for element: {action.element_id}"
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
            )

        elif action_type == "select":
            if not action.element_id:
                raise ValueError("select requires element_id parameter")
            if action.value is None:
                raise ValueError("select requires value parameter")
            if action.highlight_snapshot_id is None:
                raise ValueError("select requires highlight_snapshot_id parameter")
            command = SelectElementCommand(
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
                value=action.value,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(
                command, "select option"
            )
            return self._build_observation_from_result(
                result_dict,
                f"Selected option in element: {action.element_id}",
                element_id=action.element_id,
                highlight_snapshot_id=action.highlight_snapshot_id,
            )

        # ========== 2PC Phase 2: Confirm Operations ==========
        elif action_type == "confirm_click":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "click":
                raise ValueError(
                    "No pending click confirmation found. Please call click first."
                )
            pending_element_id = pending.get("element_id")
            pending_snapshot_id = pending.get("highlight_snapshot_id")
            pending_extra_data = pending.get("extra_data", {})
            if pending_snapshot_id is None:
                pending_snapshot_id = pending_extra_data.get("highlight_snapshot_id")
            if not pending_element_id:
                raise ValueError(
                    "Pending click confirmation is missing element_id state."
                )
            if pending_snapshot_id is None:
                raise ValueError(
                    "Pending click confirmation is missing highlight_snapshot_id state."
                )
            # Execute actual click
            command = ClickElementCommand(
                element_id=pending_element_id,
                highlight_snapshot_id=pending_snapshot_id,
                conversation_id=self.conversation_id,
                tab_id=pending_extra_data.get("tab_id"),
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get("success"):
                ext_error = self._extract_result_error(result_dict)
                raise RuntimeError(f"Failed to click element: {ext_error}")
            message = f"Confirmed and clicked element: {pending_element_id}"
            self._clear_pending_confirmation()
            return self._build_observation_from_result(
                result_dict,
                message,
                element_id=pending_element_id,
                highlight_snapshot_id=pending_snapshot_id,
            )

        elif action_type == "confirm_keyboard_input":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "keyboard_input":
                raise ValueError(
                    "No pending keyboard_input confirmation found. Please call keyboard_input first."
                )
            pending_element_id = pending.get("element_id")
            pending_snapshot_id = pending.get("highlight_snapshot_id")
            pending_extra_data = pending.get("extra_data", {})
            if pending_snapshot_id is None:
                pending_snapshot_id = pending_extra_data.get("highlight_snapshot_id")
            if not pending_element_id:
                raise ValueError(
                    "Pending keyboard_input confirmation is missing element_id state."
                )
            if pending_snapshot_id is None:
                raise ValueError(
                    "Pending keyboard_input confirmation is missing highlight_snapshot_id state."
                )
            command = KeyboardInputCommand(
                element_id=pending_element_id,
                highlight_snapshot_id=pending_snapshot_id,
                text=pending_extra_data.get("text", ""),
                conversation_id=self.conversation_id,
                tab_id=pending_extra_data.get("tab_id"),
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get("success"):
                ext_error = self._extract_result_error(result_dict)
                raise RuntimeError(f"Failed to input text: {ext_error}")
            message = f"Confirmed and input text to element: {pending_element_id}"
            self._clear_pending_confirmation()
            return self._build_observation_from_result(
                result_dict,
                message,
                element_id=pending_element_id,
                highlight_snapshot_id=pending_snapshot_id,
            )

        else:
            raise ValueError(f"Invalid element interaction action: {action_type}")

    def _execute_dialog_action(
        self, action: DialogHandleAction
    ) -> OpenBrowserObservation:
        """Execute a dialog handling action."""
        logger.debug(
            f"DEBUG: _execute_dialog_action called with dialog_action={action.dialog_action}"
        )

        # Handle dialog action (accept or dismiss)
        if action.dialog_action is None:
            raise ValueError("dialog requires dialog_action parameter")

        dialog_action_str = action.dialog_action
        try:
            dialog_action = DialogAction(dialog_action_str.lower())
        except ValueError:
            raise ValueError(
                f"Invalid dialog action: {dialog_action_str}. Must be 'accept' or 'dismiss'"
            )

        command = HandleDialogCommand(
            action=dialog_action,
            prompt_text=action.prompt_text,
            conversation_id=self.conversation_id,
        )
        result_dict = self._execute_command_sync(command)

        message = f"Dialog handled: {dialog_action_str}"
        return self._build_observation_from_result(result_dict, message)

    # ========== 2PC State Management Methods ==========

    def _clear_pending_confirmation(self):
        """Clear pending confirmation for current conversation"""
        if self.conversation_id in self.pending_confirmations:
            del self.pending_confirmations[self.conversation_id]

    def _set_pending_confirmation(
        self,
        element_id: str,
        highlight_snapshot_id: int,
        action_type: str,
        full_html: str,
        extra_data: Dict[str, Any] = None,
        screenshot_data_url: Optional[str] = None,
    ):
        """Set pending confirmation for current conversation"""
        self.pending_confirmations[self.conversation_id] = {
            "element_id": element_id,
            "highlight_snapshot_id": highlight_snapshot_id,
            "action_type": action_type,
            "full_html": full_html,
            "screenshot_data_url": screenshot_data_url,
            "extra_data": extra_data or {},
        }

    def _get_pending_confirmation(self) -> Optional[Dict[str, Any]]:
        """Get pending confirmation for current conversation"""
        return self.pending_confirmations.get(self.conversation_id)

    def _extract_result_error(
        self, result_dict: Optional[Dict[str, Any]], default: str = "Unknown error"
    ) -> str:
        """Extract a usable error message from extension responses."""
        if not result_dict:
            return "No response"

        error = result_dict.get("error")
        if isinstance(error, str) and error.strip():
            return error
        if error not in (None, ""):
            return str(error)

        data = result_dict.get("data")
        if isinstance(data, dict):
            nested_error = data.get("error")
            if isinstance(nested_error, str) and nested_error.strip():
                return nested_error
            if nested_error not in (None, ""):
                return str(nested_error)

        message = result_dict.get("message")
        if isinstance(message, str) and message.strip():
            return message

        return default

    # ========== Helper Methods ==========

    def _execute_element_command(
        self, command: Any, action_description: str
    ) -> Dict[str, Any]:
        """Execute an element command and raise a normalized error on failure."""
        result_dict = self._execute_command_sync(command)
        if not result_dict or not result_dict.get("success"):
            ext_error = self._extract_result_error(result_dict)
            raise RuntimeError(f"Failed to {action_description}: {ext_error}")
        return result_dict

    def _get_element_full_html(
        self, element_id: str, highlight_snapshot_id: int
    ) -> tuple[str, Optional[str]]:
        """Get the full HTML of an element from extension's elementCache AND a screenshot with highlight.

        This uses HighlightSingleElementCommand to get both HTML and screenshot.
        Returns a tuple of (html, screenshot_data_url).
        """
        command = HighlightSingleElementCommand(
            element_id=element_id,
            highlight_snapshot_id=highlight_snapshot_id,
            conversation_id=self.conversation_id,
        )
        result_dict = self._execute_command_sync(command)

        if result_dict and result_dict.get("success"):
            data = result_dict.get("data", {})
            html = data.get("html") if isinstance(data, dict) else None
            screenshot = data.get("screenshot") if isinstance(data, dict) else None

            if html and isinstance(html, str):
                html = html[:10000] + ("..." if len(html) > 10000 else "")

            return (html or "<element not found in cache>", screenshot)
        else:
            logger.warning(
                f"Unexpected HighlightSingleElementCommand response: {result_dict}"
            )

        logger.warning(
            f"Element {element_id} not found in cache for conversation {self.conversation_id}"
        )
        return ("<element not found in cache>", None)

    def _build_observation_from_result(
        self,
        result_dict: Optional[Dict[str, Any]],
        message: str,
        tabs_data: Optional[list] = None,
        screenshot_data_url: Optional[str] = None,
        highlighted_elements: Optional[list] = None,
        total_elements: Optional[int] = None,
        element_id: Optional[str] = None,
        highlight_snapshot_id: Optional[int] = None,
        element_type: Optional[str] = None,
    ) -> OpenBrowserObservation:
        """Build an OpenBrowserObservation from a result dictionary."""
        success = True  # Default to True
        error = None
        dialog_opened = None
        dialog = None
        dialog_auto_accepted = None
        auto_accepted_dialogs = None
        new_tabs_created = None
        javascript_result = None
        console_output = None
        scroll_effective = None
        scroll_warning = None
        swipe_effective = None
        swipe_warning = None

        if result_dict:
            success = result_dict.get("success", False)
            if "error" in result_dict:
                error = result_dict["error"]

            # Extract dialog info if present
            if "dialog_opened" in result_dict:
                dialog_opened = result_dict["dialog_opened"]
            if "dialog" in result_dict:
                dialog = result_dict["dialog"]
                # Update message for dialog scenarios
                if dialog and success:
                    if dialog.get("needsDecision"):
                        message = f'Dialog opened: {dialog.get("type")} ("{dialog.get("message")}"). Use dialog tool to respond.'
                    else:
                        message = f'Dialog auto-accepted: {dialog.get("type")} ("{dialog.get("message")}")'

            # Extract auto-accepted dialog info if present
            # Check multiple naming conventions from extension (camelCase and snake_case)
            if "dialog_auto_accepted" in result_dict:
                dialog_auto_accepted = result_dict["dialog_auto_accepted"]
            elif "dialogAutoAccepted" in result_dict:
                dialog_auto_accepted = result_dict["dialogAutoAccepted"]

            if dialog_auto_accepted:
                # Update message to include auto-accepted dialog info
                if success:
                    dialog_type = dialog_auto_accepted.get("type", "alert")
                    dialog_message = dialog_auto_accepted.get("message", "")
                    if not (dialog and dialog.get("needsDecision")):
                        # Only update message if not already updated by dialog field
                        message = f'Alert dialog auto-accepted: {dialog_type} ("{dialog_message}")'

            # Extract list of auto-accepted dialogs (for cascading alerts)
            # Check multiple naming conventions from extension
            if "auto_accepted_dialogs" in result_dict:
                auto_accepted_dialogs = result_dict["auto_accepted_dialogs"]
            elif "dialogAutoAcceptedList" in result_dict:
                auto_accepted_dialogs = result_dict["dialogAutoAcceptedList"]
            elif "dialog_auto_accepted_list" in result_dict:
                auto_accepted_dialogs = result_dict["dialog_auto_accepted_list"]

            # Also check in data field if present
            if "data" in result_dict:
                if isinstance(result_dict["data"], dict):
                    data = result_dict["data"]
                    if error is None and "error" in data:
                        error = data["error"]
                    if not dialog_auto_accepted and "dialog_auto_accepted" in data:
                        dialog_auto_accepted = data["dialog_auto_accepted"]
                    elif not dialog_auto_accepted and "dialogAutoAccepted" in data:
                        dialog_auto_accepted = data["dialogAutoAccepted"]

                    if not auto_accepted_dialogs and "auto_accepted_dialogs" in data:
                        auto_accepted_dialogs = data["auto_accepted_dialogs"]
                    elif not auto_accepted_dialogs and "dialogAutoAcceptedList" in data:
                        auto_accepted_dialogs = data["dialogAutoAcceptedList"]
                    elif (
                        not auto_accepted_dialogs
                        and "dialog_auto_accepted_list" in data
                    ):
                        auto_accepted_dialogs = data["dialog_auto_accepted_list"]

                    # Extract screenshot from visual interaction commands
                    # highlight_elements returns data.screenshot (highlighted image)
                    # click/hover/scroll/keyboard_input return data.screenshot
                    if "screenshot" in data:
                        screenshot_data_url = data["screenshot"]
                        logger.debug(
                            f"DEBUG: Extracted screenshot from data['screenshot'], length={len(screenshot_data_url) if screenshot_data_url else 0}"
                        )
                    elif "imageData" in data:
                        screenshot_data_url = data["imageData"]
                        logger.debug(
                            f"DEBUG: Extracted screenshot from data['imageData'], length={len(screenshot_data_url) if screenshot_data_url else 0}"
                        )

                    # Extract highlighted elements for highlight_elements action
                    if highlighted_elements is None and "elements" in data:
                        highlighted_elements = data["elements"]
                    if total_elements is None and "totalElements" in data:
                        total_elements = data["totalElements"]
                    if (
                        highlight_snapshot_id is None
                        and "highlight_snapshot_id" in data
                    ):
                        highlight_snapshot_id = data["highlight_snapshot_id"]

                    # Extract new_tabs_created for javascript_execute and confirm_click_element
                    if "new_tabs_created" in data:
                        new_tabs_created = data["new_tabs_created"]

                    if "scrollEffective" in data:
                        scroll_effective = data["scrollEffective"]
                    if "warning" in data:
                        scroll_warning = data["warning"]
                    if "swipeEffective" in data:
                        swipe_effective = data["swipeEffective"]
                        if "warning" in data:
                            swipe_warning = data["warning"]

                    # Extract JavaScript execution result if present
                    if "result" in data or "value" in data or "consoleOutput" in data:
                        # Extract console output if available
                        if "consoleOutput" in data:
                            console_output = data["consoleOutput"]
                            logger.debug(
                                f"DEBUG: Captured console output: {len(console_output)} entries"
                            )

                        if "result" in data:
                            js_result = data["result"]
                            # CDP result object has 'value' field when returnByValue is true
                            if isinstance(js_result, dict) and "value" in js_result:
                                javascript_result = js_result["value"]
                            else:
                                javascript_result = js_result
                        # Also check for direct 'value' in data
                        elif "value" in data:
                            javascript_result = data["value"]
                        else:
                            # If no result or value, use the entire data dict
                            javascript_result = data
                else:
                    # data is not a dict (e.g., string error), use it as javascript_result
                    javascript_result = result_dict["data"]

            # If there's an error but no data, use error as javascript_result
            if javascript_result is None and result_dict.get("error"):
                javascript_result = result_dict["error"]

            # If we have a JavaScript result, update message to include it (only for successful executions)
            if javascript_result is not None and success:
                result_str = str(javascript_result)
                if len(result_str) > 100:
                    result_str = result_str[:100] + "..."
                message = f"{message} - Result: {result_str}"

            if scroll_warning and scroll_effective is False:
                message = f"{message} ⚠️ {scroll_warning}"
            if swipe_warning and swipe_effective is False:
                message = f"{message} ⚠️ {swipe_warning}"

        # Get pending confirmation (may have been cleared if action wasn't a confirmation)
        pending_confirmation = self._get_pending_confirmation()

        # Build observation
        observation = OpenBrowserObservation(
            success=success,
            message=message,
            error=error,
            tabs=tabs_data or [],
            screenshot_data_url=screenshot_data_url,
            dialog_opened=dialog_opened,
            dialog=dialog,
            dialog_auto_accepted=dialog_auto_accepted,
            auto_accepted_dialogs=auto_accepted_dialogs,
            highlighted_elements=highlighted_elements,
            total_elements=total_elements,
            new_tabs_created=new_tabs_created,
            element_id=element_id,
            highlight_snapshot_id=highlight_snapshot_id,
            element_type=element_type,
            javascript_result=javascript_result,
            console_output=console_output,
            scroll_effective=scroll_effective,
            scroll_warning=scroll_warning,
            pending_confirmation=pending_confirmation,
        )

        return observation

    def _execute_command_sync(self, command) -> Any:
        """Execute a command synchronously via HTTP with conversation context"""
        logger.debug(
            f"DEBUG: _execute_command_sync called with command type: {command.type if hasattr(command, 'type') else type(command).__name__}, conversation_id={self.conversation_id}"
        )
        try:
            # Set conversation_id for multi-session support (backup if not set during creation)
            if hasattr(command, "conversation_id"):
                if command.conversation_id is None:
                    command.conversation_id = self.conversation_id

            # Convert command to dict using model_dump
            cmd_dict = command.model_dump()
            logger.info(
                f"🔍 Command dict: type={cmd_dict.get('type')}, conversation_id={cmd_dict.get('conversation_id')}"
            )

            # Send HTTP POST to server - explicitly disable proxy for localhost
            response = requests.post(
                "http://127.0.0.1:8765/command",
                json=cmd_dict,
                timeout=30,
                proxies={
                    "http": None,
                    "https": None,
                },  # Disable proxy for local connections
            )
            response.raise_for_status()
            result = response.json()
            if isinstance(result, dict) and not result.get("success", False):
                normalized_error = self._extract_result_error(result, default="")
                if normalized_error:
                    result["error"] = normalized_error
            logger.debug(
                f"DEBUG: _execute_command_sync returned: success={result.get('success')}"
            )
            return result
        except Exception as e:
            logger.debug(f"DEBUG: _execute_command_sync exception: {e}")
            raise

    def _get_tabs_sync(self) -> Any:
        """Get current tab list synchronously"""
        logger.debug(f"DEBUG: _get_tabs_sync called, sending GetTabsCommand via HTTP")
        command = GetTabsCommand(
            managed_only=True, conversation_id=self.conversation_id
        )
        result = self._execute_command_sync(command)
        logger.debug(
            f"DEBUG: _get_tabs_sync result: success={result.get('success')}, data keys={list(result.get('data', {}).keys()) if result.get('data') else 'None'}"
        )
        return result
