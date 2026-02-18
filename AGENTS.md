# Local Chrome Server - Development Documentation

## Project Overview

Local Chrome Server is a system for programmatically controlling Chrome browser via a Chrome extension using visual-based automation (pixel coordinates rather than HTML selectors).

## Architecture

### System Components

```
┌─────────────────┐    HTTP/WebSocket    ┌─────────────────────┐
│   Python Server │◄────────────────────►│  Chrome Extension   │
│   (FastAPI)     │                      │  (TypeScript)       │
└─────────────────┘                      └─────────────────────┘
         │                                          │
         ▼                                          ▼
┌─────────────────┐                      ┌─────────────────────┐
│  CLI Tools      │                      │  Chrome DevTools    │
│  (click)        │                      │  Protocol (CDP)     │
└─────────────────┘                      └─────────────────────┘
```

### Communication Flow

1. **Command Initiation**: CLI or REST API sends command to Python server
2. **WebSocket Forwarding**: Python server forwards command to Chrome extension via WebSocket
3. **Browser Execution**: Extension executes command using Chrome DevTools Protocol (CDP)
4. **Response Return**: Extension sends response back through WebSocket to Python server
5. **Result Delivery**: Python server returns result to CLI/REST API client

## Development Setup

### Prerequisites

- Python 3.9+ with `uv` package manager
- Node.js 16+ with `npm`
- Chrome browser for extension testing

### Initial Setup

```bash
# 1. Install Python dependencies
uv sync

# 2. Build Chrome extension
cd extension
npm install
npm run build

# 3. Load extension in Chrome
#    - Open chrome://extensions/
#    - Enable Developer mode
#    - Click "Load unpacked"
#    - Select `extension/dist/`

# 4. Start development server
uv run local-chrome-server serve --log-level DEBUG
```

### Development Commands

```bash
# Python development
uv sync --group dev          # Install dev dependencies
uv run pytest tests/         # Run tests
uv run black .               # Format code
uv run ruff check .          # Lint code
uv run mypy .                # Type checking

# Extension development
cd extension
npm run dev                  # Watch mode for extension
npm run build                # Production build
npm run typecheck            # TypeScript type checking
```

## Module Documentation

### Python Server Modules

#### `server/models/commands.py`
- **Purpose**: Command schema definitions and validation
- **Key Components**:
  - `BaseCommand`: Base class for all commands
  - Command types: `MouseMoveCommand`, `MouseClickCommand`, `KeyboardTypeCommand`, etc.
  - `TabCommand`: Tab management command with `TabAction` enum (OPEN, CLOSE, LIST, SWITCH, INIT)
  - `parse_command()`: Factory function to create commands from JSON
- **Validation**: Uses Pydantic for schema validation
- **Recent Updates**:
  - Added `INIT` action to `TabAction` enum for explicit session initialization
  - Updated URL validator to support both `OPEN` and `INIT` actions
  - `INIT` action requires URL parameter and creates managed tab group

#### `server/core/config.py`
- **Purpose**: Configuration management
- **Key Components**:
  - `ServerConfig`: Pydantic settings class
  - Configuration sources: Environment variables, defaults
- **Settings**: Host, port, preset resolution, timeouts, etc.

#### `server/core/coordinates.py`
- **Purpose**: Coordinate mapping between different resolutions
- **Key Components**:
  - `CoordinateMapping`: Maps between preset and actual screen resolutions
  - `CoordinateManager`: Manages mappings for multiple tabs
- **Algorithm**: Linear scaling with boundary clamping

#### `server/core/processor.py`
- **Purpose**: Command execution and routing
- **Key Components**:
  - `CommandProcessor`: Dispatches commands to appropriate handlers
  - Integration with WebSocket manager for extension communication

#### `server/websocket/manager.py`
- **Purpose**: WebSocket server for extension communication
- **Key Components**:
  - `WebSocketManager`: Manages connections and message routing
  - `ws_manager`: Global instance
- **Protocol**: JSON-based message format with command/response pattern
- **Features**:
  - Support for large messages (100MB max size) for screenshot transmission
  - Command timeout handling (30 seconds default)
  - Automatic response matching using command_id
  - Connection management with ping/pong keepalive

#### `server/api/main.py`
- **Purpose**: FastAPI application with REST and WebSocket endpoints
- **Key Endpoints**:
  - `GET /`, `/health`: Health checks
  - `POST /command`: Generic command execution
  - `POST /mouse/*`, `/keyboard/*`, `/screenshot`, `/tabs`: Shortcut endpoints
  - `WS /ws`: WebSocket endpoint (alternative to independent WebSocket server)

#### `server/main.py`
- **Purpose**: CLI entry point for server management
- **Commands**:
  - `serve`: Start the server
  - `check`: Check extension connectivity
  - `execute`: Execute single command from file
  - `demo`: Run demonstration sequence

### Chrome Extension Modules

#### `extension/src/types.ts`
- **Purpose**: TypeScript type definitions
- **Key Types**: `Command`, `CommandResponse`, `ScreenshotMetadata`, etc.

#### `extension/src/websocket/client.ts`
- **Purpose**: WebSocket client for server communication
- **Key Components**:
  - `WebSocketClient`: Manages connection, reconnection, message handling, disconnect events
  - `wsClient`: Global instance
- **Configuration**: Default URL `ws://127.0.0.1:8766`
- **Features**:
  - Automatic reconnection with exponential backoff (max 10 attempts)
  - Command/response pattern with timeout handling (30 seconds)
  - Disconnect event notification system for cleanup tasks
  - Large message support (100MB) for screenshot transmission

#### `extension/src/commands/`
- **Purpose**: Chrome automation implementations
- **Modules**:
  - `cdp-commander.ts`: Chrome DevTools Protocol wrapper
  - `debugger-manager.ts`: Debugger attachment/detachment management
  - `computer.ts`: Mouse, keyboard, scroll operations (adapted from AIPex)
  - `screenshot.ts`: Screenshot capture with metadata caching
  - `tabs.ts`: Tab management operations with filtered listing (`getAllTabs(managedOnly=true)`)
  - `tab-manager.ts`: Tab group management and isolation (inspired by MANUS design)

#### `extension/src/commands/tab-manager.ts`
- **Purpose**: Advanced tab management with Chrome tab groups for visual isolation and organization
- **Design Inspiration**: Based on MANUS Chrome Plugin's tab group isolation concept
- **Key Features**:
  - **Explicit Session Initialization**: `initializeSession(url)` method for explicit control session start
  - **Tab Group Creation/Management**: Creates "OpenBrowser" tab group for visual separation
  - **Automatic Tab Management**: Automatically adds controlled tabs to the managed group
  - **Filtered Tab Listing**: `getAllTabs(managedOnly=true)` shows only managed tabs when session initialized
  - **Session State Tracking**: `isSessionInitialized()` checks if tab group exists and has managed tabs
  - **Status Visualization**: Shows real-time status via emoji indicators (🔵 active, ⚪ idle, 🔴 disconnected)
  - **Activity Tracking**: Monitors tab activity to update status automatically
  - **Backward Compatibility**: Falls back to simple tab management when tabGroups API unavailable (Chrome < 89)
- **Core Components**:
  - `TabManager` class: Singleton manager for tab group operations
  - `ManagedTab` interface: Tracks tab metadata and management state
  - Status update system with automatic idle detection
  - Event listeners for tab/group lifecycle management
  - Session initialization and state management methods
- **Integration**:
  - Automatically initializes on extension startup
  - Updates status based on WebSocket connection state
  - `tabs init <url>` command triggers explicit session initialization
  - All automation commands automatically ensure tabs are managed
  - Enhanced `tabs.openTab()` to use managed tab groups
  - `getAllTabs()` filters to managed tabs only when session is initialized
- **Tab Group Benefits**:
  - **Visual Isolation**: Controlled tabs grouped separately from user's regular tabs
  - **Easy Management**: Users can easily close all controlled tabs by closing the group
  - **Status Visibility**: Group title shows real-time system status
  - **Organization**: Keeps automation sessions organized and contained
  - **Explicit Control**: User decides when to start a managed session with `tabs init` command

#### `extension/src/background/index.ts`
- **Purpose**: Background script - main extension logic
- **Responsibilities**:
  - WebSocket connection management
  - Command routing to appropriate handlers
  - Response sending back to server
  - Extension lifecycle management
  - Visual mouse pointer coordination and single-tab display management
- **Key Functions**:
  - `handleCommand()`: Main command dispatcher for all automation operations
  - `cleanupVisualMouseInAllTabs()`: Destroys visual mouse pointers in all tabs on disconnect
  - `cleanupVisualMouseInTab()`: Destroys visual mouse pointer in a specific tab
  - `updateVisualMouse()`: Sends mouse position/action updates to content scripts with tab switching logic
  - `getViewportInfo()`: Retrieves viewport dimensions from content script
  - `injectContentScriptManually()`: Manually injects content script into tabs when needed
- **State Management**:
  - `currentActiveTabId`: Tracks the tab currently displaying visual mouse pointer
  - Tab switching automatically cleans up previous tab's visual mouse
  - Automatic cleanup on WebSocket disconnect and tab closure

#### `extension/src/content/index.ts`
- **Purpose**: Content script running in web pages
- **Current Functionality**: 
  - Initializes visual mouse pointer via `VisualMousePointer` class
  - Handles mouse position updates from background script
  - Provides viewport information with iframe detection and fallback
  - Manages visual feedback for mouse actions (clicks, moves, scrolls)
  - Responds to cleanup commands (`visual_mouse_destroy`)
- **Message Handlers**:
  - `get_viewport`: Returns viewport dimensions and device info
  - `visual_mouse_update`: Updates mouse position/action on screen
  - `visual_mouse_position`: Returns current visual mouse position
  - `visual_mouse_destroy`: Removes visual mouse pointer from page

#### `extension/src/content/visual-mouse.ts`
- **Purpose**: Visual mouse pointer overlay for operator feedback
- **Key Features**:
  - Traditional arrow-shaped pointer with drop shadow
  - Intelligent color coding: blue for clickable elements, green for text inputs
  - Visual animations for clicks (purple pulse), scrolls (blue movement), dragging (orange)
  - Automatic boundary checking and position tracking
  - Toggle visibility with Ctrl+Shift+M shortcut
  - Advanced viewport dimension detection with iframe handling
- **Key Methods**:
  - `getViewportInfo()`: Returns viewport dimensions, handles iframe cases, tries parent window
  - `handleMouseUpdate()`: Updates pointer position and triggers animations
  - `destroy()`: Removes pointer from DOM and cleans up event listeners
- **Integration**: Communicates with background script via Chrome messaging API

### CLI Module

#### `cli/main.py`
- **Purpose**: Command-line interface for interacting with server
- **Commands**:
  - `status`: Check server health
  - `mouse move/click/scroll/reset`: Mouse operations
  - `keyboard type/press`: Keyboard operations
  - `screenshot capture`: Screenshot capture
  - `tabs list/open/close/switch`: Tab management
  - `interactive`: Interactive REPL mode with shortcut commands
  - `script`: Execute commands from JSON file

**Interactive Mode Shortcut Commands**:
  - `reset`: Reset mouse to center
  - `click [left|right|middle]`: Click mouse button (default: left)
  - `move <dx> <dy>`: Move mouse relative
  - `scroll <up|down|left|right> [amount]`: Scroll (default: down, 100)
  - `type <text>`: Type text
  - `press <key> [modifiers]`: Press special key
  - `screenshot`: Capture screenshot
  - `tabs list`: List all tabs
  - `tabs open <url>`: Open new tab
  - `tabs close <tab_id>`: Close tab
  - `tabs switch <tab_id>`: Switch to tab

## Testing

### Test Structure

```
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests  
├── e2e/              # End-to-end tests
└── fixtures/         # Test fixtures
```

### Running Tests

```bash
# Unit tests
uv run pytest tests/unit -v

# Integration tests  
uv run pytest tests/integration -v

# All tests with coverage
uv run pytest tests/ --cov=server --cov-report=html
```

### Test HTML Pages

`html_test_pages/` contains HTML pages for regression testing browser automation:

- `basic_test.html`: Basic interactions (buttons, inputs, scroll, links, checkboxes)
- Future: Form testing, drag-and-drop, complex UI interactions

## Troubleshooting

### Common Issues

#### 1. Extension Shows "Disconnected"
- **Cause**: WebSocket connection failure
- **Check**:
  - Server is running: `local-chrome-server serve`
  - WebSocket server started: Check logs for "WebSocket server started"
  - Port availability: Port 8766 not blocked
  - Extension loaded: Check chrome://extensions/
  - Browser console: F12 → Console for extension errors

#### 2. WebSocket 403 Errors
- **Cause**: Connection rejection
- **Solutions**:
  - Check CORS settings in server
  - Verify WebSocket server is running on correct port
  - Ensure extension connects to correct URL (`ws://127.0.0.1:8766`)

#### 3. Commands Not Executing
- **Cause**: CDP attachment failure or command routing issue
- **Debug**:
  - Check server logs for command receipt
  - Check extension background page console
  - Verify Chrome debugger permission in manifest

#### 4. Coordinate Mapping Issues
- **Cause**: Resolution mismatch
- **Debug**:
  - Check preset vs actual resolution configuration
  - Verify screenshot metadata is being cached
  - Test coordinate mapping with simple movements

#### 5. Visual Mouse Pointer Not Displaying
- **Cause**: Content script not injected or communication failure
- **Debug**:
  - Check if page is a normal webpage (not chrome:// page)
  - Open webpage console (F12) to check for content script logs
  - Test content script injection: Run `injectContentScriptManually()` in background console
  - Verify manifest.json has correct content_scripts configuration
  - Reload page to trigger content script injection

#### 6. Mouse Position Tracking Issues
- **Cause**: Coordinate boundary overflow or tracking system failure
- **Debug**:
  - Use `chrome-cli mouse reset` to reset to screen center
  - Check boundary limits in `performMouseMove` function
  - Verify mouse position tracking is working in background logs
  - Test with small movements first

#### 7. Mouse Reset Position Incorrect or Inconsistent
- **Cause**: Intermittent failure to retrieve viewport size from content script, causing coordinate mapping errors
- **Common Scenarios**:
  - First reset works, second fails: Content script may not be responding to `get_viewport` messages
  - After exiting fullscreen mode: Cached viewport size not updated
  - In iframes or special page states: Content script may report zero or incorrect dimensions
- **Fix**: 
  - Clear viewport cache before reset: `viewportSizes.delete(tabId)` in `resetMousePosition`
  - Ensure coordinates are rounded to integers for CDP mouse movement
  - Enhanced retry logic (2 attempts) with content script injection on failure
  - Improved validation of received viewport dimensions
- **Debug**:
  - Check extension background logs for viewport size reported by content script
  - Verify actual viewport dimensions match reported values
  - Open webpage console (F12) to check content script logs for `getViewportInfo` calls
  - Check if content script is injected: Look for "OpenBrowser content script loaded" in webpage console
  - Reload page to ensure content script is injected and responding
- **Technical Details**:
  - Content script uses `window.innerWidth/Height` first, falls back to `document.documentElement.clientWidth/Height`
  - If both are zero, returns 800x600 (now improved to use screen estimate when available)
  - Background script validates dimensions and falls back to 1920x1080 if invalid

#### 8. Screenshot Timeout or Connection Reset
- **Cause**: Large screenshot images exceed WebSocket default message size limit
- **Symptoms**: Screenshot command times out with "Read timed out" error, WebSocket disconnects with code 1009
- **Fix**: 
  - Increased WebSocket server `max_size` to 100MB (`100 * 1024 * 1024`)
  - Extension sends uncompressed PNG screenshots via data URLs
- **Debug**:
  - Check server logs for WebSocket disconnection messages
  - Verify WebSocket server started with increased message size
  - Test with smaller viewport sizes to confirm basic functionality

#### 9. Click Commands Show Success But Page Doesn't Respond
- **Cause**: Mouse click coordinates not converted from preset system to actual screen coordinates
- **Symptoms**: CLI shows "Command executed successfully" but no action occurs on webpage
- **Fix**:
  - Updated `performClick` function to convert preset coordinates to actual screen coordinates
  - Added detailed CDP command logging for `mouseMoved`, `mousePressed`, `mouseReleased`
  - Same coordinate conversion logic as `performMouseMove` function
- **Debug**:
  - Check extension background logs for coordinate conversion: `preset (x,y) -> actual (x,y)`
  - Verify CDP commands are being sent: Look for "Sending mousePressed" and "mousePressed command successful" logs
  - Ensure debugger is attached to tab (should show "Debugger attached successfully")

#### 10. Iframe Viewport Size Returns Zero or Incorrect Dimensions
- **Cause**: Content script injected into iframe instead of main window, returning iframe dimensions
- **Symptoms**: Viewport size reports 0 height or very small dimensions, coordinate mapping fails
- **Fix**:
  - Send `get_viewport` messages only to main frame (`frameId: 0`)
  - Enhanced content script to try parent window dimensions when in iframe
  - Return special failure value (-1) when no valid dimensions found
- **Debug**:
  - Check content script logs for `isInIframe=true` 
  - Look for "Current iframe has invalid dimensions, trying parent window" messages
  - Verify main frame content script injection (check webpage console)

#### 11. Visual Mouse Pointer Remains After Extension Disconnect or Shows on All Tabs
- **Cause**: 
  1. No cleanup mechanism for visual mouse pointers when WebSocket disconnects
  2. Mouse pointers showing on all tabs instead of just the currently active tab
- **Symptoms**: 
  - Mouse pointer overlay stays visible on pages after server stops or extension disconnects
  - Blue cursor appears on multiple tabs simultaneously
  - Switching tabs leaves mouse pointer on previous tab
- **Fix**:
  - **Active tab tracking**: Background script tracks `currentActiveTabId` for visual mouse display
  - **Tab switching cleanup**: `updateVisualMouse()` cleans up previous tab's pointer when switching tabs
  - **Targeted cleanup**: `cleanupVisualMouseInTab()` function for single tab cleanup
  - **Disconnect handling**: WebSocket disconnect triggers full cleanup and resets `currentActiveTabId`
  - **Tab close handling**: `chrome.tabs.onRemoved` listener resets active tab when tab closes
- **Debug**:
  - Check extension background logs for "Switching from tab X to tab Y, cleaning up old visual mouse"
  - Look for "Current active tab set to: X" messages
  - Monitor "Cleaning up visual mouse pointers in all tabs" on disconnect
  - Verify `visual_mouse_destroy` messages are sent to tabs

#### 12. Type Command Shows Success But No Text Appears
- **Cause**: CDP key events not properly configured for text input, especially for non-ASCII characters
- **Symptoms**: CLI shows "Command executed successfully" and extension logs show "Typing: ..." but no text appears in input fields
- **Fix**:
  - Use `Input.insertText` CDP command as primary method (simpler and more reliable)
  - Fall back to character-by-character `keyDown`/`char`/`keyUp` events if insertText fails
  - Proper handling of ASCII vs non-ASCII characters (Chinese, Unicode)
  - Added detailed logging for each CDP command success/failure
- **Debug**:
  - Check extension background logs for "Attempting to use Input.insertText"
  - Look for "Input.insertText successful" or "Input.insertText failed" messages
  - Monitor character-by-character typing logs if fallback is used
  - Ensure debugger is attached (should show "Debugger attached successfully")
  - Test with simple ASCII text first (e.g., "hello") to isolate character encoding issues

#### 13. Commands Hang Until Switching to Chrome Tab (Background Tab Responsiveness)
- **Cause**: Chrome throttles or pauses JavaScript execution and rendering in background tabs to save resources
- **Symptoms**: 
  - CLI commands hang indefinitely or timeout when Chrome tab is not active/focused
  - Commands complete instantly when switching to the Chrome tab
  - Particularly affects `reset_mouse`, `mouse_move`, `keyboard_type` and other automation commands
- **Technical Background**:
  - Chrome's Page Lifecycle API: Background tabs may enter "frozen" or "discarded" states
  - JavaScript timers and requestAnimationFrame are throttled in background tabs
  - Some CDP commands may wait for page to become responsive
- **Fix**:
  - **Automatic tab activation**: `activateTabForAutomation()` ensures tab is brought to foreground before commands
  - **Enhanced activation logic**: Checks if tab/window is already active to avoid unnecessary switching
  - **CDP command retries**: Added retry mechanism with exponential backoff for timeout errors
  - **Page responsiveness checks**: `Page.getLayoutMetrics` call to verify page is ready
  - **Increased timeout**: Default CDP timeout increased from 10s to 15s for background tabs
  - **Debugger state verification**: Additional checks after debugger attachment
- **Debug**:
  - Check logs for "🔧 Activating tab X for automation..."
  - Look for "✅ Tab X is already active and window is focused" or "✅ Window X focused"
  - Monitor CDP retry logs: "🔧 [CDP] Sending command '...' (attempt X/Y)"
  - Check for "🔍 [Computer] Ensuring page is responsive for tab X..."
  - Look for timeout or background tab related error messages
- **Advanced Configuration** (if needed):
  - Chrome flags: `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`
  - Experimental: Enable "Background tab throttling protection" in chrome://flags
  - Note: These flags affect Chrome globally and may impact performance/battery life

### Debug Logging

```bash
# Start server with debug logging
local-chrome-server serve --log-level DEBUG

# Check extension logs
# 1. Open chrome://extensions/
# 2. Find "OpenBrowser" extension
# 3. Click "Details" → "Inspect views: background page"
```

## Deployment

### Production Considerations

1. **Security**:
   - Restrict CORS origins in production
   - Add authentication for API endpoints
   - Validate all incoming commands

2. **Performance**:
   - Connection pooling for WebSocket
   - Command queue management
   - Screenshot compression and caching

3. **Reliability**:
   - Automatic reconnection for WebSocket
   - Command timeout handling
   - Error recovery mechanisms

### Extension Distribution

1. **Development**: Load unpacked from `extension/dist/`
2. **Testing**: Package as `.crx` for internal testing
3. **Production**: Publish to Chrome Web Store

## Contributing

### Development Workflow

1. Fork repository
2. Create feature branch
3. Make changes with tests
4. Run test suite
5. Submit pull request

### Code Standards

- **Python**: Follow PEP 8, use type hints, Pydantic for validation
- **TypeScript**: Strict typing, ESLint rules
- **Documentation**: Update relevant docs for changes
- **Testing**: Add tests for new functionality

### Release Process

1. Update version in `pyproject.toml` and `extension/package.json`
2. Update `CHANGELOG.md`
3. Run full test suite
4. Build extension: `cd extension && npm run build`
5. Create git tag
6. Push to repository

## References

### External Dependencies

- **FastAPI**: Python web framework
- **websockets**: WebSocket server implementation
- **Pydantic**: Data validation and settings management
- **Chrome DevTools Protocol**: Browser automation protocol
- **AIPex**: Reference implementation for CDP automation

### Related Projects

- **AIPex**: Browser automation with AI integration
- **Puppeteer**: Node.js browser automation
- **Selenium**: Web browser automation framework
- **Playwright**: Cross-browser automation

## Future Enhancements

### Planned Features

1. **Enhanced Visual Recognition**:
   - Template matching for element detection
   - OCR for text recognition in screenshots
   - Visual verification of actions

2. **Advanced Automation**:
   - Drag-and-drop operations
   - File upload/download handling
   - Multi-monitor support

3. **Improved Testing**:
   - Visual regression testing
   - Performance benchmarking
   - Load testing scenarios

4. **Developer Tools**:
   - Visual command recorder
   - Script generator from user actions
   - Debug visualization tools

### Technical Debt

1. **Architecture Simplification**: Consolidate WebSocket servers
2. **Error Handling**: More robust error recovery
3. **Testing Coverage**: Expand test coverage
4. **Documentation**: More examples and tutorials