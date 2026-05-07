import asyncio
import logging
import json
import os
from typing import Dict, Optional, Any, List
from datetime import datetime

from server.models.commands import (
    Command,
    CommandResponse,
    parse_command,
    MouseMoveCommand,
    MouseClickCommand,
    MouseDragCommand,
    MouseScrollCommand,
    ResetMouseCommand,
    KeyboardTypeCommand,
    KeyboardPressCommand,
    SelectOptionCommand,
    UploadFilePendingCommand,
    ScreenshotCommand,
    TabCommand,
    GetTabsCommand,
    JavascriptExecuteCommand,
    HandleDialogCommand,
    GetGroundedElementsCommand,
    GetAccessibilityTreeCommand,
    HighlightElementsCommand,
    ClickElementCommand,
    HoverElementCommand,
    ScrollElementCommand,
    SwipeElementCommand,
    KeyboardInputCommand,
    GetElementHtmlCommand,
    HighlightSingleElementCommand,
    SelectElementCommand,
    RecordingControlCommand,
    DragAndDropElementCommand,
    SetSliderValueCommand,
    UploadFileCommand,
    HighlightDropPreviewCommand,
    AnalyzePixelTargetsCommand,
    RenderPixelConfirmCommand,
    ClearPixelOverlayCommand,
)
from server.websocket.manager import ws_manager
from server.core.config import config

SCREENSHOT_DELAY_MS = 500  # Delay before taking screenshot (in milliseconds)


logger = logging.getLogger(__name__)


class CommandProcessor:
    """Processes and executes commands"""

    def __init__(self):
        self._current_tab_ids: Dict[str, Optional[int]] = {}

    def _get_current_tab_id(self, conversation_id: str = None) -> Optional[int]:
        """Get current tab ID for a specific conversation"""
        key = conversation_id or "default"
        return self._current_tab_ids.get(key)

    def _set_current_tab_id(self, tab_id: int, conversation_id: str = None):
        """Set current tab ID for a specific conversation"""
        key = conversation_id or "default"
        self._current_tab_ids[key] = tab_id
        logger.debug(f"Set current tab ID {tab_id} for conversation {key}")

    async def _add_screenshot_to_response(
        self, original_response: CommandResponse, conversation_id: Optional[str] = None
    ) -> CommandResponse:
        """
        Add screenshot to a command response after a delay.

        Args:
            original_response: The original command response
            conversation_id: Conversation ID for the screenshot command

        Returns:
            CommandResponse with screenshot data appended
        """
        if not original_response.success:
            return original_response

        try:
            # Wait for page to settle
            await asyncio.sleep(SCREENSHOT_DELAY_MS / 1000.0)

            # Take screenshot
            screenshot_command = ScreenshotCommand(conversation_id=conversation_id)
            screenshot_response = await self._execute_screenshot(screenshot_command)

            if not screenshot_response.success:
                logger.warning(
                    f"Failed to capture screenshot: {screenshot_response.error}"
                )
                return original_response

            # Merge screenshot data into original response
            merged_data = original_response.data or {}
            if screenshot_response.data:
                # Add screenshot data under 'screenshot' key
                merged_data["screenshot"] = screenshot_response.data.get(
                    "image"
                ) or screenshot_response.data.get("imageData")
                # Also preserve any metadata from screenshot
                if "metadata" in screenshot_response.data:
                    merged_data["screenshot_metadata"] = screenshot_response.data[
                        "metadata"
                    ]

            return CommandResponse(
                success=True,
                command_id=original_response.command_id,
                message=original_response.message,
                data=merged_data,
            )

        except Exception as e:
            logger.error(f"Error adding screenshot to response: {e}")
            return original_response

    def _prepare_command_dict(self, command: Command) -> dict:
        """
        Prepare command dictionary for sending to extension.
        For screenshot and javascript_execute commands, always use current active tab (ignore provided tab_id).
        For other commands, auto-fill tab_id if not specified.
        """
        command_dict = command.dict()

        # Import command types for type checking
        from server.models.commands import (
            TabCommand,
            GetTabsCommand,
            ScreenshotCommand,
            MouseMoveCommand,
            MouseClickCommand,
            MouseDragCommand,
            MouseScrollCommand,
            ResetMouseCommand,
            KeyboardTypeCommand,
            KeyboardPressCommand,
            SelectOptionCommand,
            UploadFilePendingCommand,
            JavascriptExecuteCommand,
            HandleDialogCommand,
        )

        # Get conversation_id for multi-session support
        conversation_id = command.conversation_id

        current_tab_id = self._get_current_tab_id(conversation_id)

        # Special handling for screenshot, javascript_execute, and handle_dialog commands
        # These commands ALWAYS use current active tab, ignoring any provided tab_id
        if isinstance(
            command, (ScreenshotCommand, JavascriptExecuteCommand, HandleDialogCommand)
        ):
            if current_tab_id is not None:
                command_dict["tab_id"] = current_tab_id
                logger.debug(
                    f"Forced use of current tab {current_tab_id} for {command.type} command in conversation {conversation_id} (ignoring provided tab_id)"
                )
            else:
                logger.warning(
                    f"No current tab set for {command.type} command in conversation {conversation_id}"
                )
        elif (
            hasattr(command, "tab_id")
            and command.tab_id is None
            and current_tab_id is not None
        ):
            # Check command type to decide if we should fill tab_id
            if isinstance(command, TabCommand):
                # init/open create new tabs; close/switch need an explicit
                # tab_id; list gets all tabs. But refresh/view/back/forward
                # operate on "the current tab" semantically, so fill in the
                # active tab when the agent didn't bother to pass it.
                action_value = command_dict.get("action") or getattr(
                    command, "action", None
                )
                action_name = (
                    action_value.value
                    if hasattr(action_value, "value")
                    else action_value
                )
                if action_name in {"refresh", "view", "back", "forward"}:
                    command_dict["tab_id"] = current_tab_id
                    logger.debug(
                        f"Auto-filled tab_id {current_tab_id} for "
                        f"tab.{action_name} in conversation {conversation_id}"
                    )
            elif isinstance(command, GetTabsCommand):
                # GetTabsCommand gets all tabs, doesn't need tab_id
                pass
            else:
                # For other commands (mouse, keyboard, reset_mouse)
                # auto-fill tab_id to target current managed tab
                command_dict["tab_id"] = current_tab_id
                logger.debug(
                    f"Auto-filled tab_id {current_tab_id} for {command.type} command in conversation {conversation_id}"
                )

        return command_dict

    async def _send_prepared_command(self, command: Command) -> CommandResponse:
        """
        Send a command to extension after preparing it with current tab ID.
        """
        prepared_dict = self._prepare_command_dict(command)
        # Parse back to Command to ensure validation
        from server.models.commands import parse_command

        prepared_command = parse_command(prepared_dict)
        return await ws_manager.send_command(prepared_command)

    async def execute(self, command: Command) -> CommandResponse:
        """
        Execute a command

        Args:
            command: The command to execute

        Returns:
            CommandResponse with execution result
        """
        logger.info(f"Executing command: {command.type}")

        try:
            # Route to appropriate handler based on command type
            if isinstance(command, MouseMoveCommand):
                return await self._execute_mouse_move(command)
            elif isinstance(command, MouseClickCommand):
                return await self._execute_mouse_click(command)
            elif isinstance(command, MouseDragCommand):
                return await self._execute_mouse_drag(command)
            elif isinstance(command, MouseScrollCommand):
                return await self._execute_mouse_scroll(command)
            elif isinstance(command, KeyboardTypeCommand):
                return await self._execute_keyboard_type(command)
            elif isinstance(command, KeyboardPressCommand):
                return await self._execute_keyboard_press(command)
            elif isinstance(command, SelectOptionCommand):
                return await self._execute_select_option(command)
            elif isinstance(command, UploadFilePendingCommand):
                return await self._execute_upload_file_pending(command)
            elif isinstance(command, ScreenshotCommand):
                return await self._execute_screenshot(command)
            elif isinstance(command, TabCommand):
                return await self._execute_tab_command(command)
            elif isinstance(command, GetTabsCommand):
                return await self._execute_get_tabs(command)
            elif isinstance(command, ResetMouseCommand):
                return await self._execute_reset_mouse(command)
            elif isinstance(command, JavascriptExecuteCommand):
                return await self._execute_javascript_execute(command)
            elif isinstance(command, HandleDialogCommand):
                return await self._execute_handle_dialog(command)
            elif isinstance(command, GetGroundedElementsCommand):
                return await self._execute_get_grounded_elements(command)
            elif isinstance(command, GetAccessibilityTreeCommand):
                return await self._execute_get_accessibility_tree(command)
            elif isinstance(command, HighlightElementsCommand):
                return await self._execute_highlight_elements(command)
            elif isinstance(command, ClickElementCommand):
                return await self._execute_click_element(command)
            elif isinstance(command, HoverElementCommand):
                return await self._execute_hover_element(command)
            elif isinstance(command, ScrollElementCommand):
                return await self._execute_scroll_element(command)
            elif isinstance(command, SwipeElementCommand):
                return await self._execute_swipe_element(command)
            elif isinstance(command, DragAndDropElementCommand):
                return await self._execute_drag_and_drop_element(command)
            elif isinstance(command, SetSliderValueCommand):
                return await self._execute_set_slider_value(command)
            elif isinstance(command, KeyboardInputCommand):
                return await self._execute_keyboard_input(command)
            elif isinstance(command, GetElementHtmlCommand):
                return await self._execute_get_element_html(command)
            elif isinstance(command, HighlightSingleElementCommand):
                return await self._execute_highlight_single_element(command)
            elif isinstance(command, SelectElementCommand):
                return await self._execute_select_element(command)
            elif isinstance(command, RecordingControlCommand):
                return await self._execute_recording_control(command)
            elif isinstance(command, HighlightDropPreviewCommand):
                return await self._execute_highlight_drop_preview(command)
            elif isinstance(command, AnalyzePixelTargetsCommand):
                return await self._execute_analyze_pixel_targets(command)
            elif isinstance(command, RenderPixelConfirmCommand):
                return await self._execute_render_pixel_confirm(command)
            elif isinstance(command, ClearPixelOverlayCommand):
                return await self._execute_clear_pixel_overlay(command)
            elif isinstance(command, UploadFileCommand):
                return await self._execute_upload_file(command)
            else:
                raise ValueError(f"Unknown command type: {command.type}")

        except Exception as e:
            logger.error(f"Error executing command {command.type}: {e}")
            return CommandResponse(
                success=False,
                command_id=getattr(command, "command_id", None),
                error=str(e),
            )

    async def _execute_mouse_move(self, command: MouseMoveCommand) -> CommandResponse:
        """Execute mouse move command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_mouse_click(self, command: MouseClickCommand) -> CommandResponse:
        """Execute mouse click command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_mouse_drag(self, command: MouseDragCommand) -> CommandResponse:
        """Execute mouse drag command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_mouse_scroll(
        self, command: MouseScrollCommand
    ) -> CommandResponse:
        """Execute mouse scroll command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_keyboard_type(
        self, command: KeyboardTypeCommand
    ) -> CommandResponse:
        """Execute keyboard type command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_keyboard_press(
        self, command: KeyboardPressCommand
    ) -> CommandResponse:
        """Execute keyboard press command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_select_option(
        self, command: SelectOptionCommand
    ) -> CommandResponse:
        """Execute select_option command — operates on the pending `<select>`."""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_upload_file_pending(
        self, command: UploadFilePendingCommand
    ) -> CommandResponse:
        """Execute upload_file_pending command — operates on the pending file input."""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_screenshot(self, command: ScreenshotCommand) -> CommandResponse:
        """Execute screenshot command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_tab_command(self, command: TabCommand) -> CommandResponse:
        """Execute tab management command and return a11y delta for page changes"""
        # Handle "view" action specially - just take a clean screenshot
        if command.action == "view":
            conversation_id = command.conversation_id
            screenshot_command = ScreenshotCommand(conversation_id=conversation_id)
            return await self._execute_screenshot(screenshot_command)

        response = await self._send_prepared_command(command)

        # Update current tab based on action (conversation-aware)
        if response.success:
            conversation_id = command.conversation_id

            if command.action == "switch" and command.tab_id:
                self._set_current_tab_id(command.tab_id, conversation_id)
            elif command.action == "init":
                if response.data and "tabId" in response.data:
                    self._set_current_tab_id(response.data["tabId"], conversation_id)
                elif response.data and "tab_id" in response.data:
                    self._set_current_tab_id(response.data["tab_id"], conversation_id)
            elif command.action == "open":
                if response.data and "tabId" in response.data:
                    self._set_current_tab_id(response.data["tabId"], conversation_id)
                elif response.data and "tab_id" in response.data:
                    self._set_current_tab_id(response.data["tab_id"], conversation_id)

        # Add message for close action
        if response.success and command.action == "close":
            merged_data = response.data or {}
            tab_id = command.tab_id
            if tab_id:
                merged_data["message"] = f"Closed tab {tab_id}"
            return CommandResponse(
                success=True,
                command_id=response.command_id,
                message=f"Closed tab {tab_id}" if tab_id else "Tab closed",
                data=merged_data,
            )

        return response

    async def _execute_get_tabs(self, command: GetTabsCommand) -> CommandResponse:
        """Execute get tabs command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_reset_mouse(self, command: ResetMouseCommand) -> CommandResponse:
        """Execute reset mouse command"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_javascript_execute(
        self, command: JavascriptExecuteCommand
    ) -> CommandResponse:
        """Execute JavaScript code in browser tab and return result with screenshot"""
        response = await self._send_prepared_command(command)

        return response

    async def _execute_handle_dialog(
        self, command: HandleDialogCommand
    ) -> CommandResponse:
        """Handle open dialog (accept or dismiss)"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_get_grounded_elements(
        self, command: GetGroundedElementsCommand
    ) -> CommandResponse:
        """Get grounded interactive elements"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_get_accessibility_tree(
        self, command: GetAccessibilityTreeCommand
    ) -> CommandResponse:
        """Get accessibility tree from the page"""
        response = await self._send_prepared_command(command)
        return response

    async def _execute_highlight_elements(
        self, command: HighlightElementsCommand
    ) -> CommandResponse:
        """Highlight interactive elements on the page"""
        return await self._send_prepared_command(command)

    async def _execute_click_element(
        self, command: ClickElementCommand
    ) -> CommandResponse:
        """Click a highlighted element by its ID"""
        return await self._send_prepared_command(command)

    async def _execute_hover_element(
        self, command: HoverElementCommand
    ) -> CommandResponse:
        """Hover over a highlighted element by its ID"""
        return await self._send_prepared_command(command)

    async def _execute_scroll_element(
        self, command: ScrollElementCommand
    ) -> CommandResponse:
        """Scroll a highlighted element in a direction"""
        return await self._send_prepared_command(command)

    async def _execute_swipe_element(
        self, command: SwipeElementCommand
    ) -> CommandResponse:
        """Swipe a highlighted element in a direction"""
        return await self._send_prepared_command(command)

    async def _execute_drag_and_drop_element(
        self, command: DragAndDropElementCommand
    ) -> CommandResponse:
        """Drag a source element to a target element or pixel offset"""
        return await self._send_prepared_command(command)

    async def _execute_set_slider_value(
        self, command: SetSliderValueCommand
    ) -> CommandResponse:
        """Set a native range slider's value directly"""
        return await self._send_prepared_command(command)

    async def _execute_keyboard_input(
        self, command: KeyboardInputCommand
    ) -> CommandResponse:
        """Type text into a highlighted element by its ID"""
        return await self._send_prepared_command(command)

    async def _execute_get_element_html(
        self, command: GetElementHtmlCommand
    ) -> CommandResponse:
        """Get HTML of a cached element from extension's elementCache"""
        return await self._send_prepared_command(command)

    async def _execute_highlight_single_element(
        self, command: HighlightSingleElementCommand
    ) -> CommandResponse:
        """Highlight a single element for visual confirmation"""
        return await self._send_prepared_command(command)

    async def _execute_highlight_drop_preview(
        self, command: HighlightDropPreviewCommand
    ) -> CommandResponse:
        """Highlight inner elements of a drop container for drag-and-drop 2PC"""
        return await self._send_prepared_command(command)

    async def _execute_analyze_pixel_targets(
        self, command: AnalyzePixelTargetsCommand
    ) -> CommandResponse:
        """Probe (x, y) for the hit element and nearby interactables."""
        return await self._send_prepared_command(command)

    async def _execute_render_pixel_confirm(
        self, command: RenderPixelConfirmCommand
    ) -> CommandResponse:
        """Render a zoomed confirmation crop for a pending pixel action."""
        return await self._send_prepared_command(command)

    async def _execute_clear_pixel_overlay(
        self, command: ClearPixelOverlayCommand
    ) -> CommandResponse:
        """Clear any pixel-confirmation overlay drawn on the page."""
        return await self._send_prepared_command(command)

    async def _execute_upload_file(self, command: UploadFileCommand) -> CommandResponse:
        """Attach a local file to an <input type=file> via CDP.

        Validates the path server-side before dispatching to the extension,
        so a bad path returns an observation the agent can react to instead
        of failing opaquely inside CDP.
        """
        if not os.path.isabs(command.file_path):
            return CommandResponse(
                success=False,
                command_id=command.command_id,
                error=(
                    f"file_path must be absolute, got: {command.file_path!r}. "
                    "Pass the full path (e.g. /tmp/file.png)."
                ),
            )
        if not os.path.isfile(command.file_path):
            return CommandResponse(
                success=False,
                command_id=command.command_id,
                error=f"File not found: {command.file_path}",
            )
        if not os.access(command.file_path, os.R_OK):
            return CommandResponse(
                success=False,
                command_id=command.command_id,
                error=f"File not readable: {command.file_path}",
            )
        return await self._send_prepared_command(command)

    async def _execute_select_element(
        self, command: SelectElementCommand
    ) -> CommandResponse:
        """Select an option in a <select> element by its ID"""
        return await self._send_prepared_command(command)

    async def _execute_recording_control(
        self, command: RecordingControlCommand
    ) -> CommandResponse:
        """Start or stop recording mode in the browser extension."""
        return await self._send_prepared_command(command)

    def set_current_tab(self, tab_id: int, conversation_id: str = None):
        """Set current active tab ID for a specific conversation"""
        self._set_current_tab_id(tab_id, conversation_id)

    def get_current_tab(self, conversation_id: str = None) -> Optional[int]:
        """Get current active tab ID for a specific conversation"""
        return self._get_current_tab_id(conversation_id)

    def cleanup_conversation(self, conversation_id: str):
        """Cleanup command processor state for a conversation"""
        key = conversation_id or "default"
        if key in self._current_tab_ids:
            del self._current_tab_ids[key]
            logger.info(f"Cleaned up command processor state for conversation {key}")

    async def health_check(self) -> bool:
        """Check if command processor is healthy"""
        try:
            # First check if any WebSocket connection exists
            if ws_manager.is_connected():
                # If independent WebSocket server has connections, test with a command
                # Use 'health_check' as conversation_id for health check commands
                command = GetTabsCommand(conversation_id="health_check")
                response = await self.execute(command)
                return response.success
            else:
                # No WebSocket connections via independent server
                # This could mean extension is connecting via FastAPI WebSocket endpoint
                # or no extension is connected yet
                # Return True to allow server to keep running
                # The /health endpoint will return 200 but with websocket_connected: false
                # This allows the server to be accessible even if extension isn't connected yet
                return True

        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False


# Global command processor instance
command_processor = CommandProcessor()
