# Chrome Extension Modules

This document provides detailed documentation for the Chrome extension modules.

## Extension Structure

```
extension/
├── src/
│   ├── background/          # Background script (main logic)
│   ├── commands/           # CDP command implementations
│   ├── content/            # Content script (minimal)
│   ├── websocket/          # WebSocket client
│   └── types.ts            # TypeScript type definitions
├── assets/                 # Extension icons
├── public/                 # Static assets (welcome.html)
├── manifest.json          # Extension manifest
├── package.json           # Node.js dependencies
├── tsconfig.json          # TypeScript configuration
├── vite.config.ts         # Build configuration
└── dist/                  # Built extension (output)
```

## Module Documentation

### `src/types.ts`

**Purpose**: TypeScript type definitions

**Key Types**:
- `Command`: Base command interface
- `CommandResponse`: Response format for all commands
- `ScreenshotMetadata`: Screenshot metadata interface
- `TabInfo`: Tab information structure

### `src/websocket/client.ts`

**Purpose**: WebSocket client for server communication

**Key Components**:
- `WebSocketClient`: Manages connection, reconnection, message handling, disconnect events
- `wsClient`: Global instance

**Configuration**: Default URL `ws://127.0.0.1:8766`

**Features**:
- Automatic reconnection with exponential backoff (max 10 attempts)
- Command/response pattern with timeout handling (30 seconds)
- Disconnect event notification system for cleanup tasks
- Large message support (100MB) for screenshot transmission

### `src/commands/` Directory

#### `cdp-commander.ts`

**Purpose**: Chrome DevTools Protocol wrapper

**Key Features**:
- Session management
- CDP command execution
- Connection timeout: 5000ms
- Command timeout: 30000ms

#### `debugger-manager.ts`

**Purpose**: Debugger attachment/detachment management

**Key Features**:
- Debugger attachment/detachment
- Auto-detach to prevent browser lock
- Tab debugging state management

#### `computer.ts`

**Purpose**: Mouse, keyboard, scroll operations (adapted from AIPex)

**Key Features**:
- Mouse movements, clicks, scrolling
- Keyboard typing and key presses
- Coordinate handling for CDP

#### `screenshot.ts`

**Purpose**: Screenshot capture with metadata caching

**Key Features**:
- Screenshot capture via CDP
- Metadata caching (dimensions, viewport)
- Base64 encoding and optimization
- Default quality: 85
- Default format: jpeg

**CDP Screenshot Support**:
- Uses `Page.captureScreenshot` for background tab capture
- `Page.getLayoutMetrics` for precise viewport dimensions
- Falls back to legacy `captureVisibleTab` if CDP fails
- Metadata field `captureMethod` distinguishes between CDP and legacy captures

#### `tabs.ts`

**Purpose**: Tab management operations

**Key Features**:
- Tab opening, closing, switching
- Tab listing and information
- Active tab management
- `getAllTabs(managedOnly=true)` for filtered tab listing

#### `tab-manager.ts`

**Purpose**: Advanced tab management with Chrome tab groups for visual isolation and organization

**Design Inspiration**: Based on MANUS Chrome Plugin's tab group isolation concept

**Key Features**:
- **Explicit Session Initialization**: `initializeSession(url)` method for explicit control session start
- **Tab Group Creation/Management**: Creates "OpenBrowser" tab group for visual separation
- **Automatic Tab Management**: Automatically adds controlled tabs to the managed group
- **Filtered Tab Listing**: `getAllTabs(managedOnly=true)` shows only managed tabs when session initialized
- **Session State Tracking**: `isSessionInitialized()` checks if tab group exists and has managed tabs
- **Status Visualization**: Shows real-time status via emoji indicators (🔵 active, ⚪ idle, 🔴 disconnected)
- **Activity Tracking**: Monitors tab activity to update status automatically
- **Backward Compatibility**: Falls back to simple tab management when tabGroups API unavailable (Chrome < 89)

**Core Components**:
- `TabManager` class: Singleton manager for tab group operations
- `ManagedTab` interface: Tracks tab metadata and management state
- Status update system with automatic idle detection
- Event listeners for tab/group lifecycle management
- Session initialization and state management methods

**Integration**:
- Automatically initializes on extension startup
- Updates status based on WebSocket connection state
- `tabs init <url>` command triggers explicit session initialization
- All automation commands automatically ensure tabs are managed
- Enhanced `tabs.openTab()` to use managed tab groups
- `getAllTabs()` filters to managed tabs only when session is initialized

**Tab Group Benefits**:
- **Visual Isolation**: Controlled tabs grouped separately from user's regular tabs
- **Easy Management**: Users can easily close all controlled tabs by closing the group
- **Status Visibility**: Group title shows real-time system status
- **Organization**: Keeps automation sessions organized and contained
- **Explicit Control**: User decides when to start a managed session with `tabs init` command

#### `javascript.ts`

**Purpose**: JavaScript code execution in browser tabs via Chrome DevTools Protocol

**Key Features**:
- **CDP Integration**: Uses `Runtime.evaluate` for JavaScript execution with full page context access
- **Return Value Support**: Can return serializable JSON values from JavaScript execution
- **Promise Support**: Optionally waits for Promise resolution with `await_promise` parameter
- **Error Handling**: Captures JavaScript exceptions with detailed stack traces
- **Type Safety**: Full TypeScript type definitions for CDP responses

**Core Components**:
- `executeJavaScript()`: Main function for executing JavaScript with comprehensive options
- `evaluateJavaScript()`: Simplified wrapper for common evaluation use cases
- `RuntimeEvaluateResult` interface: Type definition for CDP response

**Parameters**:
- `script`: JavaScript code to execute (string)
- `return_by_value`: Return result as serializable JSON (default: true)
- `await_promise`: Wait for Promise resolution (default: false)
- `timeout`: Execution timeout in milliseconds (default: 30000)

**Usage Examples**:
```typescript
// Get page title
await javascript.executeJavaScript(tabId, "document.title");

// Execute complex script with return value
const result = await javascript.executeJavaScript(tabId, 
  "({title: document.title, url: window.location.href})");
  
// Handle Promise
await javascript.executeJavaScript(tabId,
  "fetch('/api/data').then(r => r.json())", true, true);
```

**Integration**: 
- Added as new command type `javascript_execute` to command system
- Integrated into background script command handler
- Available via CLI, API, and AI agent tools
- Supports managed tab isolation and background execution

### `src/background/index.ts`

**Purpose**: Background script - main extension logic

**Responsibilities**:
- WebSocket connection management
- Command routing to appropriate handlers
- Response sending back to server
- Extension lifecycle management
- Visual mouse pointer coordination and single-tab display management

**Key Functions**:
- `handleCommand()`: Main command dispatcher for all automation operations
- `cleanupVisualMouseInAllTabs()`: Destroys visual mouse pointers in all tabs on disconnect
- `cleanupVisualMouseInTab()`: Destroys visual mouse pointer in a specific tab
- `updateVisualMouse()`: Sends mouse position/action updates to content scripts with tab switching logic
- `getViewportInfo()`: Retrieves viewport dimensions from content script
- `injectContentScriptManually()`: Manually injects content script into tabs when needed

**State Management**:
- `currentActiveTabId`: Tracks the tab currently displaying visual mouse pointer
- Tab switching automatically cleans up previous tab's visual mouse
- Automatic cleanup on WebSocket disconnect and tab closure

### `src/content/index.ts`

**Purpose**: Content script running in web pages

**Current Functionality**: 
- Initializes visual mouse pointer via `VisualMousePointer` class
- Handles mouse position updates from background script
- Provides viewport information with iframe detection and fallback
- Manages visual feedback for mouse actions (clicks, moves, scrolls)
- Responds to cleanup commands (`visual_mouse_destroy`)

**Message Handlers**:
- `get_viewport`: Returns viewport dimensions and device info
- `visual_mouse_update`: Updates mouse position/action on screen
- `visual_mouse_position`: Returns current visual mouse position
- `visual_mouse_destroy`: Removes visual mouse pointer from page

### `src/content/visual-mouse.ts`

**Purpose**: Visual mouse pointer overlay for operator feedback

**Key Features**:
- Traditional arrow-shaped pointer with drop shadow
- Intelligent color coding: blue for clickable elements, green for text inputs
- Visual animations for clicks (purple pulse), scrolls (blue movement), dragging (orange)
- Automatic boundary checking and position tracking
- Toggle visibility with Ctrl+Shift+M shortcut
- Advanced viewport dimension detection with iframe handling

**Key Methods**:
- `getViewportInfo()`: Returns viewport dimensions, handles iframe cases, tries parent window
- `handleMouseUpdate()`: Updates pointer position and triggers animations
- `destroy()`: Removes pointer from DOM and cleans up event listeners

**Integration**: Communicates with background script via Chrome messaging API

## Manifest Configuration

Key configuration in `manifest.json`:
- **Manifest version**: 3 (modern Chrome extensions)
- **Permissions**: `debugger`, `tabs`, `activeTab`, `scripting`, `storage`
- **Background script**: Service worker for persistent execution
- **Content script**: Injected into web pages for viewport information
- **Host permissions**: Access to all URLs for tab management
- **WebSocket**: Connects to `ws://127.0.0.1:8766`

## Building and Development

See [Extension Setup Guide](setup.md) for detailed build and development instructions.

## Related Documentation

- [Extension Setup](setup.md) - Building and loading the extension
- [Architecture Overview](../architecture/overview.md) - System design and component architecture
- [Implementation Notes](../development/implementation-notes.md) - Technical details and design decisions
