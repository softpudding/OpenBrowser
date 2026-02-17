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
  - `parse_command()`: Factory function to create commands from JSON
- **Validation**: Uses Pydantic for schema validation

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
  - `WebSocketClient`: Manages connection, reconnection, message handling
  - `wsClient`: Global instance
- **Configuration**: Default URL `ws://127.0.0.1:8766`

#### `extension/src/commands/`
- **Purpose**: Chrome automation implementations
- **Modules**:
  - `cdp-commander.ts`: Chrome DevTools Protocol wrapper
  - `debugger-manager.ts`: Debugger attachment/detachment management
  - `computer.ts`: Mouse, keyboard, scroll operations (adapted from AIPex)
  - `screenshot.ts`: Screenshot capture with metadata caching
  - `tabs.ts`: Tab management operations

#### `extension/src/background/index.ts`
- **Purpose**: Background script - main extension logic
- **Responsibilities**:
  - WebSocket connection management
  - Command routing to appropriate handlers
  - Response sending back to server
  - Extension lifecycle management

#### `extension/src/content/index.ts`
- **Purpose**: Content script running in web pages
- **Current Functionality**: 
  - Initializes visual mouse pointer
  - Handles mouse position updates from background script
  - Provides viewport information
  - Manages visual feedback for mouse actions

#### `extension/src/content/visual-mouse.ts`
- **Purpose**: Visual mouse pointer overlay for operator feedback
- **Key Features**:
  - Traditional arrow-shaped pointer with drop shadow
  - Intelligent color coding: blue for clickable elements, green for text inputs
  - Visual animations for clicks (purple pulse), scrolls (blue movement), dragging (orange)
  - Automatic boundary checking and position tracking
  - Toggle visibility with Ctrl+Shift+M shortcut
- **Integration**: Communicates with background script via Chrome messaging API

### CLI Module

#### `cli/main.py`
- **Purpose**: Command-line interface for interacting with server
- **Commands**:
  - `status`: Check server health
  - `mouse move/click/scroll`: Mouse operations
  - `keyboard type/press`: Keyboard operations
  - `screenshot capture`: Screenshot capture
  - `tabs list/open/close/switch`: Tab management
  - `interactive`: Interactive REPL mode
  - `script`: Execute commands from JSON file

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

#### 7. Mouse Reset Position Incorrect After Exiting Fullscreen Mode
- **Cause**: Cached viewport size not updated after window resize, causing coordinate mapping errors
- **Fix**: 
  - Clear viewport cache before reset: `viewportSizes.delete(tabId)` in `resetMousePosition`
  - Ensure coordinates are rounded to integers for CDP mouse movement
  - Verify content script is providing fresh viewport size via `get_viewport` message
- **Debug**:
  - Check extension background logs for viewport size reported by content script
  - Verify actual viewport dimensions match reported values
  - Reload page to ensure content script is injected and responding

### Debug Logging

```bash
# Start server with debug logging
local-chrome-server serve --log-level DEBUG

# Check extension logs
# 1. Open chrome://extensions/
# 2. Find "Local Chrome Control" extension
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