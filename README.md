# Local Chrome Server

A local server for controlling Chrome browser via Chrome extension with visual-based automation.

## Features

- **Visual Mouse Pointer**: Real-time mouse cursor overlay with intelligent color coding (clickable elements turn blue, text inputs turn green)
- **Mouse Control**: Move, click, scroll with relative coordinates and boundary checking
- **Keyboard Input**: Type text, press special keys with visual feedback
- **Screenshot Capture**: Real-time screenshots with mouse cursor
- **Advanced Tab Management**: 
  - **Tab Group Isolation**: Managed tabs organized in "OpenBrowser" tab group for visual separation
  - **Explicit Session Initialization**: `tabs init <url>` command for explicit control session start
  - **Filtered Tab Listing**: `tabs list` shows only managed tabs when session is initialized
  - **Backward Compatibility**: Shows all tabs with managed status when no active session
  - **Status Visualization**: Tab group title shows real-time status (🔵 active, ⚪ idle, 🔴 disconnected)
- **Multiple Interfaces**: REST API, WebSocket, CLI with readline support for arrow key editing
- **Coordinate Mapping**: Handles resolution differences between preset and actual screens
- **Visual-Only Operations**: No HTML selector dependencies, purely pixel-based
- **Interactive Debugging**: `chrome-cli interactive` mode with command history and editing

## Architecture

```
Local Chrome Server (Python)
├── FastAPI REST server
├── WebSocket server for real-time communication
├── Command processor with coordinate mapping
└── CLI interface

Chrome Extension (TypeScript)
├── CDP (Chrome DevTools Protocol) integration
├── Mouse/keyboard automation
├── Screenshot capture with metadata
└── WebSocket client for server communication
```

## Quick Start

### 1. Install Python Dependencies

```bash
# Using uv (recommended)
uv sync

# Or using pip
pip install -e .
```

### 2. Build Chrome Extension

```bash
cd extension
npm install
npm run build
```

### 3. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/dist` directory

### 4. Start the Server

```bash
# Start server (default: http://127.0.0.1:8765)
local-chrome-server serve

# Or with custom options
local-chrome-server serve --host 0.0.0.0 --port 8888
```

### 5. Use the CLI

```bash
# Check server status
chrome-cli status

# Open a new tab
chrome-cli tabs open https://google.com

# Take a screenshot
chrome-cli screenshot capture --save screenshot.png

# Interactive mode
chrome-cli interactive
```

## API Reference

### REST API (HTTP)

**Base URL**: `http://127.0.0.1:8765`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info |
| `/health` | GET | Health check |
| `/command` | POST | Execute any command (JSON) |
| `/mouse/move` | POST | Move mouse (dx, dy) |
| `/mouse/click` | POST | Click mouse (button, double) |
| `/mouse/scroll` | POST | Scroll (direction, amount) |
| `/keyboard/type` | POST | Type text |
| `/keyboard/press` | POST | Press special key |
| `/screenshot` | POST | Capture screenshot |
| `/tabs` | POST | Tab management (init, open, close, switch) |
| `/tabs` | GET | List all tabs |
| `/ws` | WS | WebSocket for real-time commands |

### WebSocket

Connect to `ws://127.0.0.1:8766` for real-time command execution.

### Command Format

Commands are JSON objects with the following structure:

```json
{
  "type": "mouse_move",
  "dx": 100,
  "dy": 50,
  "duration": 0.1,
  "command_id": "optional-uuid"
}
```

**Available Command Types:**

1. **Mouse Commands**
   - `mouse_move`: Move mouse relative to current position
   - `mouse_click`: Click at current mouse position
   - `mouse_scroll`: Scroll at current mouse position

2. **Keyboard Commands**
   - `keyboard_type`: Type text at current focus
   - `keyboard_press`: Press special key with modifiers

3. **Screenshot Command**
   - `screenshot`: Capture screenshot with optional cursor

4. **Tab Commands**
   - `tab`: Init, open, close, switch tabs
     - `init`: Initialize new managed session with starting URL (creates tab group)
     - `open`: Open new tab (automatically added to managed tab group)
     - `close`: Close specific tab
     - `switch`: Switch to specific tab
   - `get_tabs`: Get list of all tabs (shows only managed tabs when session initialized)

## Coordinate System

The system handles resolution differences between:
- **Preset Resolution**: Default 2560x1440 (2K) - what commands use
- **Actual Resolution**: User's actual screen/window resolution
- **Viewport Resolution**: CSS viewport dimensions

Coordinates are automatically mapped using linear scaling:
```
actual_x = (preset_x / preset_width) * actual_width
actual_y = (preset_y / preset_height) * actual_height
```

## Example Usage

### Python API Client

```python
import requests

server_url = "http://127.0.0.1:8765"

# Open Google
response = requests.post(f"{server_url}/tabs", json={
    "type": "tab",
    "action": "open",
    "url": "https://google.com"
})

# Type search query
requests.post(f"{server_url}/keyboard/type", json={
    "type": "keyboard_type",
    "text": "Hello World"
})

# Take screenshot
response = requests.post(f"{server_url}/screenshot", json={
    "type": "screenshot",
    "include_cursor": True
})
```

### CLI Examples

```bash
# Initialize a new managed session (creates tab group)
chrome-cli tabs init https://example.com

# List tabs (shows only managed tabs when session initialized)
chrome-cli tabs list

# Click at position (relative to preset resolution)
chrome-cli mouse click --button left --double

# Type text into focused element
chrome-cli keyboard type "Hello, World!"

# Capture and save screenshot
chrome-cli screenshot capture --save page.png --quality 90

# Run a script of commands
chrome-cli script commands.json
```

## Regression Tests

The project includes a regression test suite with HTML tasks:

```bash
# Run tests (to be implemented)
python -m pytest tests/
```

Test HTML pages are in `html_test_pages/` directory.

## Development

### Project Structure

```
.
├── server/              # Python server
│   ├── api/            # FastAPI endpoints
│   ├── core/           # Core logic (processor, coordinates)
│   ├── models/         # Pydantic models
│   ├── websocket/      # WebSocket server
│   └── main.py         # CLI entry point
├── extension/          # Chrome extension
│   ├── src/
│   │   ├── background/ # Background script
│   │   ├── commands/   # CDP commands
│   │   ├── content/    # Content script
│   │   ├── websocket/  # WebSocket client
│   │   └── types.ts    # TypeScript types
│   ├── assets/         # Extension icons
│   ├── public/         # Static assets
│   ├── manifest.json   # Extension manifest
│   └── package.json    # Extension dependencies
├── cli/                # Command-line interface
├── tests/              # Test suite
├── html_test_pages/    # Test HTML pages
└── pyproject.toml      # Python dependencies
```

### Building the Extension

```bash
cd extension
npm run build          # Production build
npm run dev            # Development build with watch
npm run typecheck      # TypeScript type checking
```

### Testing

```bash
# Install dev dependencies
uv sync --group dev

# Run tests
pytest

# Run with coverage
pytest --cov=server --cov-report=html
```

## Based on AIPex

This project references and adapts code from the [AIPex](https://github.com/AIPexStudio/AIPex) project, specifically:
- CDP (Chrome DevTools Protocol) integration
- Screenshot capture with metadata caching
- Coordinate mapping system
- Debugger management

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request