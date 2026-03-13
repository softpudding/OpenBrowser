"""
BrowserExecutor - Unified executor for handling all 5 OpenBrowser tool actions.

This executor can handle actions from all 5 focused tools:
- TabAction (from tab_tool.py)
- HighlightAction (from highlight_tool.py)
- ElementInteractionAction (from element_interaction_tool.py)
- DialogHandleAction (from dialog_tool.py)
- JavaScriptAction (from javascript_tool.py)

All actions inherit from OpenBrowserAction and share common conversation_id.
This executor provides consistent 2PC state management and command execution.
"""

import asyncio
import logging
import threading
from typing import Any, Dict, Optional, Union

from openhands.sdk.tool import ToolExecutor
import requests

from server.core.processor import command_processor
from server.models.commands import (
    TabCommand, GetTabsCommand, JavascriptExecuteCommand,
    HandleDialogCommand, DialogAction,
    TabAction as TabActionEnum, ScreenshotCommand,
    HighlightElementsCommand, ClickElementCommand, HoverElementCommand,
    ScrollElementCommand, KeyboardInputCommand,
    GetElementHtmlCommand, HighlightSingleElementCommand
)

# Import action types for type checking
from server.agent.tools.tab_tool import TabAction
from server.agent.tools.highlight_tool import HighlightAction
from server.agent.tools.element_interaction_tool import ElementInteractionAction
from server.agent.tools.dialog_tool import DialogHandleAction
from server.agent.tools.javascript_tool import JavaScriptAction, DISABLE_JAVASCRIPT_EXECUTE

from server.agent.tools.base import OpenBrowserAction, OpenBrowserObservation

logger = logging.getLogger(__name__)


class BrowserExecutor(ToolExecutor[OpenBrowserAction, OpenBrowserObservation]):
    """Unified executor for all 5 OpenBrowser tool actions.
    
    This executor can handle any action that inherits from OpenBrowserAction,
    providing consistent 2PC state management and command execution across
    all browser automation tools.
    
    Features:
    - Type-aware action execution (detects action class)
    - Shared 2PC state management (pending_confirmations)
    - Conversation isolation (conversation_id)
    - HTTP command execution with proper error handling
    """
    
    def __init__(self):
        self.conversation_id = None
        # 2PC state: pending confirmations per conversation
        self.pending_confirmations: Dict[str, Dict[str, Any]] = {}
        # Cache of element IDs that have been successfully confirmed
        # Key: conversation_id, Value: set of element_ids that have been confirmed
        self.confirmed_elements: Dict[str, set] = {}
    
    def __call__(self, action: OpenBrowserAction, conversation) -> OpenBrowserObservation:
        """Execute a browser action and return observation"""
        self.conversation_id = str(conversation._state.id)
        
        logger.debug(f"DEBUG: BrowserExecutor.__call__ called with action: {type(action).__name__}, conversation_id: {self.conversation_id}")
        logger.debug(f"DEBUG: Current thread: {threading.current_thread().name}")
        
        try:
            logger.debug(f"DEBUG: Using command_processor for tool execution")
            obs = self._execute_action_sync(action)
            logger.debug(f"DEBUG: BrowserExecutor.__call__ returning observation: success={obs.success}, message={obs.message}, tabs_count={len(obs.tabs)}, has_screenshot={obs.screenshot_data_url is not None}")
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
                   (TabAction, HighlightAction, ElementInteractionAction,
                   DialogHandleAction, JavaScriptAction)
        
        Returns:
            OpenBrowserObservation with results of the operation
        """
        logger.debug(f"DEBUG: _execute_action_sync called with action type: {type(action).__name__}")
        
        try:
            # Set conversation_id from action if available
            if hasattr(action, 'conversation_id') and action.conversation_id:
                self.conversation_id = action.conversation_id
            
            # Route based on action type
            if isinstance(action, TabAction):
                return self._execute_tab_action(action)
            elif isinstance(action, HighlightAction):
                return self._execute_highlight_action(action)
            elif isinstance(action, ElementInteractionAction):
                return self._execute_element_interaction_action(action)
            elif isinstance(action, DialogHandleAction):
                return self._execute_dialog_action(action)
            elif isinstance(action, JavaScriptAction):
                return self._execute_javascript_action(action)
            else:
                raise ValueError(f"Unknown action type: {type(action).__name__}")
        
        except Exception as e:
            logger.error(f"Error executing action: {e}", exc_info=True)
            return OpenBrowserObservation(
                success=False,
                error=str(e),
                tabs=[],
                screenshot_data_url=None,
                message=f"Failed to execute action: {e}"
            )
    
    def _execute_tab_action(self, action: TabAction) -> OpenBrowserObservation:
        """Execute a tab management action."""
        logger.debug(f"DEBUG: _execute_tab_action called with action.action={action.action}")
        
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
                'init': TabActionEnum.INIT,
                'open': TabActionEnum.OPEN,
                'close': TabActionEnum.CLOSE,
                'switch': TabActionEnum.SWITCH,
                'list': TabActionEnum.LIST,
                'refresh': TabActionEnum.REFRESH,
                'view': TabActionEnum.VIEW
            }
            if action_str in action_map:
                action_enum = action_map[action_str]
            else:
                raise ValueError(f"Invalid tab action: {action_str}")
        
        command = TabCommand(
            action=action_enum,
            url=action.url,
            tab_id=action.tab_id,
            conversation_id=self.conversation_id
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
        else:
            message = f"Tab action: {action_str}"
        
        # Get tabs data for tab operations (all tab actions should return tabs list)
        tabs_data = []
        tabs_result = self._get_tabs_sync()
        if tabs_result.get('success') and tabs_result.get('data') and 'tabs' in tabs_result['data']:
            tabs_data = tabs_result['data']['tabs']
        
        return self._build_observation_from_result(
            result_dict, message, tabs_data=tabs_data
        )
    
    def _execute_highlight_action(self, action: HighlightAction) -> OpenBrowserObservation:
        """Execute a highlight elements action."""
        logger.debug(f"DEBUG: _execute_highlight_action called with element_type={action.element_type}, page={action.page}")
        
        # Single element type for stable collision-aware pagination
        element_type = action.element_type or "clickable"
        page = action.page or 1
        keywords = action.keywords
        
        command = HighlightElementsCommand(
            element_type=element_type,
            page=page,
            keywords=keywords,
            conversation_id=self.conversation_id
        )
        result_dict = self._execute_command_sync(command)
        
        # Check if command succeeded before accessing result data
        if result_dict is None:
            raise RuntimeError("Chrome extension did not respond to highlight_elements command")
        if not result_dict.get('success', False):
            ext_error = result_dict.get('error', 'Unknown error from Chrome extension')
            raise RuntimeError(f"Chrome extension failed to highlight elements: {ext_error}")
        
        # Extract elements and pagination info
        elements = result_dict.get('data', {}).get('elements', [])
        total_elements = result_dict.get('data', {}).get('totalElements', 0)
        total_pages = result_dict.get('data', {}).get('totalPages', 1)
        current_page = result_dict.get('data', {}).get('page', 1)
        
        # Adjust message based on whether keywords filtering was used
        if keywords:
            keywords_str = ', '.join(keywords)
            message = f"Found {len(elements)} {element_type} elements matching '{keywords_str}' (total: {total_elements})"
        else:
            message = f"Found {len(elements)} {element_type} elements on page {current_page}/{total_pages} (total: {total_elements})"
        
        return self._build_observation_from_result(
            result_dict, message,
            highlighted_elements=elements,
            total_elements=total_elements
        )
    
    def _execute_element_interaction_action(self, action: ElementInteractionAction) -> OpenBrowserObservation:
        """Execute an element interaction action with 2PC safety."""
        logger.debug(f"DEBUG: _execute_element_interaction_action called with action={action.action}, element_id={action.element_id}")
        
        # Route to appropriate handler based on action type
        action_type = action.action
        
        # ========== 2PC Phase 1: Actions Requiring Confirmation ==========
        if action_type == "click":
            if not action.element_id:
                raise ValueError("click requires element_id parameter")
            
            # Check if element is already confirmed - if yes, execute directly
            if self._is_element_confirmed(action.element_id):
                logger.debug(f"DEBUG: Element {action.element_id} already confirmed, executing click directly")
                command = ClickElementCommand(
                    element_id=action.element_id,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get('success'):
                    ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                    raise RuntimeError(f"Failed to click element: {ext_error}")
                message = f"Clicked element (previously confirmed): {action.element_id}"
                return self._build_observation_from_result(result_dict, message, element_id=action.element_id)
            
            # Otherwise proceed with 2PC confirmation flow
            # Get full HTML and screenshot for confirmation
            full_html, screenshot = self._get_element_full_html(action.element_id)
            # Store pending confirmation
            self._set_pending_confirmation(
                element_id=action.element_id,
                action_type='click',
                full_html=full_html,
                extra_data={'tab_id': action.tab_id},
                screenshot_data_url=screenshot
            )
            result_dict = {'success': True, 'data': {}}
            message = f"Click action pending confirmation for element: {action.element_id}"
            return self._build_observation_from_result(result_dict, message, screenshot_data_url=screenshot, element_id=action.element_id)
            
        elif action_type == "hover":
            if not action.element_id:
                raise ValueError("hover requires element_id parameter")
            
            # Check if element is already confirmed - if yes, execute directly
            if self._is_element_confirmed(action.element_id):
                logger.debug(f"DEBUG: Element {action.element_id} already confirmed, executing hover directly")
                command = HoverElementCommand(
                    element_id=action.element_id,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get('success'):
                    ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                    raise RuntimeError(f"Failed to hover element: {ext_error}")
                message = f"Hovered element (previously confirmed): {action.element_id}"
                return self._build_observation_from_result(result_dict, message, element_id=action.element_id)
            
            # Otherwise proceed with 2PC confirmation flow
            full_html, screenshot = self._get_element_full_html(action.element_id)
            self._set_pending_confirmation(
                element_id=action.element_id,
                action_type='hover',
                full_html=full_html,
                extra_data={'tab_id': action.tab_id},
                screenshot_data_url=screenshot
            )
            result_dict = {'success': True, 'data': {}}
            message = f"Hover action pending confirmation for element: {action.element_id}"
            return self._build_observation_from_result(result_dict, message, screenshot_data_url=screenshot, element_id=action.element_id)
            
        elif action_type == "scroll":
            if action.element_id:
                # Check if element is already confirmed - if yes, execute directly
                if self._is_element_confirmed(action.element_id):
                    logger.debug(f"DEBUG: Element {action.element_id} already confirmed, executing scroll directly")
                    command = ScrollElementCommand(
                        element_id=action.element_id,
                        direction=action.direction,
                        scroll_amount=action.scroll_amount or 0.5,
                        conversation_id=self.conversation_id,
                        tab_id=action.tab_id
                    )
                    result_dict = self._execute_command_sync(command)
                    if not result_dict or not result_dict.get('success'):
                        ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                        raise RuntimeError(f"Failed to scroll element: {ext_error}")
                    message = f"Scrolled element (previously confirmed): {action.element_id}"
                    return self._build_observation_from_result(result_dict, message, element_id=action.element_id)
                
                # Otherwise proceed with 2PC confirmation flow
                full_html, screenshot = self._get_element_full_html(action.element_id)
                self._set_pending_confirmation(
                    element_id=action.element_id or '',
                    action_type='scroll',
                    full_html=full_html,
                    extra_data={'direction': action.direction or 'down', 'scroll_amount': action.scroll_amount or 0.5, 'tab_id': action.tab_id},
                    screenshot_data_url=screenshot
                )
                result_dict = {'success': True, 'data': {}}
                message = f"Scroll action pending confirmation for element: {action.element_id or 'page'}"
                return self._build_observation_from_result(result_dict, message, screenshot_data_url=screenshot, element_id=action.element_id)
            else:
                # directly execute for page scroll (no element_id)
                command = ScrollElementCommand(
                    direction=action.direction,
                    scroll_amount=action.scroll_amount or 0.5,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get('success'):
                    ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                    raise RuntimeError(f"Failed to scroll element: {ext_error}")
                message = f"Scrolled page: {action.direction}"
                return self._build_observation_from_result(result_dict, message)
            
        elif action_type == "keyboard_input":
            if not action.element_id:
                raise ValueError("keyboard_input requires element_id parameter")
            if not action.text:
                raise ValueError("keyboard_input requires text parameter")
            
            # Check if element is already confirmed - if yes, execute directly
            if self._is_element_confirmed(action.element_id):
                logger.debug(f"DEBUG: Element {action.element_id} already confirmed, executing keyboard_input directly")
                command = KeyboardInputCommand(
                    element_id=action.element_id,
                    text=action.text,
                    conversation_id=self.conversation_id,
                    tab_id=action.tab_id
                )
                result_dict = self._execute_command_sync(command)
                if not result_dict or not result_dict.get('success'):
                    ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                    raise RuntimeError(f"Failed to input text: {ext_error}")
                message = f"Input text to element (previously confirmed): {action.element_id}"
                return self._build_observation_from_result(result_dict, message, element_id=action.element_id)
            
            # Otherwise proceed with 2PC confirmation flow
            full_html, screenshot = self._get_element_full_html(action.element_id)
            self._set_pending_confirmation(
                element_id=action.element_id,
                action_type='keyboard_input',
                full_html=full_html,
                extra_data={'text': action.text, 'tab_id': action.tab_id},
                screenshot_data_url=screenshot
            )
            result_dict = {'success': True, 'data': {}}
            message = f"Keyboard input action pending confirmation for element: {action.element_id}"
            return self._build_observation_from_result(result_dict, message, screenshot_data_url=screenshot, element_id=action.element_id)
        
        # ========== 2PC Phase 2: Confirm Operations ==========
        elif action_type == "confirm_click":
            pending = self._get_pending_confirmation()
            if not pending or pending['action_type'] != 'click':
                raise ValueError("No pending click confirmation found. Please call click first.")
            if pending['element_id'] != action.element_id:
                raise ValueError(f"Element ID mismatch. Expected {pending['element_id']}, got {action.element_id}")
            # Execute actual click
            command = ClickElementCommand(
                element_id=action.element_id,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id or pending['extra_data'].get('tab_id')
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get('success'):
                ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                raise RuntimeError(f"Failed to click element: {ext_error}")
            message = f"Confirmed and clicked element: {action.element_id}"
            self._add_confirmed_element(action.element_id)
            self._clear_pending_confirmation()
            return self._build_observation_from_result(result_dict, message, element_id=action.element_id)
            
        elif action_type == "confirm_hover":
            pending = self._get_pending_confirmation()
            if not pending or pending['action_type'] != 'hover':
                raise ValueError("No pending hover confirmation found. Please call hover first.")
            if pending['element_id'] != action.element_id:
                raise ValueError(f"Element ID mismatch. Expected {pending['element_id']}, got {action.element_id}")
            command = HoverElementCommand(
                element_id=action.element_id,
                conversation_id=self.conversation_id,
                tab_id=action.tab_id or pending['extra_data'].get('tab_id')
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get('success'):
                ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                raise RuntimeError(f"Failed to hover element: {ext_error}")
            message = f"Confirmed and hovered element: {action.element_id}"
            self._add_confirmed_element(action.element_id)
            self._clear_pending_confirmation()
            return self._build_observation_from_result(result_dict, message)
            
        elif action_type == "confirm_scroll":
            pending = self._get_pending_confirmation()
            if not pending or pending['action_type'] != 'scroll':
                raise ValueError("No pending scroll confirmation found. Please call scroll first.")
            if pending['element_id'] != action.element_id:
                raise ValueError(f"Element ID mismatch. Expected {pending['element_id']}, got {action.element_id}")
            command = ScrollElementCommand(
                element_id=action.element_id,
                direction=pending['extra_data'].get('direction', 'down'),
                scroll_amount=pending['extra_data'].get('scroll_amount', 0.5),
                conversation_id=self.conversation_id,
                tab_id=action.tab_id or pending['extra_data'].get('tab_id')
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get('success'):
                ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                raise RuntimeError(f"Failed to scroll element: {ext_error}")
            message = f"Confirmed and scrolled element: {action.element_id}"
            self._add_confirmed_element(action.element_id)
            self._clear_pending_confirmation()
            return self._build_observation_from_result(result_dict, message)
            
        elif action_type == "confirm_keyboard_input":
            pending = self._get_pending_confirmation()
            if not pending or pending['action_type'] != 'keyboard_input':
                raise ValueError("No pending keyboard_input confirmation found. Please call keyboard_input first.")
            if pending['element_id'] != action.element_id:
                raise ValueError(f"Element ID mismatch. Expected {pending['element_id']}, got {action.element_id}")
            command = KeyboardInputCommand(
                element_id=action.element_id,
                text=pending['extra_data'].get('text', ''),
                conversation_id=self.conversation_id,
                tab_id=action.tab_id or pending['extra_data'].get('tab_id')
            )
            result_dict = self._execute_command_sync(command)
            if not result_dict or not result_dict.get('success'):
                ext_error = result_dict.get('error', 'Unknown error') if result_dict else 'No response'
                raise RuntimeError(f"Failed to input text: {ext_error}")
            message = f"Confirmed and input text to element: {action.element_id}"
            self._add_confirmed_element(action.element_id)
            self._clear_pending_confirmation()
            return self._build_observation_from_result(result_dict, message)
        
        else:
            raise ValueError(f"Invalid element interaction action: {action_type}")
    
    def _execute_dialog_action(self, action: DialogHandleAction) -> OpenBrowserObservation:
        """Execute a dialog handling action."""
        logger.debug(f"DEBUG: _execute_dialog_action called with dialog_action={action.dialog_action}")
        
        # Handle dialog action (accept or dismiss)
        if action.dialog_action is None:
            raise ValueError("dialog requires dialog_action parameter")
        
        dialog_action_str = action.dialog_action
        try:
            dialog_action = DialogAction(dialog_action_str.lower())
        except ValueError:
            raise ValueError(f"Invalid dialog action: {dialog_action_str}. Must be 'accept' or 'dismiss'")
        
        command = HandleDialogCommand(
            action=dialog_action,
            prompt_text=action.prompt_text,
            conversation_id=self.conversation_id
        )
        result_dict = self._execute_command_sync(command)
        
        message = f"Dialog handled: {dialog_action_str}"
        return self._build_observation_from_result(result_dict, message)
    
    def _execute_javascript_action(self, action: JavaScriptAction) -> OpenBrowserObservation:
        """Execute a JavaScript execution action."""
        logger.debug(f"DEBUG: _execute_javascript_action called with script length={len(action.script)}")
        
        # Check if javascript_execute is disabled via environment variable
        if DISABLE_JAVASCRIPT_EXECUTE:
            return OpenBrowserObservation(
                success=False,
                error="javascript_execute command is disabled via OPEN_BROWSER_DISABLE_JAVASCRIPT_EXECUTE environment variable",
                tabs=[],
                screenshot_data_url=None
            )
        
        # Validate required parameters
        if not action.script:
            raise ValueError("javascript requires script parameter")
        
        command = JavascriptExecuteCommand(
            script=action.script,
            conversation_id=self.conversation_id
        )
        result_dict = self._execute_command_sync(command)
        
        # Truncate long scripts for message
        script = action.script
        if len(script) > 50:
            message = f"Executed JavaScript: '{script[:50]}...'"
        else:
            message = f"Executed JavaScript: '{script}'"
        
        observation = self._build_observation_from_result(result_dict, message)
        return observation
    
    # ========== 2PC State Management Methods ==========
    
    def _clear_pending_confirmation(self):
        """Clear pending confirmation for current conversation"""
        if self.conversation_id in self.pending_confirmations:
            del self.pending_confirmations[self.conversation_id]
    
    def _set_pending_confirmation(self, element_id: str, action_type: str, full_html: str, 
                                 extra_data: Dict[str, Any] = None, screenshot_data_url: Optional[str] = None):
        """Set pending confirmation for current conversation"""
        self.pending_confirmations[self.conversation_id] = {
            'element_id': element_id,
            'action_type': action_type,
            'full_html': full_html,
            'screenshot_data_url': screenshot_data_url,
            'extra_data': extra_data or {}
        }
    
    def _get_pending_confirmation(self) -> Optional[Dict[str, Any]]:
        """Get pending confirmation for current conversation"""
        return self.pending_confirmations.get(self.conversation_id)
    
    # ========== Confirmed Elements Cache Methods ==========
    
    def _add_confirmed_element(self, element_id: str):
        """Add an element ID to the confirmed cache for current conversation"""
        if not self.conversation_id:
            return
        if self.conversation_id not in self.confirmed_elements:
            self.confirmed_elements[self.conversation_id] = set()
        self.confirmed_elements[self.conversation_id].add(element_id)
        logger.debug(f"DEBUG: Added element {element_id} to confirmed cache for conversation {self.conversation_id}")
    
    def _is_element_confirmed(self, element_id: str) -> bool:
        """Check if an element ID is in the confirmed cache for current conversation"""
        if not self.conversation_id:
            return False
        return element_id in self.confirmed_elements.get(self.conversation_id, set())
    
    def _clear_confirmed_elements(self):
        """Clear confirmed elements cache for current conversation"""
        if self.conversation_id in self.confirmed_elements:
            del self.confirmed_elements[self.conversation_id]
    
    # ========== Helper Methods ==========
    
    def _get_element_full_html(self, element_id: str) -> tuple[str, Optional[str]]:
        """Get the full HTML of an element from extension's elementCache AND a screenshot with highlight.
        
        This uses HighlightSingleElementCommand to get both HTML and screenshot.
        Returns a tuple of (html, screenshot_data_url).
        """
        command = HighlightSingleElementCommand(
            element_id=element_id,
            conversation_id=self.conversation_id
        )
        result_dict = self._execute_command_sync(command)
        
        if result_dict and result_dict.get('success'):
            data = result_dict.get('data', {})
            html = data.get('html') if isinstance(data, dict) else None
            screenshot = data.get('screenshot') if isinstance(data, dict) else None
            
            if html and isinstance(html, str):
                html = html[:10000] + ('...' if len(html) > 10000 else '')
            
            return (html or "<element not found in cache>", screenshot)
        else:
            logger.warning(f"Unexpected HighlightSingleElementCommand response: {result_dict}")
        
        logger.warning(f"Element {element_id} not found in cache for conversation {self.conversation_id}")
        return ("<element not found in cache>", None)
    
    def _build_observation_from_result(
        self,
        result_dict: Optional[Dict[str, Any]],
        message: str,
        tabs_data: Optional[list] = None,
        screenshot_data_url: Optional[str] = None,
        highlighted_elements: Optional[list] = None,
        total_elements: Optional[int] = None,
        element_id: Optional[str] = None
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
        
        if result_dict:
            success = result_dict.get('success', False)
            if 'error' in result_dict:
                error = result_dict['error']
            elif 'message' in result_dict and 'error' in result_dict.get('data', {}):
                error = result_dict['data']['error']
            
            # Extract dialog info if present
            if 'dialog_opened' in result_dict:
                dialog_opened = result_dict['dialog_opened']
            if 'dialog' in result_dict:
                dialog = result_dict['dialog']
                # Update message for dialog scenarios
                if dialog and success:
                    if dialog.get('needsDecision'):
                        message = f"Dialog opened: {dialog.get('type')} (\"{dialog.get('message')}\"). Use dialog tool to respond."
                    else:
                        message = f"Dialog auto-accepted: {dialog.get('type')} (\"{dialog.get('message')}\")"
            
            # Extract auto-accepted dialog info if present
            # Check multiple naming conventions from extension (camelCase and snake_case)
            if 'dialog_auto_accepted' in result_dict:
                dialog_auto_accepted = result_dict['dialog_auto_accepted']
            elif 'dialogAutoAccepted' in result_dict:
                dialog_auto_accepted = result_dict['dialogAutoAccepted']
            
            if dialog_auto_accepted:
                # Update message to include auto-accepted dialog info
                if success:
                    dialog_type = dialog_auto_accepted.get('type', 'alert')
                    dialog_message = dialog_auto_accepted.get('message', '')
                    if not (dialog and dialog.get('needsDecision')):
                        # Only update message if not already updated by dialog field
                        message = f"Alert dialog auto-accepted: {dialog_type} (\"{dialog_message}\")"
            
            # Extract list of auto-accepted dialogs (for cascading alerts)
            # Check multiple naming conventions from extension
            if 'auto_accepted_dialogs' in result_dict:
                auto_accepted_dialogs = result_dict['auto_accepted_dialogs']
            elif 'dialogAutoAcceptedList' in result_dict:
                auto_accepted_dialogs = result_dict['dialogAutoAcceptedList']
            elif 'dialog_auto_accepted_list' in result_dict:
                auto_accepted_dialogs = result_dict['dialog_auto_accepted_list']
            
            # Also check in data field if present
            if 'data' in result_dict:
                if isinstance(result_dict['data'], dict):
                    data = result_dict['data']
                    if not dialog_auto_accepted and 'dialog_auto_accepted' in data:
                        dialog_auto_accepted = data['dialog_auto_accepted']
                    elif not dialog_auto_accepted and 'dialogAutoAccepted' in data:
                        dialog_auto_accepted = data['dialogAutoAccepted']
                    
                    if not auto_accepted_dialogs and 'auto_accepted_dialogs' in data:
                        auto_accepted_dialogs = data['auto_accepted_dialogs']
                    elif not auto_accepted_dialogs and 'dialogAutoAcceptedList' in data:
                        auto_accepted_dialogs = data['dialogAutoAcceptedList']
                    elif not auto_accepted_dialogs and 'dialog_auto_accepted_list' in data:
                        auto_accepted_dialogs = data['dialog_auto_accepted_list']
                    
                    # Extract screenshot from visual interaction commands
                    # highlight_elements returns data.screenshot (highlighted image)
                    # click/hover/scroll/keyboard_input return data.screenshot
                    if 'screenshot' in data:
                        screenshot_data_url = data['screenshot']
                        logger.debug(f"DEBUG: Extracted screenshot from data['screenshot'], length={len(screenshot_data_url) if screenshot_data_url else 0}")
                    elif 'imageData' in data:
                        screenshot_data_url = data['imageData']
                        logger.debug(f"DEBUG: Extracted screenshot from data['imageData'], length={len(screenshot_data_url) if screenshot_data_url else 0}")
                    
                    # Extract highlighted elements for highlight_elements action
                    if highlighted_elements is None and 'elements' in data:
                        highlighted_elements = data['elements']
                    if total_elements is None and 'totalElements' in data:
                        total_elements = data['totalElements']
                    
                    # Extract new_tabs_created for javascript_execute and confirm_click_element
                    if 'new_tabs_created' in data:
                        new_tabs_created = data['new_tabs_created']
                    
                    # Extract JavaScript execution result if present
                    if 'result' in data or 'value' in data or 'consoleOutput' in data:
                        # Extract console output if available
                        if 'consoleOutput' in data:
                            console_output = data['consoleOutput']
                            logger.debug(f"DEBUG: Captured console output: {len(console_output)} entries")
                        
                        if 'result' in data:
                            js_result = data['result']
                            # CDP result object has 'value' field when returnByValue is true
                            if isinstance(js_result, dict) and 'value' in js_result:
                                javascript_result = js_result['value']
                            else:
                                javascript_result = js_result
                        # Also check for direct 'value' in data
                        elif 'value' in data:
                            javascript_result = data['value']
                        else:
                            # If no result or value, use the entire data dict
                            javascript_result = data
                else:
                    # data is not a dict (e.g., string error), use it as javascript_result
                    javascript_result = result_dict['data']
        
            # If there's an error but no data, use error as javascript_result
            if javascript_result is None and result_dict.get('error'):
                javascript_result = result_dict['error']
        
            # If we have a JavaScript result, update message to include it (only for successful executions)
            if javascript_result is not None and success:
                result_str = str(javascript_result)
                if len(result_str) > 100:
                    result_str = result_str[:100] + '...'
                message = f"{message} - Result: {result_str}"
        
        # Get pending confirmation (do NOT auto-clear - original behavior)
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
            javascript_result=javascript_result,
            console_output=console_output,
            pending_confirmation=pending_confirmation
        )
        
        return observation
    
    def _execute_command_sync(self, command) -> Any:
        """Execute a command synchronously via HTTP with conversation context"""
        logger.debug(f"DEBUG: _execute_command_sync called with command type: {command.type if hasattr(command, 'type') else type(command).__name__}, conversation_id={self.conversation_id}")
        try:
            # Set conversation_id for multi-session support (backup if not set during creation)
            if hasattr(command, 'conversation_id'):
                if command.conversation_id is None:
                    command.conversation_id = self.conversation_id
            
            # Convert command to dict using model_dump
            cmd_dict = command.model_dump()
            logger.info(f"🔍 Command dict: type={cmd_dict.get('type')}, conversation_id={cmd_dict.get('conversation_id')}")
            
            # Send HTTP POST to server - explicitly disable proxy for localhost
            response = requests.post(
                "http://127.0.0.1:8765/command",
                json=cmd_dict,
                timeout=30,
                proxies={'http': None, 'https': None}  # Disable proxy for local connections
            )
            response.raise_for_status()
            result = response.json()
            logger.debug(f"DEBUG: _execute_command_sync returned: success={result.get('success')}")
            return result
        except Exception as e:
            logger.debug(f"DEBUG: _execute_command_sync exception: {e}")
            raise
    
    def _get_tabs_sync(self) -> Any:
        """Get current tab list synchronously"""
        logger.debug(f"DEBUG: _get_tabs_sync called, sending GetTabsCommand via HTTP")
        command = GetTabsCommand(
            managed_only=True,
            conversation_id=self.conversation_id
        )
        result = self._execute_command_sync(command)
        logger.debug(f"DEBUG: _get_tabs_sync result: success={result.get('success')}, data keys={list(result.get('data', {}).keys()) if result.get('data') else 'None'}")
        return result