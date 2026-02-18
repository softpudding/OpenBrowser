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
    KeyboardTypeCommand, KeyboardPressCommand, ScreenshotCommand,
    TabCommand, GetTabsCommand, ResetMouseCommand,
    MouseButton, ScrollDirection, TabAction
)

logger = logging.getLogger(__name__)


# --- Single Action Type ---

class OpenBrowserAction(Action):
    """Browser automation action with unified parameter system"""
    type: str = Field(description="Type of browser operation")
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Parameters for the operation. Structure depends on 'type' field."
    )


# --- Supported Action Types and Their Parameters ---
"""
Supported action types and their parameters:

1. reset_mouse - Reset mouse to screen center
   Parameters: {}

2. mouse_move - Move mouse relative to current position
   Parameters: {
     "dx": int,  # Horizontal movement (-640 to 640, positive = right)
     "dy": int,  # Vertical movement (-360 to 360, positive = down)
     "duration": float (optional, default 0.1)  # Movement duration in seconds
   }

3. mouse_click - Click at current mouse position
   Parameters: {
     "button": str (optional, default "left"),  # "left", "right", "middle"
     "double": bool (optional, default False),  # Double click if True
     "count": int (optional, default 1)  # Number of clicks (1-3)
   }

4. mouse_scroll - Scroll at current mouse position
   Parameters: {
     "direction": str (optional, default "down"),  # "up", "down", "left", "right"
     "amount": int (optional, default 100)  # Scroll amount in pixels (1-1000)
   }

5. keyboard_type - Type text at current focus
   Parameters: {
     "text": str  # Text to type (max 1000 characters)
   }

6. keyboard_press - Press special key
   Parameters: {
     "key": str,  # Key to press (e.g., "Enter", "Escape", "Tab", "Backspace")
     "modifiers": List[str] (optional)  # Modifier keys (e.g., ["Control", "Shift"])
   }

7. tab - Tab management operations
   Parameters: {
     "action": str,  # "init", "open", "close", "switch", "list", "refresh"
     "url": str (optional),  # URL for open/init actions
     "tab_id": int (optional)  # Tab ID for close/switch/refresh actions
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
        logger.debug(f"DEBUG: _execute_action called with action_type={action.type}, params={action.parameters}")
        try:
            # Get action type and parameters
            action_type = action.type
            params = action.parameters
            
            # Handle nested parameters structure (common LLM error)
            if 'parameters' in params and isinstance(params['parameters'], dict):
                # If params contains a 'parameters' key, use that as the actual parameters
                # This handles the case where LLM sends {'action': 'mouse_move', 'parameters': {'dx': 0, 'dy': 100}}
                logger.warning(f"⚠️ LLM generated nested parameters structure. Action type: {action_type}, Original params: {action.parameters}")
                params = params['parameters']
            
            # Also handle case where LLM puts 'action' field inside parameters (should be 'type' at top level)
            if 'action' in params and action_type != 'tab':
                # For non-tab actions, 'action' field inside parameters is usually a mistake
                logger.warning(f"⚠️ LLM may have misplaced 'action' field in parameters. Action type: {action_type}, Params contains 'action': {params.get('action')}")
                # Don't remove it here, let it fail with KeyError if it's actually needed
                # (tab action type legitimately has 'action' parameter)
            
            # Convert to appropriate server command based on type
            result = None
            message = ""
            
            if action_type == "mouse_move":
                command = MouseMoveCommand(
                    dx=params['dx'],
                    dy=params['dy'],
                    duration=params.get('duration', 0.1)
                )
                result = await self._execute_command(command)
                message = f"Moved mouse by ({params['dx']}, {params['dy']})"
                
            elif action_type == "mouse_click":
                # Convert button string to MouseButton enum
                button_str = params.get('button', 'left')
                button_enum = MouseButton(button_str)
                command = MouseClickCommand(
                    button=button_enum,
                    double=params.get('double', False),
                    count=params.get('count', 1)
                )
                result = await self._execute_command(command)
                message = f"Clicked mouse button: {button_str}"
                
            elif action_type == "mouse_scroll":
                # Convert direction string to ScrollDirection enum
                direction_str = params.get('direction', 'down')
                direction_enum = ScrollDirection(direction_str)
                command = MouseScrollCommand(
                    direction=direction_enum,
                    amount=params.get('amount', 100)
                )
                result = await self._execute_command(command)
                message = f"Scrolled {direction_str} by {params.get('amount', 100)} pixels"
                
            elif action_type == "reset_mouse":
                command = ResetMouseCommand()
                result = await self._execute_command(command)
                message = "Reset mouse to screen center"
                
            elif action_type == "keyboard_type":
                command = KeyboardTypeCommand(text=params['text'])
                result = await self._execute_command(command)
                text = params['text']
                if len(text) > 50:
                    message = f"Typed: '{text[:50]}...'"
                else:
                    message = f"Typed: '{text}'"
                
            elif action_type == "keyboard_press":
                command = KeyboardPressCommand(
                    key=params['key'],
                    modifiers=params.get('modifiers', [])
                )
                result = await self._execute_command(command)
                modifiers = params.get('modifiers', [])
                modifier_str = f" with modifiers {modifiers}" if modifiers else ""
                message = f"Pressed key: {params['key']}{modifier_str}"
                
            elif action_type == "tab":
                action_str = params['action']
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
                    url=params.get('url'),
                    tab_id=params.get('tab_id')
                )
                result = await self._execute_command(command)
                
                if action_str == "open":
                    message = f"Opened tab with URL: {params.get('url')}"
                elif action_str == "init":
                    message = f"Initialized session with URL: {params.get('url')}"
                elif action_str == "close":
                    message = f"Closed tab ID: {params.get('tab_id')}"
                elif action_str == "switch":
                    message = f"Switched to tab ID: {params.get('tab_id')}"
                elif action_str == "refresh":
                    message = f"Refreshed tab ID: {params.get('tab_id')}"
                elif action_str == "list":
                    message = "Listed tabs"
                else:
                    message = f"Tab action: {action_str}"
            else:
                raise ValueError(f"Unknown action type: {action_type}")
            
            # Get current state after operation
            logger.debug(f"DEBUG: Getting tabs after action...")
            tabs_obs = await self._get_tabs()
            logger.debug(f"DEBUG: tabs_obs: success={tabs_obs.success if tabs_obs else 'None'}, data keys={list(tabs_obs.data.keys()) if tabs_obs and tabs_obs.data else 'None'}")
            logger.debug(f"DEBUG: Getting screenshot after action...")
            screenshot_obs = await self._get_screenshot()
            logger.debug(f"DEBUG: screenshot_obs: success={screenshot_obs.success if screenshot_obs else 'None'}, data keys={list(screenshot_obs.data.keys()) if screenshot_obs and screenshot_obs.data else 'None'}")
            mouse_position = self._get_mouse_position()  # TODO: Track mouse position
            
            # Get tab data from tabs observation
            tabs_data = []
            if tabs_obs.success and tabs_obs.data and 'tabs' in tabs_obs.data:
                tabs_data = tabs_obs.data['tabs']
            
            # Get screenshot data URL
            screenshot_data_url = None
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
            
            return OpenBrowserObservation(
                success=result.success if result else False,
                message=message,
                error=result.error if result else None,
                tabs=tabs_data,
                mouse_position=mouse_position,
                screenshot_data_url=screenshot_data_url
            )
            
        except KeyError as e:
            # Provide friendly error message for missing parameters
            missing_key = str(e).strip("'")
            logger.error(f"KeyError: Missing required parameter '{missing_key}' in action '{action_type}'")
            logger.error(f"Parameters received: {action.parameters}")
            error_msg = f"Missing required parameter '{missing_key}' for action '{action_type}'. "
            error_msg += "Check if parameters have correct structure (should be flat, not nested). "
            error_msg += f"Received parameters: {action.parameters}"
            return OpenBrowserObservation(
                success=False,
                error=error_msg,
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None
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
                screenshot_data_url=None
            )
    
    def _execute_action_sync(self, action: OpenBrowserAction) -> OpenBrowserObservation:
        """Execute a browser action synchronously via HTTP"""
        logger.debug(f"DEBUG: _execute_action_sync called with action_type={action.type}, params={action.parameters}")
        try:
            # Get action type and parameters
            action_type = action.type
            params = action.parameters
            
            # Handle nested parameters structure (common LLM error)
            if 'parameters' in params and isinstance(params['parameters'], dict):
                # If params contains a 'parameters' key, use that as the actual parameters
                # This handles the case where LLM sends {'action': 'mouse_move', 'parameters': {'dx': 0, 'dy': 100}}
                logger.warning(f"⚠️ LLM generated nested parameters structure (sync). Action type: {action_type}, Original params: {action.parameters}")
                params = params['parameters']
            
            # Also handle case where LLM puts 'action' field inside parameters (should be 'type' at top level)
            if 'action' in params and action_type != 'tab':
                # For non-tab actions, 'action' field inside parameters is usually a mistake
                logger.warning(f"⚠️ LLM may have misplaced 'action' field in parameters (sync). Action type: {action_type}, Params contains 'action': {params.get('action')}")
                # Don't remove it here, let it fail with KeyError if it's actually needed
                # (tab action type legitimately has 'action' parameter)
            
            # Convert to appropriate server command based on type
            result_dict = None
            message = ""
            
            if action_type == "mouse_move":
                command = MouseMoveCommand(
                    dx=params['dx'],
                    dy=params['dy'],
                    duration=params.get('duration', 0.1)
                )
                result_dict = self._execute_command_sync(command)
                message = f"Moved mouse by ({params['dx']}, {params['dy']})"
                
            elif action_type == "mouse_click":
                # Convert button string to MouseButton enum
                button_str = params.get('button', 'left')
                button_enum = MouseButton(button_str)
                command = MouseClickCommand(
                    button=button_enum,
                    double=params.get('double', False),
                    count=params.get('count', 1)
                )
                result_dict = self._execute_command_sync(command)
                message = f"Clicked mouse button: {button_str}"
                
            elif action_type == "mouse_scroll":
                # Convert direction string to ScrollDirection enum
                direction_str = params.get('direction', 'down')
                direction_enum = ScrollDirection(direction_str)
                command = MouseScrollCommand(
                    direction=direction_enum,
                    amount=params.get('amount', 100)
                )
                result_dict = self._execute_command_sync(command)
                message = f"Scrolled {direction_str} by {params.get('amount', 100)} pixels"
                
            elif action_type == "reset_mouse":
                command = ResetMouseCommand()
                result_dict = self._execute_command_sync(command)
                message = "Reset mouse to screen center"
                
            elif action_type == "keyboard_type":
                command = KeyboardTypeCommand(text=params['text'])
                result_dict = self._execute_command_sync(command)
                text = params['text']
                if len(text) > 50:
                    message = f"Typed: '{text[:50]}...'"
                else:
                    message = f"Typed: '{text}'"
                
            elif action_type == "keyboard_press":
                command = KeyboardPressCommand(
                    key=params['key'],
                    modifiers=params.get('modifiers', [])
                )
                result_dict = self._execute_command_sync(command)
                modifiers = params.get('modifiers', [])
                modifier_str = f" with modifiers {modifiers}" if modifiers else ""
                message = f"Pressed key: {params['key']}{modifier_str}"
                
            elif action_type == "tab":
                action_str = params['action']
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
                    url=params.get('url'),
                    tab_id=params.get('tab_id')
                )
                result_dict = self._execute_command_sync(command)
                
                if action_str == "open":
                    message = f"Opened tab with URL: {params.get('url')}"
                elif action_str == "init":
                    message = f"Initialized session with URL: {params.get('url')}"
                elif action_str == "close":
                    message = f"Closed tab ID: {params.get('tab_id')}"
                elif action_str == "switch":
                    message = f"Switched to tab ID: {params.get('tab_id')}"
                elif action_str == "refresh":
                    message = f"Refreshed tab ID: {params.get('tab_id')}"
                elif action_str == "list":
                    message = "Listed tabs"
                else:
                    message = f"Tab action: {action_str}"
            else:
                raise ValueError(f"Unknown action type: {action_type}")
            
            # Get current state after operation
            logger.debug(f"DEBUG: Getting tabs after action (sync)...")
            tabs_result = self._get_tabs_sync()
            logger.debug(f"DEBUG: tabs_result: success={tabs_result.get('success')}, data keys={list(tabs_result.get('data', {}).keys()) if tabs_result.get('data') else 'None'}")
            
            logger.debug(f"DEBUG: Getting screenshot after action (sync)...")
            screenshot_result = self._get_screenshot_sync()
            logger.debug(f"DEBUG: screenshot_result: success={screenshot_result.get('success')}, data keys={list(screenshot_result.get('data', {}).keys()) if screenshot_result.get('data') else 'None'}")
            
            mouse_position = self._get_mouse_position()  # TODO: Track mouse position
            
            # Get tab data from tabs result
            tabs_data = []
            if tabs_result.get('success') and tabs_result.get('data') and 'tabs' in tabs_result['data']:
                tabs_data = tabs_result['data']['tabs']
            
            # Get screenshot data URL
            screenshot_data_url = None
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
                screenshot_data_url=screenshot_data_url
            )
            
        except KeyError as e:
            # Provide friendly error message for missing parameters
            missing_key = str(e).strip("'")
            logger.error(f"KeyError (sync): Missing required parameter '{missing_key}' in action '{action_type}'")
            logger.error(f"Parameters received: {action.parameters}")
            error_msg = f"Missing required parameter '{missing_key}' for action '{action_type}'. "
            error_msg += "Check if parameters have correct structure (should be flat, not nested). "
            error_msg += f"Received parameters: {action.parameters}"
            return OpenBrowserObservation(
                success=False,
                error=error_msg,
                tabs=[],
                mouse_position=None,
                screenshot_data_url=None
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
                screenshot_data_url=None
            )
    
    def __call__(self, action: OpenBrowserAction, conversation=None) -> OpenBrowserObservation:
        """Execute a browser action and return observation"""
        # Use synchronous HTTP API to avoid event loop competition with WebSocket
        logger.debug(f"DEBUG: OpenBrowserTool.__call__ called with action: {action.type}, params: {action.parameters}")
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

🔴 **CRITICAL FORMAT WARNING:**
- Use `type` field at the TOP level (e.g., `"type": "mouse_move"`)
- **NEVER** put `action` field inside the `parameters` object
- **NEVER** nest `parameters` object inside another `parameters` object
- Keep `parameters` object FLAT with only the required parameters for the action

**Coordinate System:**
- Screen resolution: 1280×720 pixels
- Origin (0, 0) is at the CENTER of the screen
- Positive X is RIGHT, negative X is LEFT
- Positive Y is DOWN, negative Y is UP
- Range: X = -640 to 640, Y = -360 to 360

**Action Format:**
All actions use a unified format with `type` and `parameters` fields:
```json
{
  "type": "action_type",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

⚠️ **IMPORTANT: Format Rules**
1. **DO NOT** include an `"action"` field inside the `parameters` object
2. **DO NOT** nest another `"parameters"` object inside the `parameters` object
3. **Parameters must be flat**: The `parameters` object should contain only the required parameters for the specific action type
4. **Use `type` not `action`**: The action type is specified in the `type` field, not inside `parameters`

❌ **INCORRECT Examples (DO NOT USE):**
```json
{
  "type": "mouse_move",
  "parameters": {
    "action": "mouse_move",      // WRONG: Don't include 'action' here
    "parameters": {              // WRONG: Don't nest 'parameters' inside 'parameters'
      "dx": 100,
      "dy": 50
    }
  }
}
```

✅ **CORRECT Examples (USE THESE):**
```json
{
  "type": "mouse_move",
  "parameters": {
    "dx": 100,      // Correct: Direct parameter
    "dy": 50        // Correct: Direct parameter
  }
}
```

**Supported Action Types and Parameters:**

1. **reset_mouse** - Reset mouse to screen center
   ```json
   {
     "type": "reset_mouse",
     "parameters": {}
   }
   ```

2. **mouse_move** - Move mouse relative to current position
   ```json
   {
     "type": "mouse_move",
     "parameters": {
       "dx": -100,      # Horizontal movement (-640 to 640, positive = right)
       "dy": 50,        # Vertical movement (-360 to 360, positive = down)
       "duration": 0.1  # Optional: movement duration in seconds (default 0.1)
     }
   }
   ```

3. **mouse_click** - Click at current mouse position
   ```json
   {
     "type": "mouse_click",
     "parameters": {
       "button": "left",  # Optional: "left", "right", "middle" (default "left")
       "double": false,   # Optional: double click if true (default false)
       "count": 1         # Optional: number of clicks 1-3 (default 1)
     }
   }
   ```

4. **mouse_scroll** - Scroll at current mouse position
   ```json
   {
     "type": "mouse_scroll",
     "parameters": {
       "direction": "down",  # Optional: "up", "down", "left", "right" (default "down")
       "amount": 100         # Optional: scroll amount in pixels 1-1000 (default 100)
     }
   }
   ```

5. **keyboard_type** - Type text at current focus
   ```json
   {
     "type": "keyboard_type",
     "parameters": {
       "text": "Hello World"  # Text to type (max 1000 characters)
     }
   }
   ```

6. **keyboard_press** - Press special key
   ```json
   {
     "type": "keyboard_press",
     "parameters": {
       "key": "Enter",               # Key to press: "Enter", "Escape", "Tab", "Backspace", etc.
       "modifiers": ["Control", "S"] # Optional: modifier keys like ["Control"], ["Shift"]
     }
   }
   ```

7. **tab** - Tab management operations
   ```json
   {
     "type": "tab",
     "parameters": {
       "action": "open",    # "init", "open", "close", "switch", "list", "refresh"
       "url": "https://example.com",  # Required for "init" and "open"
       "tab_id": 123        # Required for "close", "switch", and "refresh"
     }
   }
   ```

**Visual Guidance:**
- Screenshots are 1280x720 pixels, matching the preset coordinate system
- When looking at screenshots, pay attention to UI elements, text, buttons, and forms
- Use mouse coordinates to click on specific elements
- Read text from screenshots to understand page content
- Navigate by clicking links, typing in search boxes, etc.
- **Mouse Pointer Visualization**: A visual mouse pointer (blue arrow) is displayed in screenshots. The pointer changes color based on context: blue for clickable elements, green for text input fields. Use this visual feedback to verify mouse positioning before clicking.

**Mouse Pointer and Clicking Guidelines:**
1. **Mouse Position Awareness**: Always check the mouse position in screenshots. The mouse pointer is visible as a blue arrow. Ensure it's positioned correctly before performing click actions.
2. **Pre-click Verification**: Before executing a click command, verify through the screenshot that the mouse pointer is over the intended target element (button, link, input field).
3. **Coordinate Adjustment**: If the mouse is not correctly positioned, use `mouse_move` commands to adjust its location before clicking.
4. **Direct Tab Navigation**: When you know the exact URL you want to navigate to, use the `tab` action with `"action": "open"` or `"action": "init"` to directly open the URL. Avoid relying on clicking navigation buttons or links when a direct URL is known.
5. **URL over Clicking**: Prefer `tab open <url>` over clicking navigation elements whenever the target URL is known. This is more reliable and efficient.

**Best Practices:**
1. Always check the screenshot after each action to see what happened
2. Read text on the screen to understand context
3. Use tab information to manage multiple pages
4. Click on visible buttons/links rather than guessing coordinates
5. Type text carefully into appropriate input fields
6. Use scrolling to view content beyond the visible area
7. **Verify mouse position before clicking**: Ensure the visual mouse pointer is over the target element in the screenshot before issuing click commands
8. **Prefer direct URL navigation**: When you know the target URL, use `tab open <url>` instead of clicking through navigation interfaces
9. **Use visual mouse feedback**: The color-coded mouse pointer (blue/green) provides hints about element types

**Example Workflow:**
1. ```json
   {"type": "tab", "parameters": {"action": "init", "url": "https://www.google.com"}}
   ``` - Start a browser session with direct URL navigation
2. ```json
   {"type": "mouse_move", "parameters": {"dx": 100, "dy": -50}}
   ``` - Move mouse to search box
3. Check screenshot to verify mouse pointer is positioned over the search box
4. ```json
   {"type": "keyboard_type", "parameters": {"text": "AI assistant"}}
   ``` - Type search query
5. ```json
   {"type": "mouse_click", "parameters": {"button": "left"}}
   ``` - Click search button (after verifying mouse position)
6. ```json
   {"type": "mouse_scroll", "parameters": {"direction": "down", "amount": 500}}
   ``` - Scroll down to see results

**Direct Navigation Example:**
When you need to visit a specific website with a known URL:
```json
{"type": "tab", "parameters": {"action": "open", "url": "https://en.wikipedia.org/wiki/Artificial_intelligence"}}
```
This is preferred over navigating through search results or homepage links.

**Important:** This tool provides real visual feedback - you can see exactly what the browser shows, including the mouse pointer position and color coding!
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