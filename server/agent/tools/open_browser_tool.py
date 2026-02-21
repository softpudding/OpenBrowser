"""
OpenBrowserTool - AI tool for controlling Chrome browser with visual feedback.

This tool allows an AI agent to control a Chrome browser using the existing
Local Chrome Server infrastructure. After each operation, it returns both
textual information (current tab list, mouse position) and a screenshot
image for visual feedback.
"""

import time
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
    ScreenshotCommand,
    TabCommand, GetTabsCommand, JavascriptExecuteCommand,
    TabAction
)

logger = logging.getLogger(__name__)


# --- Single Action Type ---

class OpenBrowserAction(Action):
    """Browser automation action with unified parameter system"""
    type: str = Field(description="Type of browser operation")
    # JavaScript execution parameters
    script: Optional[str] = Field(default=None, description="JavaScript code to execute for javascript_execute")
    # Tab operation parameters
    action: Optional[str] = Field(default=None, description="Action for tab operations: 'init', 'open', 'close', 'switch', 'list', 'refresh'")
    url: Optional[str] = Field(default=None, description="URL for tab operations (required for init and open)")
    tab_id: Optional[int] = Field(default=None, description="Tab ID for tab operations (required for close, switch, refresh)")


# --- Supported Action Types and Their Parameters ---
"""
Supported action types and their parameters:

1. javascript_execute - Execute JavaScript code in current tab
   Parameters: {
     "script": str  # JavaScript code to execute
   }

2. tab - Tab management operations
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
            
            if action_type == "tab":
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
                if result_dict and result_dict.get('data'):
                    js_data = result_dict['data']
                    # JavaScript module returns result in 'result' field
                    if isinstance(js_data, dict):
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
                        else:
                            # If no result or value, use the entire data dict
                            javascript_result = js_data
                    else:
                        # If data is not a dict (e.g., string error), use it as result
                        javascript_result = js_data
                    
                    # If we have a result, update message to include it (only for successful executions)
                    if javascript_result is not None and result_dict.get('success'):
                        result_str = str(javascript_result)
                        if len(result_str) > 100:
                            result_str = result_str[:100] + '...'
                        message = f"{message} - Result: {result_str}"
                elif result_dict and result_dict.get('error'):
                    # If there's an error but no data, use error as javascript_result
                    javascript_result = result_dict['error']
                    
            else:
                raise ValueError(f"Unknown action type: {action_type}")
            
            # Determine what data to collect based on action type
            tabs_data = []
            mouse_position = None
            screenshot_data_url = None
            
            # 1. Always collect screenshot for visual feedback (but don't include in text)
            logger.debug(f"DEBUG: Getting screenshot after action (sync)...")
            # FIXME: temp method to let chrome render for 1 sec.
            time.sleep(1)
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
                pass
            
            # 3. javascript_result is already set in javascript_execute branch
            
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

_OPEN_BROWSER_DESCRIPTION = """Browser automation tool for controlling Chrome via JavaScript execution.

This tool provides two core capabilities:
1. **Execute JavaScript** - Interact with web pages, extract data, manipulate DOM
2. **Manage Tabs** - Open, close, switch, and list browser tabs

After each operation, you will receive:
- Textual summary of the operation result
- List of current browser tabs with their titles and URLs
- A screenshot of the browser window (1280x720 pixels) for verification

**Supported Operations:**

## 1. javascript_execute

Execute JavaScript code in the current tab. This is your primary method for all browser interactions.

```json
{
  "type": "javascript_execute",
  "script": "document.querySelector('button').click()"
}
```

**Capabilities:**
- DOM Manipulation: Click elements, fill forms, modify content
- Data Extraction: Get text, attributes, page content
- Navigation: Change URLs, interact with links
- Scrolling: Control page scroll position
- API Access: Call page functions, fetch data

**Common Patterns:**

**Click elements:**
```javascript
document.querySelector('button.submit').click();
document.querySelector('a[href="/about"]').click();
```

**Fill forms:**
```javascript
document.querySelector('#username').value = 'testuser';
document.querySelector('#password').value = 'password123';
document.querySelector('input[name="email"]').value = 'user@example.com';
```

**Extract data:**
```javascript
// Page info
document.title
window.location.href
document.body.innerText

// Links
Array.from(document.links).map(link => ({text: link.textContent, href: link.href}))

// Form data
Array.from(document.forms).map(form => ({id: form.id, elements: form.elements.length}))
```

**Navigate:**
```javascript
window.location.href = "https://example.com";
```

**Scroll:**
```javascript
// Scroll down one page
window.scrollBy({
  top: window.innerHeight,
  left: 0
});

// Scroll by pixels
window.scrollBy(0, 500);

// Scroll element into view
document.querySelector('#section').scrollIntoView();
```

**Wait for elements:**
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

**Returns:**
- Result of JavaScript evaluation (if serializable)
- `undefined` for operations without explicit return value
- Error details for invalid JavaScript

**Tips:**
- Highlight elements before operating: `element.style.border = '3px solid red'`
- Use `return` to get specific values
- Chain operations: `document.querySelector('#input').value = 'text'; document.querySelector('#submit').click();`

## 2. tab

Manage browser tabs.

```json
{
  "type": "tab",
  "action": "open",    // "init", "open", "close", "switch", "list", "refresh"
  "url": "https://example.com",  // Required for "init" and "open"
  "tab_id": 123        // Required for "close", "switch", and "refresh"
}
```

**Actions:**
- `init` - Initialize session with URL
- `open` - Open new tab with URL
- `close` - Close tab by ID
- `switch` - Switch to tab by ID
- `list` - List all tabs
- `refresh` - Refresh tab by ID

**Example Workflow:**

**Scenario: Login and extract dashboard data**

1. Initialize session:
```json
{"type": "tab", "action": "init", "url": "https://example.com/login"}
```

2. Understand page structure:
```json
{"type": "javascript_execute", "script": "({title: document.title, url: window.location.href, forms: Array.from(document.forms).map(f => f.id)})"}
```

3. Fill and submit form:
```json
{"type": "javascript_execute", "script": "document.querySelector('#username').value = 'testuser'; document.querySelector('#password').value = 'password123'; document.querySelector('#loginForm').submit(); 'Form submitted'"}
```

4. Extract data after navigation:
```json
{"type": "javascript_execute", "script": "({title: document.title, url: window.location.href, userInfo: document.querySelector('.user-info')?.innerText})"}
```

5. Open new page:
```json
{"type": "tab", "action": "open", "url": "https://example.com/profile"}
```

**Key Points:**
- Use JavaScript for all page interactions (clicking, typing, scrolling, data extraction)
- Use tab action for URL navigation when you know the URL
- Screenshots help verify results and understand page structure
- JavaScript execution is fast and reliable - use it for virtually everything!
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