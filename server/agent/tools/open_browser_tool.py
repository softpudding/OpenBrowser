"""
OpenBrowserTool - AI tool for controlling Chrome browser with visual feedback.

This tool allows an AI agent to control a Chrome browser using the existing
Local Chrome Server infrastructure. After each operation, it returns both
textual information (current tab list, mouse position) and a screenshot
image for visual feedback.
"""

import asyncio
import base64
import logging
import threading
import requests
from typing import Optional, List, Dict, Any, Literal, Union
from enum import Enum
from collections.abc import Sequence

from pydantic import Field, SecretStr
from openhands.sdk import Action, Observation, ImageContent, TextContent
from openhands.sdk.tool import ToolExecutor, ToolDefinition, register_tool

logger = logging.getLogger(__name__)

from server.core.processor import command_processor
from server.models.commands import (
    MouseMoveCommand, MouseClickCommand, MouseScrollCommand,
    KeyboardTypeCommand, ScreenshotCommand,
    TabCommand, GetTabsCommand, JavascriptExecuteCommand,
    MouseButton, ScrollDirection, TabAction
)

logger = logging.getLogger(__name__)


# --- Single Action Type ---

class OpenBrowserAction(Action):
    """Browser automation action with unified parameter system"""
    type: str = Field(description="Type of browser operation")
    # Mouse move parameters
    x: Optional[int] = Field(default=None, description="X coordinate for mouse_move (0-1280)")
    y: Optional[int] = Field(default=None, description="Y coordinate for mouse_move (0-720)")
    # Mouse scroll parameters
    direction: Optional[str] = Field(default=None, description="Direction for mouse_scroll: 'up', 'down', 'left', 'right'")
    # Keyboard type parameters
    text: Optional[str] = Field(default=None, description="Text for keyboard_type")
    # JavaScript execution parameters
    script: Optional[str] = Field(default=None, description="JavaScript code to execute for javascript_execute")
    # Tab operation parameters
    action: Optional[str] = Field(default=None, description="Action for tab operations: 'init', 'open', 'close', 'switch', 'list', 'refresh'")
    url: Optional[str] = Field(default=None, description="URL for tab operations (required for init and open)")
    tab_id: Optional[int] = Field(default=None, description="Tab ID for tab operations (required for close, switch, refresh)")


# --- Supported Action Types and Their Parameters ---
"""
Supported action types and their parameters:

1. mouse_move - Move mouse to absolute position
   Parameters: {
     "x": int,  # X coordinate (0 to 1280, left to right)
     "y": int,  # Y coordinate (0 to 720, top to bottom)
   }

2. mouse_click - Click at current mouse position
   Parameters: {}  # Only left button, single click

3. mouse_scroll - Scroll at current mouse position
   Parameters: {
     "direction": str (optional, default "down"),  # "up", "down", "left", "right"
   }

4. keyboard_type - Type text at current focus
   Parameters: {
     "text": str  # Text to type (max 1000 characters)
   }

5. javascript_execute - Execute JavaScript code in current tab
   Parameters: {
     "script": str  # JavaScript code to execute
   }

6. tab - Tab management operations
   Parameters: {
     "action": str,  # "init", "open", "close", "switch", "list", "refresh"
     "url": str (optional),  # URL for open/init actions
     "tab_id": int (optional)  # Tab ID for close, switch, and refresh actions
   }
"""


# --- Observation ---

class OpenBrowserObservation(Observation):
    """Observation returned by OpenBrowserTool after each action"""
    
    success: bool = Field(description="Whether the operation succeeded")
    message: Optional[str] = Field(default=None, description="Result message")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    tabs: List[Dict[str, Any]] = Field(default_factory=list, description="List of current tabs")
    mouse_position: Optional[Dict[str, int]] = Field(
        default=None,
        description="Current mouse position in preset coordinate system (x, y)"
    )
    screenshot_data_url: Optional[str] = Field(
        default=None,
        description="Screenshot as data URL (base64 encoded PNG, 1280x720 pixels)"
    )
    javascript_result: Optional[Any] = Field(
        default=None,
        description="Result of JavaScript execution (if action was javascript_execute)"
    )
    
    @property
    def to_llm_content(self) -> Sequence[TextContent | ImageContent]:
        """Convert observation to LLM content format"""
        content_items = []
        
        # Text content with tab list and mouse position
        text_parts = []
        
        if not self.success:
            text_parts.append(f"❌ Operation failed: {self.error}")
        elif self.message:
            text_parts.append(f"✅ {self.message}")
        
        if self.tabs:
            text_parts.append(f"📑 Current tabs ({len(self.tabs)}):")
            for i, tab in enumerate(self.tabs):
                active = "✓" if tab.get('active') else " "
                title = tab.get('title', 'No title')[:50]
                url = tab.get('url', 'No URL')
                text_parts.append(f"  {active} [{tab['id']}] {title}")
                text_parts.append(f"      {url}")
                if i < len(self.tabs) - 1:
                    text_parts.append("")
        
        if self.mouse_position:
            x = self.mouse_position['x']
            y = self.mouse_position['y']
            text_parts.append(f"📍 Mouse position: ({x}, {y}) in preset coordinate system")
            text_parts.append("   (Center is 0,0, right is +X, down is +Y)")
        
        if self.javascript_result is not None:
            result_str = str(self.javascript_result)
            if len(result_str) > 50000:
                result_str = result_str[:50000] + "... (truncated)"
            text_parts.append(f"📜 JavaScript execution result: {result_str}")
        
        if self.screenshot_data_url:
            text_parts.append("🖼️  Screenshot captured (1280x720 pixels)")
        
        text_content = "\n".join(text_parts)
        content_items.append(TextContent(text=text_content))
        
        # Add image content if screenshot is available
        if self.screenshot_data_url:
            content_items.append(ImageContent(image_urls=[self.screenshot_data_url]))
        
        return content_items


# --- Executor ---

class OpenBrowserExecutor(ToolExecutor[OpenBrowserAction, OpenBrowserObservation]):
    """Executor for browser automation commands"""
    
    def __init__(self):
        # We'll use the existing command_processor from the server
        pass
    
    async def _execute_action(self, action: OpenBrowserAction) -> OpenBrowserObservation:
        """Execute a browser action asynchronously"""
        logger.debug(f"DEBUG: _execute_action called with action_type={action.type}")
        try:
            # Get action type
            action_type = action.type
            
            # Convert to appropriate server command based on type
            result = None
            message = ""
            javascript_result = None  # Store JavaScript execution result
            
            if action_type == "mouse_move":
                # Validate required parameters
                if action.x is None or action.y is None:
                    raise ValueError("mouse_move requires x and y parameters")
                command = MouseMoveCommand(
                    x=action.x,
                    y=action.y,
                    duration=0.1  # Default duration
                )
                result = await self._execute_command(command)
                message = f"Moved mouse to ({action.x}, {action.y})"
                
            elif action_type == "mouse_click":
                # Convert button string to MouseButton enum
                button_str = action.button if action.button is not None else 'left'
                button_enum = MouseButton(button_str)
                command = MouseClickCommand(
                    button=button_enum,
                    double=action.double if action.double is not None else False,
                    count=action.count if action.count is not None else 1
                )
                result = await self._execute_command(command)
                message = f"Clicked mouse button: {button_str}"
                
            elif action_type == "mouse_scroll":
                # Convert direction string to ScrollDirection enum
                direction_str = action.direction if action.direction is not None else 'down'
                direction_enum = ScrollDirection(direction_str)
                command = MouseScrollCommand(
                    direction=direction_enum,
                    amount=720  # Default scroll amount
                )
                result = await self._execute_command(command)
                message = f"Scrolled {direction_str} by 720 pixels"
                
            elif action_type == "keyboard_type":
                # Validate required parameters
                if action.text is None:
                    raise ValueError("keyboard_type requires text parameter")
                command = KeyboardTypeCommand(text=action.text)
                result = await self._execute_command(command)
                text = action.text
                if len(text) > 50:
                    message = f"Typed: '{text[:50]}...'"
                else:
                    message = f"Typed: '{text}'"
                
            elif action_type == "tab":
                # Validate required parameters
                if action.action is None:
                    raise ValueError("tab requires action parameter")
                action_str = action.action
                # Convert action string to TabAction enum
                # TabAction enum values are uppercase, so convert 'open' -> 'OPEN'
                try:
                    action_enum = TabAction(action_str.upper())
                except ValueError:
                    # If direct conversion fails, try to map common values
                    action_map = {
                        'init': TabAction.INIT,
                        'open': TabAction.OPEN,
                        'close': TabAction.CLOSE,
                        'switch': TabAction.SWITCH,
                        'list': TabAction.LIST,
                        'refresh': TabAction.REFRESH
                    }
                    if action_str in action_map:
                        action_enum = action_map[action_str]
                    else:
                        raise ValueError(f"Invalid tab action: {action_str}")
                
                command = TabCommand(
                    action=action_enum,
                    url=action.url,
                    tab_id=action.tab_id
                )
                result = await self._execute_command(command)
                
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
                else:
                    message = f"Tab action: {action_str}"
                    
            elif action_type == "javascript_execute":
                # Validate required parameters
                if action.script is None:
                    raise ValueError("javascript_execute requires script parameter")
                command = JavascriptExecuteCommand(script=action.script)
                result = await self._execute_command(command)
                
                # Extract JavaScript execution result for observation
                javascript_result = None
                if result and result.success and result.data:
                    js_data = result.data
                    # JavaScript module returns result in 'result' field
                    if 'result' in js_data:
                        js_result = js_data['result']
                        # CDP result object has 'value' field when returnByValue is true
                        if isinstance(js_result, dict) and 'value' in js_result:
                            javascript_result = js_result['value']
                        else:
                            javascript_result = js_result
                    # Also check for direct 'value' in data
                    elif 'value' in js_data:
                        javascript_result = js_data['value']
                    
                    # If we have a result, update message to include it
                    if javascript_result is not None:
                        result_str = str(javascript_result)
                        if len(result_str) > 50000:
                            result_str = result_str[:50000] + '... (Truncated because too long)'
                        message = "Javascript Execution Result:\n" + result_str
                    
            else:
                raise ValueError(f"Unknown action type: {action_type}")
            
            # Determine what data to collect based on action type
            tabs_data = []
            mouse_position = None
            screenshot_data_url = None
            
            # 1. Always collect screenshot for visual feedback (but don't include in text)
            logger.debug(f"DEBUG: Getting screenshot after action...")
            screenshot_obs = await self._get_screenshot()
            logger.debug(f"DEBUG: screenshot_obs: success={screenshot_obs.success if screenshot_obs else 'None'}, data keys={list(screenshot_obs.data.keys()) if screenshot_obs and screenshot_obs.data else 'None'}")
            
            if screenshot_obs.success and screenshot_obs.data:
                # Try to extract image data
                image_data = None
                if 'imageData' in screenshot_obs.data:
                    image_data = screenshot_obs.data['imageData']
                elif 'image_data' in screenshot_obs.data:
                    image_data = screenshot_obs.data['image_data']
                
                if image_data:
                    # Ensure it's a data URL
                    if image_data.startswith('data:image/'):
                        screenshot_data_url = image_data
                    else:
                        # Convert base64 to data URL
                        screenshot_data_url = f"data:image/png;base64,{image_data}"
            
            # 2. Collect tabs data only for tab operations
            if action_type == "tab":
                logger.debug(f"DEBUG: Getting tabs after tab action...")
                tabs_obs = await self._get_tabs()
                logger.debug(f"DEBUG: tabs_obs: success={tabs_obs.success if tabs_obs else 'None'}, data keys={list(tabs_obs.data.keys()) if tabs_obs and tabs_obs.data else 'None'}")
                
                if tabs_obs.success and tabs_obs.data and 'tabs' in tabs_obs.data:
                    tabs_data = tabs_obs.data['tabs']
            elif action_type == "javascript_execute":
                # Also get tabs for javascript execution to show context
                logger.debug(f"DEBUG: Getting tabs after javascript execution...")
                tabs_obs = await self._get_tabs()
                logger.debug(f"DEBUG: tabs_obs: success={tabs_obs.success if tabs_obs else 'None'}, data keys={list(tabs_obs.data.keys()) if tabs_obs and tabs_obs.data else 'None'}")
                
                if tabs_obs.success and tabs_obs.data and 'tabs' in tabs_obs.data:
                    tabs_data = tabs_obs.data['tabs']
            
            # 3. Collect mouse position only for mouse operations
            if action_type in ["mouse_move", "mouse_click", "mouse_scroll"]:
                mouse_position = self._get_mouse_position()  # TODO: Track mouse position
                logger.debug(f"DEBUG: Got mouse position for {action_type}: {mouse_position}")
            
            # 4. javascript_result is already set in javascript_execute branch
            
            return OpenBrowserObservation(
                success=result.success if result else False,
                message=message,
                error=result.error if result else None,
                tabs=tabs_data,
                mouse_position=mouse_position,
                screenshot_data_url=screenshot_data_url,
                javascript_result=javascript_result
            )
            
        except ValueError as e:
            # Provide friendly error message for missing parameters
            logger.error(f"ValueError: {e} in action '{action.type}'")
            error_msg = f"Missing or invalid parameters for action '{action.type}': {e}"
            return OpenBrowserObservation(
                success=False,
                error=error_msg,
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None,
                javascript_result=None
            )
        except Exception as e:
            logger.debug(f"DEBUG: _execute_action caught exception: {e}")
            import traceback
            logger.error(traceback.format_exc())
            logger.error(f"Error executing browser action: {e}")
            return OpenBrowserObservation(
                success=False,
                error=str(e),
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None,
                javascript_result=None
            )
    
    def _execute_action_sync(self, action: OpenBrowserAction) -> OpenBrowserObservation:
        """Execute a browser action synchronously via HTTP"""
        logger.debug(f"DEBUG: _execute_action_sync called with action_type={action.type}")
        try:
            # Get action type
            action_type = action.type
            
            # Convert to appropriate server command based on type
            result_dict = None
            message = ""
            javascript_result = None  # Store JavaScript execution result
            
            if action_type == "mouse_move":
                # Validate required parameters
                if action.x is None or action.y is None:
                    raise ValueError("mouse_move requires x and y parameters")
                command = MouseMoveCommand(
                    x=action.x,
                    y=action.y,
                    duration=0.1  # Default duration
                )
                result_dict = self._execute_command_sync(command)
                message = f"Moved mouse to ({action.x}, {action.y})"
                
            elif action_type == "mouse_click":
                # Use default left click, single click
                command = MouseClickCommand(
                    button=MouseButton.LEFT,
                    double=False,
                    count=1
                )
                result_dict = self._execute_command_sync(command)
                message = "Clicked mouse (left button)"
                
            elif action_type == "mouse_scroll":
                # Convert direction string to ScrollDirection enum
                direction_str = action.direction if action.direction is not None else 'down'
                direction_enum = ScrollDirection(direction_str)
                command = MouseScrollCommand(
                    direction=direction_enum,
                    amount=720  # Default scroll amount
                )
                result_dict = self._execute_command_sync(command)
                message = f"Scrolled {direction_str} by 720 pixels"
                
            elif action_type == "keyboard_type":
                # Validate required parameters
                if action.text is None:
                    raise ValueError("keyboard_type requires text parameter")
                command = KeyboardTypeCommand(text=action.text)
                result_dict = self._execute_command_sync(command)
                text = action.text
                if len(text) > 50:
                    message = f"Typed: '{text[:50]}...'"
                else:
                    message = f"Typed: '{text}'"
                
            elif action_type == "tab":
                # Validate required parameters
                if action.action is None:
                    raise ValueError("tab requires action parameter")
                action_str = action.action
                # Convert action string to TabAction enum
                # TabAction enum values are uppercase, so convert 'open' -> 'OPEN'
                try:
                    action_enum = TabAction(action_str.upper())
                except ValueError:
                    # If direct conversion fails, try to map common values
                    action_map = {
                        'init': TabAction.INIT,
                        'open': TabAction.OPEN,
                        'close': TabAction.CLOSE,
                        'switch': TabAction.SWITCH,
                        'list': TabAction.LIST,
                        'refresh': TabAction.REFRESH
                    }
                    if action_str in action_map:
                        action_enum = action_map[action_str]
                    else:
                        raise ValueError(f"Invalid tab action: {action_str}")
                
                command = TabCommand(
                    action=action_enum,
                    url=action.url,
                    tab_id=action.tab_id
                )
                result_dict = self._execute_command_sync(command)
                
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
                else:
                    message = f"Tab action: {action_str}"
                    
            elif action_type == "javascript_execute":
                # Validate required parameters
                if action.script is None:
                    raise ValueError("javascript_execute requires script parameter")
                command = JavascriptExecuteCommand(script=action.script)
                result_dict = self._execute_command_sync(command)
                
                # Truncate long scripts for message
                script = action.script
                if len(script) > 50:
                    message = f"Executed JavaScript: '{script[:50]}...'"
                else:
                    message = f"Executed JavaScript: '{script}'"
                
                # Extract JavaScript execution result for observation
                if result_dict and result_dict.get('success') and result_dict.get('data'):
                    js_data = result_dict['data']
                    # JavaScript module returns result in 'result' field
                    if 'result' in js_data:
                        js_result = js_data['result']
                        # CDP result object has 'value' field when returnByValue is true
                        if isinstance(js_result, dict) and 'value' in js_result:
                            javascript_result = js_result['value']
                        else:
                            javascript_result = js_result
                    # Also check for direct 'value' in data
                    elif 'value' in js_data:
                        javascript_result = js_data['value']
                    
                    # If we have a result, update message to include it
                    if javascript_result is not None:
                        result_str = str(javascript_result)
                        if len(result_str) > 100:
                            result_str = result_str[:100] + '...'
                        message = f"{message} - Result: {result_str}"
                    
            else:
                raise ValueError(f"Unknown action type: {action_type}")
            
            # Determine what data to collect based on action type
            tabs_data = []
            mouse_position = None
            screenshot_data_url = None
            
            # 1. Always collect screenshot for visual feedback (but don't include in text)
            logger.debug(f"DEBUG: Getting screenshot after action (sync)...")
            screenshot_result = self._get_screenshot_sync()
            logger.debug(f"DEBUG: screenshot_result: success={screenshot_result.get('success')}, data keys={list(screenshot_result.get('data', {}).keys()) if screenshot_result.get('data') else 'None'}")
            
            if screenshot_result.get('success') and screenshot_result.get('data'):
                # Try to extract image data
                image_data = None
                data = screenshot_result['data']
                if 'imageData' in data:
                    image_data = data['imageData']
                elif 'image_data' in data:
                    image_data = data['image_data']
                
                if image_data:
                    # Ensure it's a data URL
                    if isinstance(image_data, str) and image_data.startswith('data:image/'):
                        screenshot_data_url = image_data
                    elif isinstance(image_data, str):
                        # Convert base64 to data URL
                        screenshot_data_url = f"data:image/png;base64,{image_data}"
                    else:
                        logger.debug(f"DEBUG: Unexpected image_data type: {type(image_data)}")
            
            # 2. Collect tabs data only for tab operations
            if action_type == "tab":
                logger.debug(f"DEBUG: Getting tabs after tab action (sync)...")
                tabs_result = self._get_tabs_sync()
                logger.debug(f"DEBUG: tabs_result: success={tabs_result.get('success')}, data keys={list(tabs_result.get('data', {}).keys()) if tabs_result.get('data') else 'None'}")
                
                if tabs_result.get('success') and tabs_result.get('data') and 'tabs' in tabs_result['data']:
                    tabs_data = tabs_result['data']['tabs']
            elif action_type == "javascript_execute":
                # Also get tabs for javascript execution to show context
                logger.debug(f"DEBUG: Getting tabs after javascript execution (sync)...")
                tabs_result = self._get_tabs_sync()
                logger.debug(f"DEBUG: tabs_result: success={tabs_result.get('success')}, data keys={list(tabs_result.get('data', {}).keys()) if tabs_result.get('data') else 'None'}")
                
                if tabs_result.get('success') and tabs_result.get('data') and 'tabs' in tabs_result['data']:
                    tabs_data = tabs_result['data']['tabs']
            
            # 3. Collect mouse position only for mouse operations
            if action_type in ["mouse_move", "mouse_click", "mouse_scroll"]:
                mouse_position = self._get_mouse_position()  # TODO: Track mouse position
                logger.debug(f"DEBUG: Got mouse position for {action_type}: {mouse_position}")
            
            # 4. javascript_result is already set in javascript_execute branch
            
            # Extract success from result_dict
            success = False
            error = None
            if result_dict:
                success = result_dict.get('success', False)
                if 'error' in result_dict:
                    error = result_dict['error']
                elif 'message' in result_dict and 'error' in result_dict.get('data', {}):
                    error = result_dict['data']['error']
            
            return OpenBrowserObservation(
                success=success,
                message=message,
                error=error,
                tabs=tabs_data,
                mouse_position=mouse_position,
                screenshot_data_url=screenshot_data_url,
                javascript_result=javascript_result
            )
            
        except ValueError as e:
            # Provide friendly error message for missing parameters
            logger.error(f"ValueError (sync): {e} in action '{action.type}'")
            error_msg = f"Missing or invalid parameters for action '{action.type}': {e}"
            return OpenBrowserObservation(
                success=False,
                error=error_msg,
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None,
                javascript_result=None
            )
        except Exception as e:
            logger.debug(f"DEBUG: _execute_action_sync caught exception: {e}")
            import traceback
            logger.error(traceback.format_exc())
            logger.error(f"Error executing browser action (sync): {e}")
            return OpenBrowserObservation(
                success=False,
                error=str(e),
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None,
                javascript_result=None
            )
    
    def __call__(self, action: OpenBrowserAction, conversation=None) -> OpenBrowserObservation:
        """Execute a browser action and return observation"""
        # Use synchronous HTTP API to avoid event loop competition with WebSocket
        logger.debug(f"DEBUG: OpenBrowserTool.__call__ called with action: {action.type}")
        logger.debug(f"DEBUG: Current thread: {threading.current_thread().name}")
        
        try:
            # Use synchronous execution (avoids event loop issues)
            logger.debug(f"DEBUG: Using synchronous HTTP API for tool execution")
            obs = self._execute_action_sync(action)
            logger.debug(f"DEBUG: OpenBrowserTool.__call__ returning observation: success={obs.success}, message={obs.message}, tabs_count={len(obs.tabs)}, has_screenshot={obs.screenshot_data_url is not None}")
            return obs
                
        except Exception as e:
            logger.debug(f"DEBUG: OpenBrowserTool.__call__ exception: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise
    
    async def _execute_command(self, command) -> Any:
        """Execute a command through the existing command processor"""
        logger.debug(f"DEBUG: _execute_command called with command type: {command.type if hasattr(command, 'type') else type(command).__name__}")
        try:
            result = await command_processor.execute(command)
            logger.debug(f"DEBUG: _execute_command returned: success={result.success if result else 'None'}")
            return result
        except Exception as e:
            logger.debug(f"DEBUG: _execute_command exception: {e}")
            raise
    
    def _execute_command_sync(self, command) -> Any:
        """Execute a command synchronously via HTTP"""
        logger.debug(f"DEBUG: _execute_command_sync called with command type: {command.type if hasattr(command, 'type') else type(command).__name__}")
        try:
            # Convert command to dict using model_dump
            cmd_dict = command.model_dump()
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
    
    async def _get_tabs(self) -> Any:
        """Get current tab list"""
        logger.debug(f"DEBUG: _get_tabs called, sending GetTabsCommand")
        command = GetTabsCommand(managed_only=True)
        result = await command_processor.execute(command)
        logger.debug(f"DEBUG: _get_tabs result: success={result.success if result else 'None'}, data type={type(result.data) if result else 'None'}")
        return result
    
    async def _get_screenshot(self) -> Any:
        """Capture screenshot"""
        logger.debug(f"DEBUG: _get_screenshot called, sending ScreenshotCommand")
        command = ScreenshotCommand(include_cursor=True, include_visual_mouse=True, quality=90)
        result = await command_processor.execute(command)
        logger.debug(f"DEBUG: _get_screenshot result: success={result.success if result else 'None'}, data type={type(result.data) if result else 'None'}")
        return result
    
    def _get_mouse_position(self) -> Optional[Dict[str, int]]:
        """Get current mouse position (placeholder - need to track this)"""
        # TODO: Implement mouse position tracking
        # For now, return None
        return None

    def _get_tabs_sync(self) -> Any:
        """Get current tab list synchronously"""
        logger.debug(f"DEBUG: _get_tabs_sync called, sending GetTabsCommand via HTTP")
        command = GetTabsCommand(managed_only=True)
        result = self._execute_command_sync(command)
        logger.debug(f"DEBUG: _get_tabs_sync result: success={result.get('success')}, data keys={list(result.get('data', {}).keys()) if result.get('data') else 'None'}")
        return result

    def _get_screenshot_sync(self) -> Any:
        """Capture screenshot synchronously"""
        logger.debug(f"DEBUG: _get_screenshot_sync called, sending ScreenshotCommand via HTTP")
        command = ScreenshotCommand(include_cursor=True, include_visual_mouse=True, quality=90)
        result = self._execute_command_sync(command)
        logger.debug(f"DEBUG: _get_screenshot_sync result: success={result.get('success')}, data keys={list(result.get('data', {}).keys()) if result.get('data') else 'None'}")
        return result


# --- Tool Definition ---

_OPEN_BROWSER_DESCRIPTION = """Browser automation tool for controlling Chrome with visual feedback.

This tool allows you to control a Chrome browser programmatically. After each operation,
you will receive:
1. Textual summary of the operation result
2. List of current browser tabs with their titles and URLs
3. Current mouse position in the preset coordinate system
4. A screenshot of the browser window (1280x720 pixels)

**IMPORTANT PRIORITY RULES - READ FIRST:**

1. **ALWAYS PREFER JAVASCRIPT EXECUTION OVER MOUSE/KEYBOARD OPERATIONS**
   - Use `javascript_execute` for ANY browser interaction when possible
   - Only use mouse clicks, moves, or keyboard typing as LAST RESORT when JavaScript cannot achieve the goal
   - JavaScript is more reliable, precise, and faster than visual-based interactions

2. **JAVASCRIPT FOR ALL PAGE INTERACTIONS**
   - Use JavaScript to: find links, click elements, fill forms, extract text, navigate pages
   - Examples:
     - Click element: `document.querySelector('button.submit').click()`
     - Fill form: `document.querySelector('input[name="username"]').value = "test"`
     - Get links: `Array.from(document.links).map(link => link.href)`
     - Navigate: `window.location.href = "https://example.com"`

3. **VISUAL OPERATIONS AS FALLBACK ONLY**
   - Mouse clicks and moves are error-prone (coordinates may be wrong)
   - Keyboard typing requires correct focus and may be intercepted
   - Use visual methods only when JavaScript cannot access the element (rare)

**Coordinate System:**
- Screen resolution: 1280×720 pixels
- Origin (0, 0) is at the TOP-LEFT corner of the screen
- Positive X is RIGHT (0 to 1280)
- Positive Y is DOWN (0 to 720)
- Range: X = 0 to 1280, Y = 0 to 720

**Action Format:**
All actions use a unified format with `type` field and parameter fields directly at the top level:
```json
{
  "type": "action_type",
  "param1": "value1",
  "param2": "value2"
}
```

**Supported Action Types and Parameters:**

1. **javascript_execute** - **[PREFERRED METHOD]** Execute JavaScript code in current tab
   ```json
   {
     "type": "javascript_execute",
     "script": "document.title"  # JavaScript code to execute
   }
   ```
   **CRITICAL: This should be your FIRST choice for ANY browser interaction.**
   - **Why JavaScript is better:** Direct DOM access, no coordinate guessing, more reliable
   - **Use for:** Clicking elements, form filling, text extraction, navigation, data scraping
   - **Examples:**
     ```javascript
     // Click a button
     document.querySelector('button.submit').click();
     
     // Fill a form
     document.querySelector('input[name="email"]').value = "user@example.com";
     document.querySelector('input[name="password"]').value = "password123";
     
     // Extract all links
     Array.from(document.links).map(link => ({text: link.textContent, href: link.href}));
     
     // Navigate to a new page
     window.location.href = "https://example.com";
     
     // Get page content
     document.body.innerText;
     ```
   - Returns the result of JavaScript evaluation as serializable value
   - Can extract data from page: titles, URLs, text content, form values
   - Can interact with page APIs: call functions, fetch data, manipulate DOM
   - Returns `undefined` for operations without explicit return value
   - Use `return` statement to get specific values from scripts
   - Throws exceptions for invalid JavaScript (error details in response)

2. **tab** - Tab management operations
   ```json
   {
     "type": "tab",
     "action": "open",    # "init", "open", "close", "switch", "list", "refresh"
     "url": "https://example.com",  # Required for "init" and "open"
     "tab_id": 123        # Required for "close", "switch", and "refresh"
   }
   ```

3. **keyboard_type** - **[FALLBACK ONLY]** Type text at current focus (use JavaScript form filling instead)
   ```json
   {
     "type": "keyboard_type",
     "text": "Hello World"  # Text to type (max 1000 characters)
   }
   ```
   **Note:** Prefer JavaScript form filling: `document.querySelector('input').value = "text"`

4. **mouse_move** - **[FALLBACK ONLY]** Move mouse to absolute position
   ```json
   {
     "type": "mouse_move",
     "x": 640,        # X coordinate (0 to 1280, left to right)
     "y": 360         # Y coordinate (0 to 720, top to bottom)
   }
   ```
   **Note:** Prefer JavaScript element interaction: `element.click()` or `element.focus()`

5. **mouse_click** - **[FALLBACK ONLY]** Click at current mouse position (left button, single click)
   ```json
   {
     "type": "mouse_click"
   }
   ```
   **Note:** Prefer JavaScript clicking: `document.querySelector('button').click()`

6. **mouse_scroll** - **[FALLBACK ONLY]** Scroll at current mouse position
   ```json
   {
     "type": "mouse_scroll",
     "direction": "down"  # Optional: "up", "down", "left", "right" (default "down")
   }
   ```
   **Note:** Prefer JavaScript scrolling: `window.scrollBy(0, 100)` or `element.scrollIntoView()`

**Visual Guidance (FOR FALLBACK USE ONLY):**
- **PRIMARY METHOD: Use JavaScript for all interactions.** Screenshots are mainly for verification.
- Screenshots are 1280x720 pixels, matching the preset coordinate system
- When looking at screenshots, pay attention to UI elements, text, buttons, and forms **to understand page structure for JavaScript targeting**
- **DO NOT use mouse coordinates for clicking** - Use JavaScript: `document.querySelector('button').click()`
- Read text from screenshots to understand context **for writing appropriate JavaScript selectors**
- **DO NOT navigate by clicking links** - Use JavaScript: `window.location.href = "url"` or `tab` action with direct URL
- **Mouse Pointer Visualization**: A visual mouse pointer (blue arrow) is displayed in screenshots. The pointer changes color based on context: blue for clickable elements, green for text input fields. **This is only for debugging when JavaScript fails - prefer JavaScript interactions.**

**Mouse Pointer and Clicking Guidelines (FALLBACK ONLY - USE JAVASCRIPT INSTEAD):**
**WARNING: These are LAST RESORT methods. Always try JavaScript first.**

1. **JavaScript First**: Before considering mouse operations, ask: "Can I do this with JavaScript?"
   - Clicking: `document.querySelector('button').click()`
   - Form filling: `document.querySelector('input').value = "text"`
   - Navigation: `window.location.href = "url"`
   - Scrolling: `window.scrollBy(0, 100)`

2. **Mouse as Last Resort**: Only use mouse if JavaScript cannot access element (rare):
   - **Mouse Position Awareness**: Check mouse position in screenshots. Mouse pointer is blue arrow.
   - **Pre-click Verification**: Verify mouse pointer is over target element before clicking.
   - **Coordinate Adjustment**: Use `mouse_move` to adjust position if needed.

3. **Direct Tab Navigation**: When URL is known, use `tab` action: `{"type": "tab", "action": "open", "url": "..."}`
   - This is reliable and doesn't require JavaScript or mouse clicks.

4. **URL over Clicking**: Always prefer direct URL navigation over clicking navigation elements.

**Best Practices (ORDERED BY PRIORITY):**

**TIER 1: ALWAYS USE JAVASCRIPT (95% of cases)**
1. **JavaScript First Principle**: For ANY browser interaction, FIRST try `javascript_execute`
2. **Element Interaction**: Use JavaScript to click, focus, fill forms, select options
   - **Before operating on elements, highlight them for confirmation**: `document.querySelector('your-selector').style.border = '3px solid red';` (adds red border to verify correct element selection)
   - `document.querySelector('button.submit').click()`
   - `document.querySelector('input[name="email"]').value = "user@example.com"`
   - `document.querySelector('select').selectedIndex = 1`
3. **Data Extraction**: Extract page data with JavaScript, NOT visual analysis
   - Titles, URLs, text: `document.title`, `window.location.href`, `document.body.innerText`
   - Links: `Array.from(document.links).map(link => ({text: link.textContent, href: link.href}))`
   - Forms: `Array.from(document.forms).map(form => ({id: form.id, elements: form.elements.length}))`
4. **Navigation**: Navigate with JavaScript or direct URLs
   - `window.location.href = "https://example.com"`
   - Or use `tab` action with direct URL
5. **Page Manipulation**: Modify pages directly with JavaScript
   - Scroll: `window.scrollBy(0, 500)` or `element.scrollIntoView()`
   - Visibility: `element.style.display = 'none'`
   - Content: `element.innerHTML = '<p>New content</p>'`

**TIER 2: Use Only When JavaScript Fails (4% of cases)**
6. **Direct URL Navigation**: When URL is known, use `tab` action
   - `{"type": "tab", "action": "open", "url": "https://example.com"}`
   - More reliable than clicking navigation elements

**TIER 3: LAST RESORT - Visual/Mouse Operations (1% of cases)**
7. **Visual Verification**: Check screenshots to understand page structure for JavaScript targeting
8. **Mouse as Absolute Last Resort**: Only use mouse if:
   - JavaScript cannot access element (security restrictions)
   - Element is in canvas/WebGL (no DOM access)
   - Complex drag-and-drop needed
9. **If Using Mouse**: Verify position carefully, move, then click
10. **If Using Keyboard**: Ensure element has focus first

**COMPLETE JAVASCRIPT-FIRST WORKFLOW EXAMPLE:**

**Scenario: Login to a website and extract user dashboard data**

1. **Initialize session with target URL** (direct navigation - most reliable)
   ```json
   {"type": "tab", "action": "init", "url": "https://example.com/login"}
   ```

2. **Extract page information to understand structure**
   ```json
   {"type": "javascript_execute", "script": "({title: document.title, url: window.location.href, forms: Array.from(document.forms).map(f => f.id || 'anonymous')})"}
   ```
   Returns: `{"title": "Login Page", "url": "https://example.com/login", "forms": ["loginForm"]}`

3. **Fill login form using JavaScript** (NOT keyboard typing)
   ```json
   {"type": "javascript_execute", "script": "document.querySelector('#username').value = 'testuser'; document.querySelector('#password').value = 'password123'; 'Form filled'"}
   ```

4. **Submit form using JavaScript** (NOT mouse click)
   ```json
   {"type": "javascript_execute", "script": "document.querySelector('#loginForm').submit(); 'Form submitted'"}
   ```

5. **Wait for navigation and verify success**
   ```json
   {"type": "javascript_execute", "script": "setTimeout(() => ({title: document.title, url: window.location.href}), 2000)"}
   ```
   Returns: `{"title": "User Dashboard", "url": "https://example.com/dashboard"}`

6. **Extract dashboard data**
   ```json
   {"type": "javascript_execute", "script": "({welcomeText: document.querySelector('.welcome-message')?.textContent, menuItems: Array.from(document.querySelectorAll('.nav-item')).map(item => item.textContent.trim()), userInfo: document.querySelector('.user-info')?.innerText})"}
   ```

7. **Navigate to another page using JavaScript**
   ```json
   {"type": "javascript_execute", "script": "document.querySelector('a[href=\"/profile\"]').click(); 'Navigating to profile page'"}
   ```

**COMMON JAVASCRIPT PATTERNS FOR EVERYDAY USE:**

1. **Highlight element for verification**: `document.querySelector('your-selector').style.border = '3px solid red';` (adds red border to confirm you've selected the right element before operating on it)
2. **Click any element**: `document.querySelector('button.primary').click()`
3. **Fill any form**: 
   ```javascript
   document.querySelector('input[name="email"]').value = "user@example.com";
   document.querySelector('textarea[name="message"]').value = "Hello world";
   ```
4. **Select dropdown**: `document.querySelector('select[name="country"]').selectedIndex = 2`
5. **Check checkbox**: `document.querySelector('input[type="checkbox"]').checked = true`
6. **Get all links**: `Array.from(document.links).slice(0, 10).map(l => ({text: l.textContent, href: l.href}))`
7. **Scroll page**: `window.scrollBy(0, 500)` or `document.querySelector('#section').scrollIntoView()`
8. **Wait for element**: 
   ```javascript
   new Promise(resolve => {
     const check = () => {
       const el = document.querySelector('.loaded-content');
       if (el) resolve(el.textContent);
       else setTimeout(check, 100);
     };
     check();
   })
   ```

**LEGACY WORKFLOW (AVOID - USE JAVASCRIPT INSTEAD):**
❌ **Don't do this** - This is the old, error-prone method:
1. Move mouse to guess coordinates
2. Type with keyboard (might lose focus)
3. Click with mouse (might miss)
   
**Instead use JavaScript:**
1. `document.querySelector('input').value = "text"`
2. `document.querySelector('button').click()`

**Direct Navigation Example:**
When URL is known, always use direct navigation:
```json
{"type": "tab", "action": "open", "url": "https://en.wikipedia.org/wiki/Artificial_intelligence"}
```

**Important:** JavaScript execution is 10x more reliable than visual/mouse operations. Use it for 95% of tasks!
"""


class OpenBrowserTool(ToolDefinition[OpenBrowserAction, OpenBrowserObservation]):
    """Tool for browser automation with visual feedback"""
    
    name = "open_browser"
    
    @classmethod
    def create(cls, conv_state, terminal_executor=None) -> Sequence[ToolDefinition]:
        """Create OpenBrowserTool instance with executor"""
        executor = OpenBrowserExecutor()
        
        return [
            cls(
                description=_OPEN_BROWSER_DESCRIPTION,
                action_type=OpenBrowserAction,  # Use base Action type
                observation_type=OpenBrowserObservation,
                executor=executor,
            )
        ]


# Register the tool
register_tool("open_browser", OpenBrowserTool.create)