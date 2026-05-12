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
import sys
import threading
from typing import Any, Dict, List, Optional, Tuple, Union

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
    DragAndDropElementCommand,
    SetSliderValueCommand,
    UploadFileCommand,
    HighlightDropPreviewCommand,
    AnalyzePixelTargetsCommand,
    RenderPixelConfirmCommand,
    MouseMoveCommand,
    MouseClickCommand,
    MouseDragCommand,
    MouseScrollCommand,
    KeyboardTypeCommand,
    KeyboardPressCommand,
    KeyboardClearCommand,
    ResetMouseCommand,
    SelectOptionCommand,
    UploadFilePendingCommand,
    MouseButton,
    ScrollDirection,
)

# Import action types for type checking
from server.agent.tools.tab_tool import TabAction
from server.agent.tools.highlight_tool import BaseHighlightAction
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.agent.tools.dialog_tool import DialogHandleAction
from server.agent.tools.mouse_tool import MouseAction
from server.agent.tools.keyboard_tool import KeyboardAction
from server.agent.tools.select_option_tool import SelectOptionAction
from server.agent.tools.upload_file_tool import UploadFileAction

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation
from server.core.llm_config import llm_config_manager
from server.core.model_profiles import is_small_model
from server.core.session_manager import session_manager

logger = logging.getLogger(__name__)

ELEMENT_HTML_CACHE_MISS_PLACEHOLDER = "<element not found in cache>"

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
        # Most recent highlight result per conversation. Keyed by conversation_id,
        # value is the list of element dicts returned by the last highlight call.
        # Used in routine-replay mode to auto-confirm clicks/selects/keyboard_input
        # when the target was just uniquely highlighted.
        self.last_highlight_elements: Dict[str, List[Dict[str, Any]]] = {}
        # Most recent CSS-pixel viewport per conversation (vw, vh). Captured
        # from screenshot responses; consumed by the pixel-interaction path to
        # denormalize Qwen-VL [0,1000] coordinates before dispatching to the
        # extension. None = no screenshot yet — caller must take one first.
        self.last_viewport_by_conv: Dict[str, tuple[int, int]] = {}
        # Most recent virtual-cursor position per conversation in CSS pixels.
        # Tracked alongside extension state so the server can identify the
        # implicit click point for the pixel `click` action (which fires in
        # place at the cursor). Updated after `move`, `drag`, and `reset`;
        # falls back to viewport center when unset, matching the extension's
        # own first-action behavior.
        self.last_cursor_by_conv: Dict[str, tuple[int, int]] = {}

    def _uses_small_model(self) -> bool:
        """Whether the active conversation uses the small-model profile."""
        if not self.conversation_id:
            return False

        session = session_manager.get_session(str(self.conversation_id))
        if session is None:
            return False

        model_name: str | None = None
        raw_model = session.metadata.get("model")
        if isinstance(raw_model, str) and raw_model:
            model_name = raw_model

        if model_name is None:
            raw_model_alias = session.metadata.get("model_alias")
            if isinstance(raw_model_alias, str) and raw_model_alias:
                try:
                    model_name = llm_config_manager.get_llm_config(
                        raw_model_alias
                    ).model
                except ValueError:
                    model_name = None

        return is_small_model(model_name)

    def _cache_viewport(self, vw: int, vh: int) -> None:
        """Cache the latest CSS-pixel viewport for the active conversation."""
        if not self.conversation_id:
            return
        if vw <= 0 or vh <= 0:
            return
        self.last_viewport_by_conv[str(self.conversation_id)] = (vw, vh)

    def _get_viewport(self) -> Optional[tuple[int, int]]:
        """Return the latest cached CSS-pixel viewport, or None if unknown."""
        if not self.conversation_id:
            return None
        return self.last_viewport_by_conv.get(str(self.conversation_id))

    def _cache_cursor(self, x_css: int, y_css: int) -> None:
        """Cache the latest virtual-cursor position (CSS px) for the conv."""
        if not self.conversation_id:
            return
        self.last_cursor_by_conv[str(self.conversation_id)] = (
            int(x_css),
            int(y_css),
        )

    def _get_cursor_or_center(self) -> Optional[tuple[int, int]]:
        """Return the cached cursor position, falling back to viewport center.

        Mirrors the extension's `resolveCursorOrCenter`: pixel `click` lands
        wherever the virtual cursor currently sits, which is the viewport
        center until the agent has moved it. Returns None only when neither
        the cursor nor a viewport has been observed yet.
        """
        if not self.conversation_id:
            return None
        cached = self.last_cursor_by_conv.get(str(self.conversation_id))
        if cached is not None:
            return cached
        viewport = self._get_viewport()
        if viewport is None:
            return None
        vw, vh = viewport
        return (vw // 2, vh // 2)

    def _is_qwen_model(self) -> bool:
        """Whether the active conversation uses a Qwen vision model.

        Qwen-VL emits coordinates in the [0, 1000] normalized space, so the
        server must denormalize before dispatching CDP input. Detection is
        prefix-based on the canonical dashscope model id.
        """
        if not self.conversation_id:
            return False
        session = session_manager.get_session(str(self.conversation_id))
        if session is None:
            return False

        model_name = session.metadata.get("model")
        if not isinstance(model_name, str) or not model_name:
            raw_alias = session.metadata.get("model_alias")
            if isinstance(raw_alias, str) and raw_alias:
                try:
                    model_name = llm_config_manager.get_llm_config(raw_alias).model
                except ValueError:
                    model_name = None

        if not isinstance(model_name, str):
            return False
        return model_name.startswith("dashscope/qwen") or model_name.startswith("qwen")

    def _is_routine_replay_mode(self) -> bool:
        """Whether the active conversation is running in routine-replay mode."""
        if not self.conversation_id:
            return False

        session = session_manager.get_session(str(self.conversation_id))
        if session is None:
            return False

        return session.metadata.get("mode") == "routine_replay"

    def _auto_confirm_target_id(self, requested_element_id: str) -> str | None:
        """Return the resolved element id if auto-confirm applies, else None.

        In routine-replay mode, when the most recent highlight call in this
        conversation returned exactly one element whose id matches the one the
        agent is now targeting, we can skip the two-phase confirmation round
        trip: the routine SOP's precise keywords already disambiguated the
        target, so a confirmation prompt adds latency without adding safety.
        """
        if not self._is_routine_replay_mode():
            return None
        if not self.conversation_id or not requested_element_id:
            return None
        recent = self.last_highlight_elements.get(self.conversation_id)
        if not recent or len(recent) != 1:
            return None
        only_id = recent[0].get("id")
        if not only_id or only_id != requested_element_id:
            return None
        return only_id

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
            # NOTE: Do NOT read action.conversation_id here. It is an internal
            # routing field that must only ever be populated by the executor
            # itself (see __call__, which sets self.conversation_id from
            # conversation._state.id). Trusting action.conversation_id allowed a
            # hallucinated value from the LLM (e.g. a stray tab_id) to clobber
            # the real conversation id and produce HTTP 400s from the Chrome
            # extension server.

            # Clear pending confirmation if this action is not a confirmation action
            # (AI may have abandoned the previous pending confirmation)
            should_clear = True
            if isinstance(action, ElementInteractionAction):
                # Keep pending confirmation if this is a confirmation action
                if action.action and action.action.startswith("confirm_"):
                    should_clear = False
            elif isinstance(action, MouseAction):
                # The pixel-action gate stores its pending confirmation in the
                # same registry; preserve it when the agent commits via
                # `mouse(action="confirm")`.
                if action.action == "confirm":
                    should_clear = False
            # When the agent emits a non-confirm action while a pixel
            # confirmation is pending, treat the action as an implicit
            # rejection: stash the candidate list so the response to the
            # new action can include them as structured guidance. The
            # element-paradigm pendings are skipped here — they have their
            # own LLM rendering path (`_pending_confirmation_llm_content`).
            rejected_pixel_candidates: list = []
            if should_clear:
                pending = self._get_pending_confirmation()
                if pending and pending.get("action_type") in (
                    "mouse_click_pixel",
                    "mouse_drag_pixel",
                ):
                    cands = (pending.get("extra_data") or {}).get("candidates")
                    if isinstance(cands, list):
                        rejected_pixel_candidates = cands
                logger.debug(
                    f"DEBUG: Clearing pending confirmation before action {type(action).__name__}"
                )
                self._clear_pending_confirmation()

            # Route based on action type
            if isinstance(action, TabAction):
                obs = self._execute_tab_action(action)
            elif isinstance(action, BaseHighlightAction):
                obs = self._execute_highlight_action(action)
            elif isinstance(action, ElementInteractionAction):
                obs = self._execute_element_interaction_action(action)
            elif isinstance(action, DialogHandleAction):
                obs = self._execute_dialog_action(action)
            elif isinstance(action, MouseAction):
                obs = self._execute_mouse_action(action)
            elif isinstance(action, KeyboardAction):
                obs = self._execute_keyboard_action(action)
            elif isinstance(action, SelectOptionAction):
                obs = self._execute_select_option_action(action)
            elif isinstance(action, UploadFileAction):
                obs = self._execute_upload_file_action(action)
            else:
                raise ValueError(f"Unknown action type: {type(action).__name__}")

            # Append rejected-pending candidates to the response so the
            # agent has them fresh when course-correcting. Skip if the new
            # action triggered its own pixel gate (its message already
            # contains a fresh candidates block).
            if rejected_pixel_candidates and getattr(obs, "success", False):
                new_pending = self._get_pending_confirmation()
                new_is_pixel_gate = bool(
                    new_pending
                    and new_pending.get("action_type")
                    in ("mouse_click_pixel", "mouse_drag_pixel")
                )
                if not new_is_pixel_gate:
                    block = self._format_pixel_candidates_block(
                        rejected_pixel_candidates,
                        header=(
                            "Candidates near the previously-previewed click "
                            "(centers in [0,1000] space)"
                        ),
                    )
                    if block:
                        existing = obs.message or ""
                        merged = (
                            existing.rstrip() + ("\n\n" if existing else "") + block
                        )
                        # OpenBrowserObservation is frozen; rebuild via copy.
                        obs = obs.model_copy(update={"message": merged})
            return obs

        except Exception as e:
            logger.error(f"Error executing action: {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False,
                error=str(e),
                tabs=[],
                screenshot_data_url=None,
                message=f"Failed to execute action: {e}",
                small_model=self._uses_small_model(),
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

        command = HighlightElementsCommand(
            element_type=element_type,
            page=page,
            keywords=keywords,
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
        if self.conversation_id:
            self.last_highlight_elements[self.conversation_id] = list(elements)
        element_label = self._format_highlight_element_label(
            element_type=element_type, count=len(elements)
        )
        # Adjust message based on whether keywords filtering was used
        if keywords:
            keywords_str = ", ".join(keywords)
            message = f"Found {len(elements)} {element_label} matching '{keywords_str}'"
        else:
            message = f"Found {len(elements)} {element_label}"

        return self._build_observation_from_result(
            result_dict,
            message,
            highlighted_elements=elements,
            total_elements=total_elements,
            element_type=element_type,
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
            auto_id = self._auto_confirm_target_id(action.element_id)
            if auto_id:
                command = ClickElementCommand(
                    element_id=auto_id,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get("success"):
                    ext_error = self._extract_result_error(result_dict)
                    raise RuntimeError(f"Failed to click element: {ext_error}")
                return self._build_observation_from_result(
                    result_dict,
                    f"Auto-confirmed and clicked element: {auto_id}",
                    element_id=auto_id,
                )
            element_preview = self._get_element_full_html(action.element_id, "click")
            full_html = element_preview[0]
            screenshot = element_preview[1]
            resolved_element_id = (
                element_preview[2]
                if len(element_preview) > 2 and element_preview[2]
                else action.element_id
            )
            resolution_note = (
                element_preview[3]
                if len(element_preview) > 3 and isinstance(element_preview[3], str)
                else None
            )
            self._set_pending_confirmation(
                element_id=resolved_element_id,
                action_type="click",
                full_html=full_html,
                extra_data={
                    "tab_id": action.tab_id,
                },
                screenshot_data_url=screenshot,
                requested_element_id=(
                    action.element_id
                    if resolved_element_id != action.element_id
                    else None
                ),
                element_id_resolution_note=resolution_note,
            )
            result_dict = {"success": True, "data": {}}
            message = (
                f"Click action pending confirmation for element: {resolved_element_id}"
            )
            if resolution_note:
                message = f"{message} {resolution_note}"
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=resolved_element_id,
            )

        elif action_type == "hover":
            if not action.element_id:
                raise ValueError("hover requires element_id parameter")
            command = HoverElementCommand(
                element_id=action.element_id,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(command, "hover element")
            return self._build_observation_from_result(
                result_dict,
                f"Hovered element: {action.element_id}",
                element_id=action.element_id,
            )

        elif action_type == "scroll":
            if action.element_id:
                command = ScrollElementCommand(
                    element_id=action.element_id,
                    direction=action.direction,
                    scroll_amount=action.scroll_amount or 0.5,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_element_command(command, "scroll element")
                return self._build_observation_from_result(
                    result_dict,
                    f"Scrolled element: {action.element_id}",
                    element_id=action.element_id,
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

            swipe_direction = "next"
            if "direction" in action.model_fields_set:
                if action.direction not in {"next", "prev"}:
                    raise ValueError("swipe direction must be 'next' or 'prev'")
                swipe_direction = action.direction
            swipe_count = action.swipe_count or 1
            command = SwipeElementCommand(
                element_id=action.element_id,
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
            )

        elif action_type == "drag_and_drop":
            if not action.element_id:
                raise ValueError("drag_and_drop requires element_id (source)")
            if not action.target_element_id:
                raise ValueError(
                    "drag_and_drop requires target_element_id (drop container)"
                )

            # 2PC: Phase 1 returns drop preview with inner elements
            preview_command = HighlightDropPreviewCommand(
                source_element_id=action.element_id,
                target_element_id=action.target_element_id,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_command_sync(preview_command)
            if not result_dict or not result_dict.get("success"):
                ext_error = self._extract_result_error(result_dict)
                raise RuntimeError(f"Failed to get drop preview: {ext_error}")

            data = result_dict.get("data", {})
            screenshot = data.get("screenshot")
            inner_elements = data.get("elements", [])

            self._set_pending_confirmation(
                element_id=action.element_id,
                action_type="drag_and_drop",
                full_html="",
                extra_data={
                    "target_element_id": action.target_element_id,
                    "steps": action.steps or 10,
                    "tab_id": action.tab_id,
                    "inner_elements": inner_elements,
                },
                screenshot_data_url=screenshot,
            )
            inner_count = len(inner_elements)
            message = (
                f"Drag preview for {action.element_id} → "
                f"{action.target_element_id}: "
                f"{inner_count} inner element{'s' if inner_count != 1 else ''} found. "
                f"Use confirm_drag_and_drop to drop at end, or specify "
                f"relative_to and position for precise placement."
            )
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=action.element_id,
                highlighted_elements=inner_elements,
            )

        elif action_type == "set_slider":
            if not action.element_id:
                raise ValueError("set_slider requires element_id parameter")
            if action.value is None:
                raise ValueError("set_slider requires value parameter")
            if isinstance(action.value, list):
                raise ValueError(
                    "set_slider value must be a number or percentage string, not a list"
                )
            command = SetSliderValueCommand(
                element_id=action.element_id,
                value=action.value,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(command, "set slider value")
            return self._build_observation_from_result(
                result_dict,
                f"Set slider {action.element_id} to {action.value}",
                element_id=action.element_id,
            )

        elif action_type == "upload_file":
            if not action.element_id:
                raise ValueError("upload_file requires element_id parameter")
            if not action.file_path:
                raise ValueError(
                    "upload_file requires file_path (absolute path on the server host)"
                )
            command = UploadFileCommand(
                element_id=action.element_id,
                file_path=action.file_path,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id,
            )
            result_dict = self._execute_element_command(command, "upload file")
            return self._build_observation_from_result(
                result_dict,
                f"Uploaded file to {action.element_id}: {action.file_path}",
                element_id=action.element_id,
            )

        elif action_type == "keyboard_input":
            if not action.element_id:
                raise ValueError("keyboard_input requires element_id parameter")
            if not action.text:
                raise ValueError("keyboard_input requires text parameter")
            auto_id = self._auto_confirm_target_id(action.element_id)
            if auto_id:
                command = KeyboardInputCommand(
                    element_id=auto_id,
                    text=action.text,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get("success"):
                    ext_error = self._extract_result_error(result_dict)
                    raise RuntimeError(f"Failed to input text: {ext_error}")
                return self._build_observation_from_result(
                    result_dict,
                    f"Auto-confirmed and input text to element: {auto_id}",
                    element_id=auto_id,
                )
            element_preview = self._get_element_full_html(
                action.element_id, "keyboard_input"
            )
            full_html = element_preview[0]
            screenshot = element_preview[1]
            resolved_element_id = (
                element_preview[2]
                if len(element_preview) > 2 and element_preview[2]
                else action.element_id
            )
            resolution_note = (
                element_preview[3]
                if len(element_preview) > 3 and isinstance(element_preview[3], str)
                else None
            )
            self._set_pending_confirmation(
                element_id=resolved_element_id,
                action_type="keyboard_input",
                full_html=full_html,
                extra_data={
                    "text": action.text,
                    "tab_id": action.tab_id,
                },
                screenshot_data_url=screenshot,
                requested_element_id=(
                    action.element_id
                    if resolved_element_id != action.element_id
                    else None
                ),
                element_id_resolution_note=resolution_note,
            )
            result_dict = {"success": True, "data": {}}
            message = (
                f"Keyboard input action pending confirmation for element: "
                f"{resolved_element_id}"
            )
            if resolution_note:
                message = f"{message} {resolution_note}"
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=resolved_element_id,
            )

        elif action_type == "select":
            if not action.element_id:
                raise ValueError("select requires element_id parameter")
            if action.value is None:
                raise ValueError("select requires value parameter")
            auto_id = self._auto_confirm_target_id(action.element_id)
            if auto_id:
                command = SelectElementCommand(
                    element_id=auto_id,
                    value=action.value,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id,
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get("success"):
                    ext_error = self._extract_result_error(result_dict)
                    raise RuntimeError(f"Failed to select option: {ext_error}")
                value_preview = self._format_select_value_preview(action.value)
                return self._build_observation_from_result(
                    result_dict,
                    f"Auto-confirmed and selected option {value_preview} in element: "
                    f"{auto_id}",
                    element_id=auto_id,
                )
            element_preview = self._get_element_full_html(action.element_id, "select")
            full_html = element_preview[0]
            screenshot = element_preview[1]
            resolved_element_id = (
                element_preview[2]
                if len(element_preview) > 2 and element_preview[2]
                else action.element_id
            )
            resolution_note = (
                element_preview[3]
                if len(element_preview) > 3 and isinstance(element_preview[3], str)
                else None
            )
            self._set_pending_confirmation(
                element_id=resolved_element_id,
                action_type="select",
                full_html=full_html,
                extra_data={
                    "value": action.value,
                    "tab_id": action.tab_id,
                },
                screenshot_data_url=screenshot,
                requested_element_id=(
                    action.element_id
                    if resolved_element_id != action.element_id
                    else None
                ),
                element_id_resolution_note=resolution_note,
            )
            result_dict = {"success": True, "data": {}}
            value_preview = self._format_select_value_preview(action.value)
            message = (
                f"Select action pending confirmation for element: "
                f"{resolved_element_id}. About to choose option {value_preview}."
            )
            if resolution_note:
                message = f"{message} {resolution_note}"
            return self._build_observation_from_result(
                result_dict,
                message,
                screenshot_data_url=screenshot,
                element_id=resolved_element_id,
            )

        # ========== 2PC Phase 2: Confirm Operations ==========
        elif action_type == "confirm_click":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "click":
                raise ValueError(
                    "No pending click confirmation found. Please call click first."
                )
            pending_element_id = pending.get("element_id")
            pending_extra_data = pending.get("extra_data", {})
            if not pending_element_id:
                raise ValueError(
                    "Pending click confirmation is missing element_id state."
                )
            # Execute actual click
            command = ClickElementCommand(
                element_id=pending_element_id,
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
            )

        elif action_type == "confirm_keyboard_input":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "keyboard_input":
                raise ValueError(
                    "No pending keyboard_input confirmation found. Please call keyboard_input first."
                )
            pending_element_id = pending.get("element_id")
            pending_extra_data = pending.get("extra_data", {})
            if not pending_element_id:
                raise ValueError(
                    "Pending keyboard_input confirmation is missing element_id state."
                )
            command = KeyboardInputCommand(
                element_id=pending_element_id,
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
            )

        elif action_type == "confirm_select":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "select":
                raise ValueError(
                    "No pending select confirmation found. Please call select first."
                )
            pending_element_id = pending.get("element_id")
            pending_extra_data = pending.get("extra_data", {})
            if not pending_element_id:
                raise ValueError(
                    "Pending select confirmation is missing element_id state."
                )
            pending_value = pending_extra_data.get("value")
            if pending_value is None:
                raise ValueError("Pending select confirmation is missing value state.")
            command = SelectElementCommand(
                element_id=pending_element_id,
                value=pending_value,
                conversation_id=self.conversation_id,
                tab_id=pending_extra_data.get("tab_id"),
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get("success"):
                ext_error = self._extract_result_error(result_dict)
                raise RuntimeError(f"Failed to select option: {ext_error}")
            value_preview = self._format_select_value_preview(pending_value)
            message = (
                f"Confirmed and selected option {value_preview} in element: "
                f"{pending_element_id}"
            )
            self._clear_pending_confirmation()
            return self._build_observation_from_result(
                result_dict,
                message,
                element_id=pending_element_id,
            )

        elif action_type == "confirm_drag_and_drop":
            pending = self._get_pending_confirmation()
            if not pending or pending["action_type"] != "drag_and_drop":
                raise ValueError(
                    "No pending drag_and_drop confirmation found. "
                    "Please call drag_and_drop with target_element_id first."
                )
            pending_source_id = pending.get("element_id")
            pending_extra_data = pending.get("extra_data", {})
            if not pending_source_id:
                raise ValueError(
                    "Pending drag_and_drop confirmation is missing source element_id."
                )
            target_id = pending_extra_data.get("target_element_id")
            if not target_id:
                raise ValueError(
                    "Pending drag_and_drop confirmation is missing target_element_id."
                )

            # Determine drop target: relative_to inner element or the container itself
            drop_target_id = target_id
            # "after" on the container means drop below its midpoint → append
            drop_position = "after"
            if action.relative_to:
                # Validate that relative_to is one of the previewed inner elements
                inner_elements = pending_extra_data.get("inner_elements") or []
                inner_ids = {
                    el.get("id") for el in inner_elements if isinstance(el, dict)
                }
                if action.relative_to not in inner_ids:
                    raise ValueError(
                        f"relative_to '{action.relative_to}' is not one of the "
                        f"inner elements from the drop preview. "
                        f"Valid IDs: {', '.join(sorted(inner_ids))}"
                    )
                drop_target_id = action.relative_to
                drop_position = action.position or "before"

            command = DragAndDropElementCommand(
                element_id=pending_source_id,
                target_element_id=drop_target_id,
                position=drop_position,
                steps=pending_extra_data.get("steps", 10),
                conversation_id=self.conversation_id,
                tab_id=pending_extra_data.get("tab_id"),
            )
            result_dict = self._execute_element_command(command, "drag and drop")
            if action.relative_to:
                message = (
                    f"Confirmed drag: {pending_source_id} → "
                    f"{drop_position} {action.relative_to} "
                    f"in {target_id}"
                )
            else:
                message = (
                    f"Confirmed drag: {pending_source_id} → " f"end of {target_id}"
                )
            self._clear_pending_confirmation()
            return self._build_observation_from_result(
                result_dict,
                message,
                element_id=pending_source_id,
            )

        else:
            raise ValueError(f"Invalid element interaction action: {action_type}")

    @staticmethod
    def _format_select_value_preview(value: Any) -> str:
        """Render a select `value` for inclusion in confirmation messages."""
        if isinstance(value, list):
            joined = ", ".join(f"'{v}'" for v in value)
            return f"[{joined}]"
        return f"'{value}'"

    def _denormalize_xy(
        self, x: Optional[int], y: Optional[int]
    ) -> tuple[Optional[int], Optional[int]]:
        """Convert Qwen-VL [0,1000] coords to CSS pixels using cached viewport.

        For Qwen models, the agent emits coordinates in [0,1000] normalized
        space; the server rescales using the captured viewport size before
        dispatching CDP input events. For non-Qwen models, coordinates pass
        through unchanged.

        Returns the same `(x, y)` shape — `None` for any input that was None.
        """
        if x is None and y is None:
            return (None, None)
        if not self._is_qwen_model():
            return (x, y)
        viewport = self._get_viewport()
        if viewport is None:
            # No screenshot has populated the viewport yet. Best we can do
            # is interpret coords as already-CSS pixels and let the extension
            # clamp; a warning marks this so we can audit if it happens.
            logger.warning(
                "Pixel action dispatched before any screenshot populated the "
                "viewport cache; passing coordinates through without "
                "denormalization (conversation_id=%s).",
                self.conversation_id,
            )
            return (x, y)
        vw, vh = viewport
        px = round(x * vw / 1000) if x is not None else None
        py = round(y * vh / 1000) if y is not None else None
        return (px, py)

    def _format_action_xy(
        self, x_css: Optional[int], y_css: Optional[int]
    ) -> str:
        """Render an (x, y) pair in the coordinate space the agent uses.

        For Qwen models the agent emits and reads coordinates in [0, 1000]
        normalized space, so the observation must echo back the same space
        — otherwise the agent sees a CSS-pixel value it can't reconcile with
        the input it just sent. Non-Qwen models work in CSS pixels and get
        the values unchanged.
        """
        if x_css is None or y_css is None:
            return "(?, ?)"
        if self._is_qwen_model():
            viewport = self._get_viewport()
            if viewport is not None:
                vw, vh = viewport
                if vw > 0 and vh > 0:
                    nx = round(x_css / vw * 1000)
                    ny = round(y_css / vh * 1000)
                    return f"({nx}, {ny})"
        return f"({int(x_css)}, {int(y_css)})"

    # ========== Pixel-action density gate ==========

    PIXEL_GATE_RADIUS_CSS = 30
    PIXEL_GATE_CANDIDATE_LIMIT = 5
    PIXEL_GATE_FALLBACK_RADII_CSS = (30, 100, 300)

    def _gate_pixel_target(
        self,
        x_css: int,
        y_css: int,
        radius: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Probe (x, y) for the hit element + nearby interactables.

        Returns the analysis dict from the extension on success, or None if
        the call failed (in which case the caller should fall through to the
        un-gated dispatch path so a transient analyzer error doesn't block
        the agent).
        """
        try:
            cmd = AnalyzePixelTargetsCommand(
                x=int(x_css),
                y=int(y_css),
                radius=int(radius) if radius is not None else self.PIXEL_GATE_RADIUS_CSS,
                candidate_limit=self.PIXEL_GATE_CANDIDATE_LIMIT,
                conversation_id=self.conversation_id,
            )
            result_dict = self._execute_command_sync(cmd)
        except Exception as e:
            logger.warning(
                "Pixel gate analyze failed at (%s, %s): %s",
                x_css,
                y_css,
                e,
            )
            return None
        if not isinstance(result_dict, dict) or not result_dict.get("success"):
            logger.warning(
                "Pixel gate analyze returned no success at (%s, %s): %s",
                x_css,
                y_css,
                result_dict,
            )
            return None
        data = result_dict.get("data")
        if not isinstance(data, dict):
            return None
        return data

    def _expand_gate_for_warning(
        self,
        cursor: Optional[tuple[int, int]],
        initial_gate: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Re-probe with progressively larger radii so the no-op warning
        always carries at least one interactable hint when the page has any.

        The pre-click density gate uses a tight 30px radius (sized for the
        dense/sparse verdict). After a click no-op, a completely empty
        neighborhood is unhelpful — the agent learns nothing about where
        the nearest clickable target actually is. Expand to 100, then 300,
        and return the first probe that surfaces candidates.
        """
        if cursor is None:
            return initial_gate
        if initial_gate and (initial_gate.get("neighborhood") or []):
            return initial_gate
        for radius in self.PIXEL_GATE_FALLBACK_RADII_CSS:
            if radius == self.PIXEL_GATE_RADIUS_CSS and initial_gate is not None:
                continue
            probe = self._gate_pixel_target(cursor[0], cursor[1], radius=radius)
            if probe and (probe.get("neighborhood") or []):
                return probe
        return initial_gate

    def _serialize_pixel_candidates(
        self,
        candidates: list,
        vw: int,
        vh: int,
    ) -> list:
        """Convert extension candidate dicts to a Qwen-normalized payload.

        Forwards the full element shape that the highlight observation uses
        (tagName, descriptor, interactionHints, etc.) so the message renderer
        can reuse `_format_highlighted_element_lines` and surface the same
        structured signal as the element-paradigm inventory. Adds Qwen-norm
        bbox / center coordinates so the agent can re-aim a `move` + `click`
        directly without converting pixels.
        """
        out = []
        if vw <= 0 or vh <= 0:
            return out
        for c in candidates or []:
            bbox = c.get("bbox") or {}
            try:
                bx = float(bbox.get("x", 0))
                by = float(bbox.get("y", 0))
                bw = float(bbox.get("width", 0))
                bh = float(bbox.get("height", 0))
            except (TypeError, ValueError):
                continue
            html = c.get("html") or ""
            if isinstance(html, str) and len(html) > 512:
                html = html[:509] + "..."
            cx = bx + bw / 2
            cy = by + bh / 2
            out.append(
                {
                    # Element fields (shape compatible with
                    # `_format_highlighted_element_lines`).
                    "tagName": c.get("tagName"),
                    "type": c.get("type"),
                    "interactionHints": c.get("interactionHints") or [],
                    "text": c.get("text"),
                    "descriptor": c.get("descriptor") or {},
                    # Pixel-paradigm extras: structured coords + truncated
                    # HTML snippet for grounding without re-querying.
                    "html": html,
                    "selector": c.get("selector"),
                    "bbox_css": {
                        "x": int(bx),
                        "y": int(by),
                        "width": int(bw),
                        "height": int(bh),
                    },
                    "bbox_norm": {
                        "x": round(bx / vw * 1000),
                        "y": round(by / vh * 1000),
                        "w": round(bw / vw * 1000),
                        "h": round(bh / vh * 1000),
                    },
                    "center_norm": {
                        "x": round(cx / vw * 1000),
                        "y": round(cy / vh * 1000),
                    },
                    "distance_css": c.get("distance"),
                }
            )
        return out

    def _format_pixel_candidates_block(
        self,
        candidates: list,
        header: str = "Nearby candidates",
    ) -> str:
        """Render candidates the way the old highlight observation does.

        Reuses `_format_highlighted_element_lines` so the agent reads the
        same descriptor-first wording (`<button>"Search" · type=submit`)
        the element paradigm produced. Appends each candidate's center in
        [0, 1000] space to the header line so the agent can feed the value
        directly back into `move`.

        Decorative wrappers often have empty descriptor fields; if the
        renderer produces a bare `<tag>` line with no text or attrs, fall
        back to a truncated HTML snippet so the agent at least sees class
        names / ids / inline attributes to ground on.
        """
        if not candidates:
            return ""
        from server.agent.tools.base import _format_highlighted_element_lines

        lines: list[str] = [header + ":"]
        for i, c in enumerate(candidates, 1):
            display_id = str(i)
            element_lines = _format_highlighted_element_lines(display_id, c)
            if not element_lines:
                continue

            # Detect "bare tag" rendering: the formatter emits no
            # segments after the opening `<tag>` so the line ends with
            # `>`. In that case the agent has nothing to disambiguate
            # this candidate from any other plain wrapper.
            if element_lines[0].rstrip().endswith(">"):
                snippet = self._html_snippet_for_candidate(c)
                if snippet:
                    element_lines[0] = f"{element_lines[0]} · {snippet}"

            cn = c.get("center_norm") or {}
            cx = cn.get("x")
            cy = cn.get("y")
            if cx is not None and cy is not None:
                element_lines[0] = f"{element_lines[0]}  → center=({cx}, {cy})"
            dist = c.get("distance_css")
            if isinstance(dist, (int, float)):
                element_lines[0] = f"{element_lines[0]}  · dist={int(round(dist))}px"
            lines.extend(element_lines)
        return "\n".join(lines)

    @staticmethod
    def _html_snippet_for_candidate(c: Dict[str, Any]) -> str:
        """Build a short single-line HTML snippet for a candidate.

        Used when the descriptor lacks meaningful text/name/class hints.
        Collapses whitespace and truncates so a long `<div class="...">`
        gloss doesn't blow the message budget.
        """
        html = c.get("html") or ""
        if not isinstance(html, str) or not html:
            selector = c.get("selector") or ""
            if isinstance(selector, str) and selector:
                return f"selector={selector!r}"
            return ""
        snippet = " ".join(html.split())
        # Strip the trailing close tag for compactness — the agent only
        # needs the opening attributes to identify the element.
        close_idx = snippet.find(">")
        if 0 < close_idx < 200:
            snippet = snippet[: close_idx + 1]
        if len(snippet) > 160:
            snippet = snippet[:157] + "..."
        return snippet

    def _render_pixel_preview(
        self,
        mode: str,
        x_css: int,
        y_css: int,
        target_bbox: Optional[Dict[str, Any]],
        candidate_bboxes: Optional[list],
        target_selector: Optional[str] = None,
        candidate_selectors: Optional[list] = None,
        banner_kind: Optional[str] = None,
        drag_end: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """Ask the extension to render a confirmation crop.

        Selectors and `banner_kind` enable the extension to draw the
        same yellow/orange overlay directly on the live page DOM (so a
        human watching the browser sees what the agent sees) before the
        screenshot capture. The crop is always returned for the agent.

        Returns the data URL on success, or None on failure (caller should
        gracefully proceed without a preview rather than block).
        """
        try:
            cmd = RenderPixelConfirmCommand(
                mode=mode,
                x=int(x_css),
                y=int(y_css),
                target_bbox=target_bbox,
                candidate_bboxes=candidate_bboxes,
                target_selector=target_selector,
                candidate_selectors=candidate_selectors,
                banner_kind=banner_kind,
                drag_end=drag_end,
                conversation_id=self.conversation_id,
            )
            result_dict = self._execute_command_sync(cmd)
        except Exception as e:
            logger.warning("Pixel preview render failed: %s", e)
            return None
        if not isinstance(result_dict, dict) or not result_dict.get("success"):
            logger.warning("Pixel preview render returned no success: %s", result_dict)
            return None
        data = result_dict.get("data") or {}
        url = data.get("screenshot_data_url")
        if isinstance(url, str) and url.startswith("data:"):
            return url
        return None

    def _build_pixel_gate_message(
        self,
        kind: str,
        verdict: str,
        hit: Optional[Dict[str, Any]],
        candidates: list,
        drag_endpoints: Optional[Dict[str, str]] = None,
    ) -> str:
        """Compose the human-readable confirmation message for the agent.

        Kept terse on purpose: the preview screenshot already shows the
        yellow target and orange neighbors visually at original size, so
        the message contributes only the candidate list (HTML + centers)
        and one-line guidance.
        """
        lines: list[str] = []
        if kind == "click":
            if hit:
                lines.append(
                    "Click previewed on the yellow target. Confirm to "
                    "commit, or re-emit `click` with one of the candidate "
                    "centers below."
                )
            else:
                lines.append(
                    "No element under the cursor — re-emit `click` with one "
                    "of the candidate centers below."
                )
        elif kind == "drag":
            note = ""
            if drag_endpoints:
                note = (
                    f" (start={drag_endpoints.get('start', 'unknown')}, "
                    f"end={drag_endpoints.get('end', 'unknown')})"
                )
            lines.append(
                "Drag previewed" + note + ". Confirm to commit, or re-emit "
                "`drag` with corrected endpoints."
            )
        block = self._format_pixel_candidates_block(
            candidates,
            header="Nearby candidates (centers in [0,1000] space)",
        )
        if block:
            lines.append(block)
        return "\n".join(lines)

    def _gate_pixel_click(
        self,
        action: MouseAction,
        cursor: tuple[int, int],
        gate: Dict[str, Any],
    ) -> OpenBrowserObservation:
        """Stash a pending click and return a confirmation preview observation."""
        cx, cy = cursor
        viewport = self._get_viewport() or (
            int(gate.get("viewport", {}).get("width") or 0),
            int(gate.get("viewport", {}).get("height") or 0),
        )
        vw, vh = viewport
        hit = gate.get("hit") if isinstance(gate.get("hit"), dict) else None
        neighborhood = gate.get("neighborhood") or []
        candidates = self._serialize_pixel_candidates(neighborhood, vw, vh)
        candidate_bboxes = [
            c["bbox"] for c in neighborhood if isinstance(c.get("bbox"), dict)
        ]
        candidate_selectors = [
            c.get("selector")
            for c in neighborhood
            if isinstance(c.get("selector"), str)
        ]
        target_bbox = (
            hit.get("bbox") if hit and isinstance(hit.get("bbox"), dict) else None
        )
        target_selector = (
            hit.get("selector")
            if hit and isinstance(hit.get("selector"), str)
            else None
        )

        preview_url = self._render_pixel_preview(
            mode="pixel_hit" if hit else "pixel_miss",
            x_css=cx,
            y_css=cy,
            target_bbox=target_bbox,
            candidate_bboxes=candidate_bboxes,
            target_selector=target_selector,
            candidate_selectors=candidate_selectors,
            banner_kind="click",
        )

        message = self._build_pixel_gate_message(
            kind="click",
            verdict="dense",
            hit=hit,
            candidates=candidates,
        )

        self._set_pending_confirmation(
            element_id="",
            action_type="mouse_click_pixel",
            full_html=(hit.get("html") if hit else "") or "",
            extra_data={
                "px": cx,
                "py": cy,
                "button": action.button,
                "count": action.count,
                "candidates": candidates,
                "hit_selector": hit.get("selector") if hit else None,
            },
            screenshot_data_url=preview_url,
        )

        return OpenBrowserObservation(
            success=True,
            message=message,
            screenshot_data_url=preview_url,
            small_model=self._uses_small_model(),
        )

    def _gate_pixel_drag(
        self,
        action: MouseAction,
        start_css: tuple[int, int],
        end_css: tuple[int, int],
        start_gate: Optional[Dict[str, Any]],
        end_gate: Optional[Dict[str, Any]],
        start_dense: bool,
        end_dense: bool,
    ) -> OpenBrowserObservation:
        """Stash a pending drag and return a confirmation preview observation."""
        sx, sy = start_css
        ex, ey = end_css
        viewport = self._get_viewport()
        if viewport is None:
            gate_for_viewport = start_gate or end_gate or {}
            viewport = (
                int(gate_for_viewport.get("viewport", {}).get("width") or 0),
                int(gate_for_viewport.get("viewport", {}).get("height") or 0),
            )
        vw, vh = viewport

        # Pick which endpoint to feature in the preview: prefer the dense one;
        # if both are dense, prefer the start (the drag's source matters more
        # for slider/handle grabs).
        focus_gate = start_gate if start_dense else end_gate
        focus_x, focus_y = (sx, sy) if start_dense else (ex, ey)
        drag_end_point = {"x": ex, "y": ey} if start_dense else {"x": sx, "y": sy}

        focus_hit = (
            focus_gate.get("hit")
            if focus_gate and isinstance(focus_gate.get("hit"), dict)
            else None
        )
        focus_neighborhood = (focus_gate or {}).get("neighborhood") or []
        candidates = self._serialize_pixel_candidates(focus_neighborhood, vw, vh)
        candidate_bboxes = [
            c["bbox"] for c in focus_neighborhood if isinstance(c.get("bbox"), dict)
        ]
        candidate_selectors = [
            c.get("selector")
            for c in focus_neighborhood
            if isinstance(c.get("selector"), str)
        ]
        target_bbox = (
            focus_hit.get("bbox")
            if focus_hit and isinstance(focus_hit.get("bbox"), dict)
            else None
        )
        target_selector = (
            focus_hit.get("selector")
            if focus_hit and isinstance(focus_hit.get("selector"), str)
            else None
        )

        preview_url = self._render_pixel_preview(
            mode="pixel_hit" if focus_hit else "pixel_miss",
            x_css=focus_x,
            y_css=focus_y,
            target_bbox=target_bbox,
            candidate_bboxes=candidate_bboxes,
            target_selector=target_selector,
            candidate_selectors=candidate_selectors,
            banner_kind="drag",
            drag_end=drag_end_point,
        )

        endpoints = {
            "start": "dense" if start_dense else "sparse",
            "end": "dense" if end_dense else "sparse",
        }
        message = self._build_pixel_gate_message(
            kind="drag",
            verdict="dense",
            hit=focus_hit,
            candidates=candidates,
            drag_endpoints=endpoints,
        )

        self._set_pending_confirmation(
            element_id="",
            action_type="mouse_drag_pixel",
            full_html=(focus_hit.get("html") if focus_hit else "") or "",
            extra_data={
                "sx": sx,
                "sy": sy,
                "ex": ex,
                "ey": ey,
                "button": action.button,
                "steps": action.steps,
                "candidates": candidates,
                "endpoints": endpoints,
            },
            screenshot_data_url=preview_url,
        )

        return OpenBrowserObservation(
            success=True,
            message=message,
            screenshot_data_url=preview_url,
            small_model=self._uses_small_model(),
        )

    def _commit_pending_pixel_action(self) -> OpenBrowserObservation:
        """Commit a pending pixel click or drag stashed by the gate."""
        pending = self._get_pending_confirmation()
        if not pending:
            return OpenBrowserObservation(
                success=False,
                error=(
                    "No pending pixel action to confirm. Emit `move` + `click` "
                    "or `drag` first; `confirm` is only valid right after a "
                    "gated preview."
                ),
                small_model=self._uses_small_model(),
            )

        # No explicit clear needed: the actual mouse_click / mouse_drag
        # dispatched below routes through the extension's pixel-action
        # case, which clears the gated-preview overlay at its top.

        action_type = pending.get("action_type")
        extra = pending.get("extra_data") or {}

        try:
            if action_type == "mouse_click_pixel":
                button = extra.get("button", "left")
                count = int(extra.get("count", 1))
                command = MouseClickCommand(
                    button=MouseButton(button),
                    count=count,
                    double=(count == 2),
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                self._clear_pending_confirmation()
                message = (
                    f"Confirmed click {button} at "
                    f"{self._format_action_xy(extra.get('px'), extra.get('py'))} "
                    f"(count={count})"
                )
                intercepted = self._extract_intercepted_form_control(result_dict)
                if intercepted:
                    message = self._format_intercepted_message(
                        intercepted, button, count
                    )
                elif self._click_was_a_no_op(result_dict):
                    serialized = extra.get("candidates") or []
                    message += self._format_no_op_warning_from_candidates(serialized)
                    # Same overlay as the direct-click path so the live
                    # page visually surfaces the candidates the agent was
                    # given as alternatives.
                    px, py = extra.get("px"), extra.get("py")
                    if isinstance(px, int) and isinstance(py, int):
                        self._draw_no_op_overlay_from_serialized((px, py), serialized)
                return self._build_observation_from_result(result_dict, message)

            if action_type == "mouse_drag_pixel":
                sx = extra.get("sx")
                sy = extra.get("sy")
                ex = extra.get("ex")
                ey = extra.get("ey")
                button = extra.get("button", "left")
                steps = int(extra.get("steps", 10))
                if None in (sx, sy, ex, ey):
                    raise ValueError("Pending drag is missing endpoint coordinates.")
                command = MouseDragCommand(
                    start_x=int(sx),
                    start_y=int(sy),
                    end_x=int(ex),
                    end_y=int(ey),
                    button=MouseButton(button),
                    steps=steps,
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                self._clear_pending_confirmation()
                self._cache_cursor(int(ex), int(ey))
                return self._build_observation_from_result(
                    result_dict,
                    f"Confirmed drag from {self._format_action_xy(sx, sy)} "
                    f"to {self._format_action_xy(ex, ey)}",
                )

            self._clear_pending_confirmation()
            return OpenBrowserObservation(
                success=False,
                error=(
                    f"Pending action type {action_type!r} is not a pixel "
                    "action. `confirm` only commits gated `mouse` previews."
                ),
                small_model=self._uses_small_model(),
            )
        except Exception as e:
            logger.error("Failed to commit pending pixel action: %s", e, exc_info=True)
            self._clear_pending_confirmation()
            return OpenBrowserObservation(
                success=False, error=str(e), small_model=self._uses_small_model()
            )

    def _execute_mouse_action(self, action: MouseAction) -> OpenBrowserObservation:
        """Execute one mouse action (move/click/drag/scroll/reset).

        Coordinates from Qwen models are in [0, 1000] normalized space and are
        denormalized to CSS pixels using the most recent viewport captured
        from a screenshot. Non-Qwen models pass through.
        """
        kind = action.action
        logger.debug(f"DEBUG: _execute_mouse_action kind={kind}")

        # Overlay teardown lives in the extension's pixel-action dispatcher
        # so every incoming agent action — mouse, keyboard, select, upload —
        # clears any leftover overlay before running. No server-side clear
        # needed here.

        try:
            if kind == "move":
                if not action.coordinate:
                    raise ValueError("mouse move requires `coordinate: [x, y]`")
                px, py = self._denormalize_xy(
                    action.coordinate[0], action.coordinate[1]
                )
                command = MouseMoveCommand(
                    x=px, y=py, conversation_id=self.conversation_id
                )
                result_dict = self._execute_command_sync(command)
                if px is not None and py is not None:
                    self._cache_cursor(px, py)
                return self._build_observation_from_result(
                    result_dict, f"Mouse moved to {self._format_action_xy(px, py)}"
                )

            if kind == "click":
                # `click coordinate=[x, y]` is move-then-click in one call.
                # With `coordinate` supplied, slide the cursor there, cache
                # it, and run the gate against that fresh position. Without
                # `coordinate`, click at the cursor's current position
                # (hover-then-click flows).
                if action.coordinate is not None:
                    px, py = self._denormalize_xy(
                        action.coordinate[0], action.coordinate[1]
                    )
                    move_command = MouseMoveCommand(
                        x=px, y=py, conversation_id=self.conversation_id
                    )
                    self._execute_command_sync(move_command)
                    if px is not None and py is not None:
                        self._cache_cursor(px, py)
                cursor = self._get_cursor_or_center()
                gate = (
                    self._gate_pixel_target(cursor[0], cursor[1])
                    if cursor is not None
                    else None
                )
                if gate and gate.get("verdict") == "dense" and cursor is not None:
                    return self._gate_pixel_click(action, cursor, gate)

                command = MouseClickCommand(
                    button=MouseButton(action.button),
                    count=action.count,
                    double=(action.count == 2),
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                cx, cy = cursor or (None, None)
                where = (
                    self._format_action_xy(cx, cy)
                    if cx is not None and cy is not None
                    else "the cursor"
                )
                count_note = f", count={action.count}" if action.count != 1 else ""
                message = f"Clicked {action.button} at {where}{count_note}."
                intercepted = self._extract_intercepted_form_control(result_dict)
                if intercepted:
                    message = self._format_intercepted_message(
                        intercepted, action.button, action.count
                    )
                elif self._click_was_a_no_op(result_dict):
                    gate = self._expand_gate_for_warning(cursor, gate)
                    message += self._format_no_op_warning(gate)
                    # Draw orange-dashed candidates on the live page so a
                    # human watching the browser sees what the agent is
                    # told to re-aim at. Cleared on the agent's next
                    # mouse action via clear_pixel_overlay.
                    self._draw_no_op_overlay(cursor, gate)
                return self._build_observation_from_result(result_dict, message)

            if kind == "drag":
                if not action.start_coordinate or not action.end_coordinate:
                    raise ValueError(
                        "mouse drag requires `start_coordinate: [x, y]` "
                        "and `end_coordinate: [x, y]`"
                    )
                sx, sy = self._denormalize_xy(
                    action.start_coordinate[0], action.start_coordinate[1]
                )
                ex, ey = self._denormalize_xy(
                    action.end_coordinate[0], action.end_coordinate[1]
                )

                start_gate = self._gate_pixel_target(sx, sy)
                end_gate = self._gate_pixel_target(ex, ey)
                start_dense = bool(start_gate and start_gate.get("verdict") == "dense")
                end_dense = bool(end_gate and end_gate.get("verdict") == "dense")
                if start_dense or end_dense:
                    return self._gate_pixel_drag(
                        action,
                        (sx, sy),
                        (ex, ey),
                        start_gate,
                        end_gate,
                        start_dense,
                        end_dense,
                    )

                command = MouseDragCommand(
                    start_x=sx,
                    start_y=sy,
                    end_x=ex,
                    end_y=ey,
                    button=MouseButton(action.button),
                    steps=action.steps,
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                if ex is not None and ey is not None:
                    self._cache_cursor(ex, ey)
                start_str = self._format_action_xy(sx, sy)
                end_str = self._format_action_xy(ex, ey)
                return self._build_observation_from_result(
                    result_dict, f"Dragged from {start_str} to {end_str}"
                )

            if kind == "scroll":
                command = MouseScrollCommand(
                    direction=ScrollDirection(action.direction),
                    amount=action.amount,
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                return self._build_observation_from_result(
                    result_dict,
                    f"Scrolled {action.direction} by {action.amount}px",
                )

            if kind == "reset":
                command = ResetMouseCommand(conversation_id=self.conversation_id)
                result_dict = self._execute_command_sync(command)
                viewport = self._get_viewport()
                if viewport is not None:
                    self._cache_cursor(viewport[0] // 2, viewport[1] // 2)
                return self._build_observation_from_result(
                    result_dict, "Reset cursor to viewport center"
                )

            if kind == "confirm":
                return self._commit_pending_pixel_action()

            raise ValueError(f"Unknown mouse action: {kind}")
        except Exception as e:
            logger.error(f"Mouse action failed (kind={kind}): {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False, error=str(e), small_model=self._uses_small_model()
            )

    # Keys where Control on Windows/Linux maps to Cmd (Meta) on macOS.
    # Excludes navigation/cursor combos (arrows, Home/End) since those have
    # different semantics on macOS that can't be remapped 1:1.
    _MAC_REMAP_KEYS = {
        "a", "c", "v", "x", "z", "y", "s", "f", "g",
        "p", "n", "t", "w", "r", "l", "+", "-", "0",
    }

    @classmethod
    def _maybe_remap_for_host(
        cls, key: str, modifiers: List[str]
    ) -> Tuple[List[str], Optional[str]]:
        """Translate Control+<shortcut-key> → Meta+<shortcut-key> on macOS.

        Returns (modifiers, note). `note` is a short human-readable string
        describing what swapped, suitable for appending to the observation
        message so the agent learns the actual keys that hit the page.
        """
        if sys.platform != "darwin" or not modifiers or not key:
            return modifiers, None
        if key.lower() not in cls._MAC_REMAP_KEYS:
            return modifiers, None
        if "Control" not in modifiers:
            return modifiers, None
        new_mods = ["Meta" if m == "Control" else m for m in modifiers]
        before = "+".join(modifiers + [key])
        after = "+".join(new_mods + [key])
        note = f"(remapped {before} to {after} on macOS)"
        return new_mods, note

    def _execute_keyboard_action(
        self, action: KeyboardAction
    ) -> OpenBrowserObservation:
        """Execute one keyboard action (type/press/clear)."""
        kind = action.action
        logger.debug(f"DEBUG: _execute_keyboard_action kind={kind}")

        try:
            if kind == "type":
                if not action.text:
                    raise ValueError("keyboard type requires text")
                command = KeyboardTypeCommand(
                    text=action.text, conversation_id=self.conversation_id
                )
                result_dict = self._execute_command_sync(command)
                preview = (
                    action.text if len(action.text) <= 32 else action.text[:29] + "..."
                )
                detail = (result_dict or {}).get("data", {}) or {}
                # Older extension builds don't emit `typed`; treat missing as
                # success so we don't false-warn during a rolling upgrade.
                typed = detail.get("typed")
                if typed is False:
                    reason = detail.get("reason") or "no editable element focused"
                    msg = (
                        f"Type had no effect ({reason}). Click into the "
                        f"target input field first, then type."
                    )
                    obs = self._build_observation_from_result(result_dict, msg)
                    return obs.model_copy(update={"success": False})
                target = detail.get("target")
                target_note = f" into {target}" if isinstance(target, str) and target else ""
                return self._build_observation_from_result(
                    result_dict, f"Typed text: {preview!r}{target_note}"
                )

            if kind == "press":
                if not action.key:
                    raise ValueError("keyboard press requires key")
                modifiers = list(action.modifiers or [])
                remap_note: Optional[str] = None
                if not action.literal:
                    modifiers, remap_note = self._maybe_remap_for_host(
                        action.key, modifiers
                    )
                if remap_note:
                    logger.info("Keyboard press %s", remap_note)
                command = KeyboardPressCommand(
                    key=action.key,
                    modifiers=modifiers,
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                mod_text = f" with {'+'.join(modifiers)}" if modifiers else ""
                msg = f"Pressed {action.key}{mod_text}"
                if remap_note:
                    msg = f"{msg} {remap_note}"
                return self._build_observation_from_result(result_dict, msg)

            if kind == "clear":
                # JS-based clear on document.activeElement: set value /
                # textContent to empty and dispatch input + change events.
                # Reports SUCCESS only when the focused element actually
                # ended up empty. The previous select-all + Backspace path
                # used Ctrl+A which silently no-ops on macOS where Cmd is
                # the select-all modifier, leaving stale text in the field.
                command = KeyboardClearCommand(
                    conversation_id=self.conversation_id,
                )
                result_dict = self._execute_command_sync(command)
                detail = (result_dict or {}).get("data", {}) or {}
                cleared = bool(detail.get("cleared"))
                target = detail.get("target") or "focused field"
                if cleared:
                    msg = f"Cleared {target}"
                else:
                    reason = detail.get("reason") or "no editable element focused"
                    msg = (
                        f"Clear had no effect ({reason}). "
                        "Click into the field first, then clear."
                    )
                obs = self._build_observation_from_result(result_dict, msg)
                if not cleared:
                    obs = obs.model_copy(update={"success": False})
                return obs

            raise ValueError(f"Unknown keyboard action: {kind}")
        except Exception as e:
            logger.error(f"Keyboard action failed (kind={kind}): {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False, error=str(e), small_model=self._uses_small_model()
            )

    def _draw_no_op_overlay(
        self,
        cursor: Optional[tuple[int, int]],
        gate: Optional[Dict[str, Any]],
    ) -> None:
        """Inject orange-dashed candidate boxes onto the live page for the
        no-op case. Mirrors the gated-preview overlay so a human watching
        the browser sees the same alternatives the agent is told to re-aim
        at. Best-effort: failures are logged and swallowed.
        """
        if cursor is None or not gate:
            return
        neighborhood = gate.get("neighborhood") or []
        if not neighborhood:
            return
        candidate_selectors: list = []
        candidate_bboxes: list = []
        for c in neighborhood:
            if not isinstance(c, dict):
                continue
            sel = c.get("selector")
            bbox = c.get("bbox") if isinstance(c.get("bbox"), dict) else None
            if isinstance(sel, str):
                candidate_selectors.append(sel)
            if bbox:
                candidate_bboxes.append(bbox)
        if not candidate_selectors and not candidate_bboxes:
            return
        try:
            self._render_pixel_preview(
                mode="pixel_miss",
                x_css=cursor[0],
                y_css=cursor[1],
                target_bbox=None,
                candidate_bboxes=candidate_bboxes,
                target_selector=None,
                candidate_selectors=candidate_selectors,
                banner_kind=None,
            )
        except Exception as e:
            logger.debug("no-op overlay render failed: %s", e)

    def _draw_no_op_overlay_from_serialized(
        self,
        cursor: Optional[tuple[int, int]],
        candidates: list,
    ) -> None:
        """Same as `_draw_no_op_overlay` but takes pre-serialized candidates
        (the form stashed in `extra_data` for confirm-path commits)."""
        if cursor is None or not candidates:
            return
        candidate_selectors: list = []
        candidate_bboxes: list = []
        for c in candidates:
            if not isinstance(c, dict):
                continue
            sel = c.get("selector")
            bbox = c.get("bbox_css")
            if isinstance(sel, str):
                candidate_selectors.append(sel)
            if isinstance(bbox, dict):
                candidate_bboxes.append(bbox)
        if not candidate_selectors and not candidate_bboxes:
            return
        try:
            self._render_pixel_preview(
                mode="pixel_miss",
                x_css=cursor[0],
                y_css=cursor[1],
                target_bbox=None,
                candidate_bboxes=candidate_bboxes,
                target_selector=None,
                candidate_selectors=candidate_selectors,
                banner_kind=None,
            )
        except Exception as e:
            logger.debug("no-op overlay render failed: %s", e)

    def _format_no_op_warning(self, gate: Optional[Dict[str, Any]]) -> str:
        """Warning text for a click that committed but produced no DOM change.

        When `gate` carries a neighborhood from the pixel-target probe, the
        nearby interactable elements are listed so the agent has somewhere
        concrete to re-aim at. Empty-space clicks otherwise leave the agent
        with no signal beyond "it didn't work."
        """
        candidates: list = []
        if gate:
            neighborhood = gate.get("neighborhood") or []
            viewport = gate.get("viewport") or {}
            vw = int(viewport.get("width") or 0)
            vh = int(viewport.get("height") or 0)
            if not vw or not vh:
                vp = self._get_viewport()
                if vp is not None:
                    vw, vh = vp
            candidates = self._serialize_pixel_candidates(neighborhood, vw, vh)
        return self._format_no_op_warning_from_candidates(candidates)

    def _format_no_op_warning_from_candidates(self, candidates: list) -> str:
        """Render the no-op warning + candidate block from pre-serialized data."""
        lines = [
            "",
            "⚠ The click produced no DOM change. The element may be "
            "disabled, behind a modal, off-screen, or non-interactable. "
            "Re-clicking the same spot will not help — re-aim at one of "
            "the nearby interactable elements below, scroll the target "
            "into view, or focus a different control.",
        ]
        block = self._format_pixel_candidates_block(
            candidates,
            header="Nearby interactable elements (centers in [0,1000] space)",
        )
        if block:
            lines.append(block)
        else:
            lines[-1] = (
                "⚠ The click produced no DOM change and no nearby "
                "interactable element was detected. Scroll the target "
                "into view or pick a different region of the screen."
            )
        return "\n".join(lines)

    @staticmethod
    def _click_was_a_no_op(result_dict: Optional[Dict[str, Any]]) -> bool:
        """True iff the extension's post-click probe saw zero DOM mutations.

        A MutationObserver is armed before the CDP click and read ~250ms
        after — `triggered_anything: false` means the observer recorded
        zero non-cursor mutations during that window, i.e. the click did
        nothing the page reacted to. Any other shape (including a probe
        failure) is treated as "did something" so we never warn falsely.
        """
        if not result_dict:
            return False
        data = result_dict.get("data")
        if isinstance(data, dict) and "triggered_anything" in data:
            return data.get("triggered_anything") is False
        if "triggered_anything" in result_dict:
            return result_dict.get("triggered_anything") is False
        return False

    @staticmethod
    def _extract_intercepted_form_control(
        result_dict: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Pull `intercepted_form_control` out of the click wire response.

        The extension wraps pixel-action details under `data` (keyed
        alongside the screenshot). Returns the descriptor dict, or None
        if the click was a normal click that fell through.
        """
        if not result_dict:
            return None
        data = result_dict.get("data")
        if isinstance(data, dict):
            ifc = data.get("intercepted_form_control")
            if isinstance(ifc, dict):
                return ifc
        ifc = result_dict.get("intercepted_form_control")
        if isinstance(ifc, dict):
            return ifc
        return None

    @staticmethod
    def _format_intercepted_message(
        ifc: Dict[str, Any], button: str, count: int
    ) -> str:
        """Render a human-readable observation when click hit a native control.

        Lists every option for `<select>` so the agent can pick one with
        `select_option`. For file inputs, names the input and reminds the
        agent to call `upload_file`.
        """
        kind = ifc.get("kind")
        name = (ifc.get("name") or "").strip()
        aria = (ifc.get("ariaLabel") or "").strip()
        ident = " ".join(
            f"{k}={v!r}" for k, v in (("name", name), ("aria-label", aria)) if v
        )
        ident_suffix = f" ({ident})" if ident else ""
        if kind == "select":
            multiple = bool(ifc.get("multiple"))
            options = ifc.get("options") or []
            if not isinstance(options, list):
                options = []
            lines = []
            for o in options:
                if not isinstance(o, dict):
                    continue
                value = o.get("value", "")
                label = (o.get("label") or "").strip()
                tags = []
                if o.get("selected"):
                    tags.append("selected")
                if o.get("disabled"):
                    tags.append("disabled")
                tag_str = f" [{', '.join(tags)}]" if tags else ""
                lines.append(f"  - value={value!r} label={label!r}{tag_str}")
            options_block = "\n".join(lines) if lines else "  (no options found)"
            kind_word = "multi-select" if multiple else "select"
            return (
                f"Clicked {button} on a native <{kind_word}>{ident_suffix}; "
                f"the OS dropdown does not render in screenshots, so the "
                f"options are listed below. Pick one or more by calling "
                f"`select_option` with the desired `value` or label.\n"
                f"options:\n{options_block}"
            )
        if kind == "file":
            accept = (ifc.get("accept") or "").strip()
            multiple = bool(ifc.get("multiple"))
            extras = []
            if accept:
                extras.append(f"accept={accept!r}")
            if multiple:
                extras.append("multiple")
            extras_str = f" ({', '.join(extras)})" if extras else ""
            return (
                f"Clicked {button} on a native <input type=file>"
                f"{ident_suffix}{extras_str}; the OS file picker does not "
                f"render in screenshots. Call `upload_file` with the "
                f"absolute path(s) to attach the file(s)."
            )
        # Unknown kind — fall back to the plain click message but include the
        # raw kind so the agent isn't completely blind.
        return (
            f"Clicked {button} at the cursor (count={count}); intercepted "
            f"native control of unknown kind={kind!r}"
        )

    def _execute_select_option_action(
        self, action: SelectOptionAction
    ) -> OpenBrowserObservation:
        """Pick option(s) on the `<select>` focused by the previous click."""
        try:
            command = SelectOptionCommand(
                values=list(action.values),
                conversation_id=self.conversation_id,
            )
            result_dict = self._execute_command_sync(command)
            preview = ", ".join(action.values[:3])
            if len(action.values) > 3:
                preview += f", … ({len(action.values)} total)"
            message = self._format_select_option_message(
                result_dict, action.values, preview
            )
            return self._build_observation_from_result(result_dict, message)
        except Exception as e:
            logger.error(f"select_option failed: {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False, error=str(e), small_model=self._uses_small_model()
            )

    @staticmethod
    def _format_select_option_message(
        result_dict: Optional[Dict[str, Any]],
        values: list,
        preview: str,
    ) -> str:
        """Surface select_option outcomes (success, missing target, no match)."""
        data = (result_dict or {}).get("data") or {}
        ok = data.get("ok")
        err = data.get("error")
        if ok is False or err:
            if err == "no_pending_select":
                return (
                    "select_option had no pending target. Click a native "
                    "`<select>` first — its options are listed in that "
                    "click's observation — then call select_option."
                )
            if err == "option_not_found":
                wanted = data.get("wanted") or ", ".join(values)
                avail = data.get("available") or []
                shown = avail[:30]
                avail_block = "\n".join(f"  - {label!r}" for label in shown)
                if len(avail) > len(shown):
                    avail_block += f"\n  …({len(avail) - len(shown)} more)"
                return (
                    f"select_option could not match {wanted!r}. Available "
                    f"option labels:\n{avail_block}"
                )
            return f"select_option failed: {err!r}"
        selected = data.get("selected") or values
        sel_preview = ", ".join(str(s) for s in selected[:3])
        if len(selected) > 3:
            sel_preview += f", … ({len(selected)} total)"
        return f"Selected option(s): {sel_preview} (requested: {preview})"

    def _execute_upload_file_action(
        self, action: UploadFileAction
    ) -> OpenBrowserObservation:
        """Attach file(s) to the file input focused by the previous click."""
        try:
            command = UploadFilePendingCommand(
                paths=list(action.paths),
                conversation_id=self.conversation_id,
            )
            result_dict = self._execute_command_sync(command)
            preview = ", ".join(action.paths[:2])
            if len(action.paths) > 2:
                preview += f", … ({len(action.paths)} total)"
            message = self._format_upload_file_message(
                result_dict, action.paths, preview
            )
            return self._build_observation_from_result(result_dict, message)
        except Exception as e:
            logger.error(f"upload_file failed: {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False, error=str(e), small_model=self._uses_small_model()
            )

    @staticmethod
    def _format_upload_file_message(
        result_dict: Optional[Dict[str, Any]],
        paths: list,
        preview: str,
    ) -> str:
        """Surface upload_file outcomes."""
        data = (result_dict or {}).get("data") or {}
        ok = data.get("ok")
        err = data.get("error")
        if ok is False or err:
            if err == "no_pending_file_input":
                return (
                    "upload_file had no pending target. Click an "
                    "<input type=file> (or its visible label/button) "
                    "first, then call upload_file."
                )
            return f"upload_file failed: {err!r}"
        return f"Uploaded file(s): {preview}"

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

    @staticmethod
    def _format_highlight_element_label(element_type: str, count: int) -> str:
        """Format highlight result labels without repeating pagination metadata."""
        singular_label = (
            "interactive element"
            if element_type == "any"
            else f"{element_type} element"
        )
        plural_label = (
            "interactive elements"
            if element_type == "any"
            else f"{element_type} elements"
        )
        return singular_label if count == 1 else plural_label

    # ========== 2PC State Management Methods ==========

    def _clear_pending_confirmation(self):
        """Clear pending confirmation for current conversation"""
        if self.conversation_id in self.pending_confirmations:
            del self.pending_confirmations[self.conversation_id]

    def _set_pending_confirmation(
        self,
        element_id: str,
        action_type: str,
        full_html: str,
        extra_data: Dict[str, Any] = None,
        screenshot_data_url: Optional[str] = None,
        requested_element_id: Optional[str] = None,
        element_id_resolution_note: Optional[str] = None,
    ):
        """Set pending confirmation for current conversation"""
        self.pending_confirmations[self.conversation_id] = {
            "element_id": element_id,
            "action_type": action_type,
            "full_html": full_html,
            "screenshot_data_url": screenshot_data_url,
            "extra_data": extra_data or {},
            "requested_element_id": requested_element_id,
            "element_id_resolution_note": element_id_resolution_note,
        }

    def _get_pending_confirmation(self) -> Optional[Dict[str, Any]]:
        """Get pending confirmation for current conversation"""
        return self.pending_confirmations.get(self.conversation_id)

    def _build_element_id_resolution_note(
        self,
        requested_element_id: Optional[str],
        resolved_element_id: Optional[str],
        element_id_corrected: bool,
    ) -> Optional[str]:
        if (
            not element_id_corrected
            or not requested_element_id
            or not resolved_element_id
            or requested_element_id == resolved_element_id
        ):
            return None

        return (
            f"Matched requested element ID '{requested_element_id}' to "
            f"'{resolved_element_id}'."
        )

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
        self,
        element_id: str,
        intended_action: str | None = None,
    ) -> tuple[str, Optional[str], str, Optional[str]]:
        """Get the full HTML of an element from extension's elementCache AND a screenshot with highlight.

        This uses HighlightSingleElementCommand to get both HTML and screenshot.
        Returns a tuple of (html, screenshot_data_url, resolved_element_id, resolution_note).
        """
        command = HighlightSingleElementCommand(
            element_id=element_id,
            intended_action=intended_action,
            conversation_id=self.conversation_id,
        )
        result_dict = self._execute_command_sync(command)

        if result_dict and result_dict.get("success"):
            data = result_dict.get("data", {})
            html = data.get("html") if isinstance(data, dict) else None
            screenshot = data.get("screenshot") if isinstance(data, dict) else None
            requested_element_id = (
                data.get("requestedElementId") if isinstance(data, dict) else None
            )
            if requested_element_id is None and isinstance(data, dict):
                requested_element_id = data.get("requested_element_id")
            resolved_element_id = (
                data.get("resolvedElementId") if isinstance(data, dict) else None
            )
            if resolved_element_id is None and isinstance(data, dict):
                resolved_element_id = data.get("resolved_element_id")
            if resolved_element_id is None and isinstance(data, dict):
                resolved_element_id = data.get("elementId") or data.get("element_id")
            if not isinstance(resolved_element_id, str) or not resolved_element_id:
                resolved_element_id = element_id
            element_id_corrected = bool(
                data.get("elementIdCorrected") if isinstance(data, dict) else False
            )
            if isinstance(data, dict) and "element_id_corrected" in data:
                element_id_corrected = bool(data.get("element_id_corrected"))
            resolution_note = self._build_element_id_resolution_note(
                (
                    requested_element_id
                    if isinstance(requested_element_id, str)
                    else element_id
                ),
                resolved_element_id,
                element_id_corrected,
            )

            if html and isinstance(html, str):
                html = html[:10000] + ("..." if len(html) > 10000 else "")

            return (
                html or "<element not found in cache>",
                screenshot,
                resolved_element_id,
                resolution_note,
            )
        else:
            logger.warning(
                f"Unexpected HighlightSingleElementCommand response: {result_dict}"
            )

        logger.warning(
            f"Element {element_id} not found in cache for conversation {self.conversation_id}"
        )
        return ("<element not found in cache>", None, element_id, None)

    def _build_observation_from_result(
        self,
        result_dict: Optional[Dict[str, Any]],
        message: str,
        tabs_data: Optional[list] = None,
        screenshot_data_url: Optional[str] = None,
        highlighted_elements: Optional[list] = None,
        page: Optional[int] = None,
        total_pages: Optional[int] = None,
        total_elements: Optional[int] = None,
        element_id: Optional[str] = None,
        element_type: Optional[str] = None,
    ) -> OpenBrowserObservation:
        """Build an OpenBrowserObservation from a result dictionary."""
        success = True  # Default to True
        error = None
        requested_element_id = element_id
        resolved_element_id = element_id
        element_id_corrected = False
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
            if page is None and "page" in result_dict:
                page = result_dict["page"]
            if total_pages is None and "totalPages" in result_dict:
                total_pages = result_dict["totalPages"]

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

                    # Capture viewport dims (CSS pixels) for Qwen [0,1000]
                    # → pixel denormalization. Two shapes:
                    #   highlighted/buildScreenshotPayload → viewport_width/height
                    #   raw screenshot → metadata.viewportWidth/Height
                    raw_vw = data.get("viewport_width")
                    raw_vh = data.get("viewport_height")
                    if raw_vw is None or raw_vh is None:
                        meta = data.get("metadata")
                        if isinstance(meta, dict):
                            raw_vw = (
                                raw_vw
                                if raw_vw is not None
                                else meta.get("viewportWidth")
                            )
                            raw_vh = (
                                raw_vh
                                if raw_vh is not None
                                else meta.get("viewportHeight")
                            )
                    if isinstance(raw_vw, (int, float)) and isinstance(
                        raw_vh, (int, float)
                    ):
                        self._cache_viewport(int(raw_vw), int(raw_vh))

                    # Extract highlighted elements for highlight_elements action
                    if highlighted_elements is None and "elements" in data:
                        highlighted_elements = data["elements"]
                    if page is None and "page" in data:
                        page = data["page"]
                    if total_pages is None and "totalPages" in data:
                        total_pages = data["totalPages"]
                    if total_elements is None and "totalElements" in data:
                        total_elements = data["totalElements"]
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

                    requested_candidate = data.get("requestedElementId") or data.get(
                        "requested_element_id"
                    )
                    if isinstance(requested_candidate, str) and requested_candidate:
                        requested_element_id = requested_candidate

                    resolved_candidate = (
                        data.get("resolvedElementId")
                        or data.get("resolved_element_id")
                        or data.get("elementId")
                        or data.get("element_id")
                    )
                    if isinstance(resolved_candidate, str) and resolved_candidate:
                        resolved_element_id = resolved_candidate

                    corrected_candidate = data.get("elementIdCorrected")
                    if corrected_candidate is None:
                        corrected_candidate = data.get("element_id_corrected")
                    if corrected_candidate is not None:
                        element_id_corrected = bool(corrected_candidate)
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

        if (
            requested_element_id
            and resolved_element_id
            and requested_element_id != resolved_element_id
        ):
            element_id_corrected = True

        resolution_note = self._build_element_id_resolution_note(
            requested_element_id,
            resolved_element_id,
            element_id_corrected,
        )
        if resolution_note and message:
            message = f"{message} {resolution_note}"
        elif resolution_note:
            message = resolution_note

        if resolved_element_id:
            element_id = resolved_element_id

        # Get pending confirmation (may have been cleared if action wasn't a confirmation)
        pending_confirmation = self._get_pending_confirmation()

        # Build observation
        cached_viewport = self._get_viewport()
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
            page=page,
            total_pages=total_pages,
            total_elements=total_elements,
            new_tabs_created=new_tabs_created,
            element_id=element_id,
            element_type=element_type,
            javascript_result=javascript_result,
            console_output=console_output,
            scroll_effective=scroll_effective,
            scroll_warning=scroll_warning,
            pending_confirmation=pending_confirmation,
            small_model=self._uses_small_model(),
            viewport_width=cached_viewport[0] if cached_viewport else None,
            viewport_height=cached_viewport[1] if cached_viewport else None,
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

            # The agent loop is pixel-only — every screenshot returned to the
            # model should be clean and show the virtual cursor. Highlights
            # are reserved for non-agent flows (recording tooling) that don't
            # come through this executor.
            if hasattr(command, "live_mode"):
                command.live_mode = True

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
