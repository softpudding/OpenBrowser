# OpenBrowser - Development Guide

## Project Overview

OpenBrowser (Local Chrome Server) is a system for programmatically controlling Chrome browser via a Chrome extension using JavaScript-based automation.

### 🎉 Key Feature: Zero-Disruption Background Automation

**Users can continue browsing while automation runs without any visual interruption.** All major operations (screenshot, JavaScript execution, tab management) run in background tabs without switching the user's view.

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

### Background Automation Design

**Problem**: Traditional browser automation switches user's active tab, causing disruption.

**Solution**: Use CDP to execute operations in background tabs:

```typescript
// ❌ Traditional approach (disruptive)
1. User viewing Tab A
2. Automation needs Tab B
3. Switch to Tab B (flash!)
4. Execute operation
5. Switch back to Tab A (flash!)

// ✅ OpenBrowser approach (non-disruptive)
1. User viewing Tab A
2. Automation needs Tab B
3. Execute CDP operation on Tab B (no switch)
4. User continues browsing Tab A
```

## Development Setup

### Prerequisites

- Python 3.12+ with `uv` package manager
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

# Extension development
cd extension
npm run dev                  # Watch mode for extension
npm run build                # Production build
npm run typecheck            # TypeScript type checking
```

## Module Documentation

## Supported Operations

### Background Operations (Zero-Disruption) ✅

All operations run completely in background tabs without switching user's view:

| Operation | Implementation | Flash-Free | Notes |
|-----------|---------------|------------|-------|
| **Screenshot** | CDP `Page.captureScreenshot` | ✅ | Captures background tabs |
| **JavaScript Execute** | CDP `Runtime.evaluate` | ✅ | Runs in background context |
| **Tab Init** | CDP + Tab Management | ✅ | Initializes managed session |
| **Tab Switch** | Internal state only | ✅ | No visible tab change |
| **Tab Refresh** | `chrome.tabs.reload` | ✅ | Reloads in background |
| **Tab List** | `chrome.tabs.query` | ✅ | Metadata only, no activation |

**User Experience**:
```
User browsing: Tab A
→ Execute JavaScript/screenshot on Tab B
→ Zero visual disruption
→ User continues on Tab A
```

### Python Server Modules

Key modules in `server/`:

- **`models/commands.py`**: Command schema definitions and validation using Pydantic
- **`core/config.py`**: Configuration management with environment variable support
- **`core/coordinates.py`**: Coordinate mapping between preset and actual screen resolutions
- **`core/processor.py`**: Command execution and routing with tab tracking
- **`websocket/manager.py`**: WebSocket server for extension communication
- **`api/main.py`**: FastAPI application with REST and WebSocket endpoints
- **`main.py`**: CLI entry point for server management

📖 **Detailed documentation**: [Python Server Modules](docs/architecture/python-modules.md)

### Chrome Extension Modules

Key modules in `extension/src/`:

- **`types.ts`**: TypeScript type definitions for commands and responses
- **`websocket/client.ts`**: WebSocket client with automatic reconnection
- **`commands/`**: CDP command implementations
  - `cdp-commander.ts`: Chrome DevTools Protocol wrapper
  - `debugger-manager.ts`: Debugger attachment management with auto-detach
  - `computer.ts`: Mouse, keyboard, scroll operations using CDP
  - `screenshot.ts`: Background screenshot capture with CDP
  - `tabs.ts`: Tab management operations
  - `tab-manager.ts`: Advanced tab group management for sessions
  - `javascript.ts`: JavaScript execution in browser tabs
- **`background/index.ts`**: Background script - main extension logic
  - Command routing and execution
  - Tab activation management (now minimized)
  - Global state tracking
  - Debug logging for troubleshooting
- **`content/`**: Content script for web page interaction

📖 **Detailed documentation**: [Chrome Extension Modules](docs/extension/modules.md)

### CLI Module

**`cli/main.py`**: Command-line interface for interacting with server

Commands:
- `status`: Check server health
- `screenshot capture`: Screenshot capture
- `tabs list/open/close/switch/refresh/init`: Tab management
- `interactive`: Interactive REPL mode
- `script`: Execute commands from JSON file

📖 **Detailed documentation**: [CLI Usage Guide](docs/cli/usage.md)

## Testing

### Test Structure

The project includes test infrastructure for validating browser automation functionality. Tests are planned to be organized as follows:

```
tests/
├── unit/              # Unit tests (planned)
├── integration/       # Integration tests (planned)
├── e2e/              # End-to-end tests (planned)
└── fixtures/         # Test fixtures (planned)
```

### Running Tests

```bash
# Run tests (when implemented)
uv run pytest tests/ -v

# Run with coverage
uv run pytest tests/ --cov=server --cov-report=html
```

### Test HTML Pages

`html_test_pages/` is planned to contain HTML pages for regression testing browser automation:

- `basic_test.html`: Basic interactions (buttons, inputs, scroll, links, checkboxes)

📖 **Detailed documentation**: [Testing and Regression](docs/testing/regression.md)

## Troubleshooting

### Common Issues

#### 1. Extension Shows "Disconnected"
- **Cause**: WebSocket connection failure
- **Check**: Server is running, WebSocket server started

#### 2. WebSocket 403 Errors
- **Cause**: WebSocket handshake failure
- **Solution**: Ensure WebSocket server accepts all origins

#### 3. Commands Not Executing
- **Cause**: Extension not connected or CDP attachment failed
- **Debug**: Check extension background page console

#### 4. ObservationEvent missing in SSE stream
- **Cause**: Tool execution blocking due to event loop competition
- **Workaround**: Use synchronous HTTP API calls instead of WebSocket

📖 **Detailed documentation**: [Troubleshooting Guide](docs/troubleshooting/common-issues.md)

## Key Design Decisions

### 1. JavaScript-First Automation
- **Primary Method**: JavaScript execution for all page interactions
- **No Visual Operations**: No mouse coordinates or keyboard simulation needed
- **Reliable & Fast**: Direct DOM access is more reliable than visual-based methods

### 2. Dual Communication Channels
- **REST API**: For simple, synchronous command execution
- **WebSocket**: For real-time, bidirectional communication
- **Independent WebSocket Server**: Dedicated server for extension communication

### 3. Tab Group Isolation
- **Visual Separation**: Controlled tabs grouped separately from user's regular tabs
- **Explicit Control**: User decides when to start a managed session with `tabs init`
- **Background Automation**: AI operations run without disrupting user browsing

## Implementation Notes

Key implementation details and historical notes:

- **Isolation Improvements (February 2026)**: Background automation mode to prevent focus stealing
- **Tab Management Fixes (February 2026)**: Unified tab tracking system
- **Screenshot Isolation (March 2025)**: CDP-based screenshot capture for background tabs
- **Refresh Functionality (February 2026)**: Added tab refresh action

📖 **Detailed documentation**: [Implementation Notes](docs/development/implementation-notes.md)

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

## Documentation Structure

- **[Architecture Overview](docs/architecture/overview.md)**: System design and component architecture
- **[Python Server Modules](docs/architecture/python-modules.md)**: Detailed server module documentation
- **[Chrome Extension Modules](docs/extension/modules.md)**: Detailed extension module documentation
- **[REST API Reference](docs/api/rest.md)**: HTTP endpoints and command reference
- **[WebSocket API](docs/api/websocket.md)**: Real-time communication protocol
- **[CLI Usage Guide](docs/cli/usage.md)**: Command-line interface reference
- **[Extension Setup](docs/extension/setup.md)**: Building and loading the extension
- **[Testing and Regression](docs/testing/regression.md)**: Testing strategies and automation
- **[Troubleshooting Guide](docs/troubleshooting/common-issues.md)**: Common issues and solutions
- **[Implementation Notes](docs/development/implementation-notes.md)**: Technical details and design decisions

---

*Last updated: February 2026*
