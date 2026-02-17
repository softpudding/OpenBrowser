# CLI Usage Guide

## Overview

The Local Chrome Server provides two CLI tools:

1. **`local-chrome-server`**: Server management and diagnostics
2. **`chrome-cli`**: Browser automation commands

## Installation

After installing the Python package:
```bash
uv sync  # or pip install -e .
```

Verify installation:
```bash
local-chrome-server --help
chrome-cli --help
```

## Server Management (`local-chrome-server`)

### `serve` - Start the server
Start the Local Chrome Server with optional configuration.

```bash
local-chrome-server serve [OPTIONS]
```

**Options**:
- `--host TEXT`: Host to bind to (default: 127.0.0.1)
- `--port INTEGER`: HTTP port (default: 8765)
- `--websocket-port INTEGER`: WebSocket port (default: 8766)
- `--log-level TEXT`: Log level (debug, info, warning, error) (default: info)
- `--help`: Show help

**Examples**:
```bash
# Start with default settings
local-chrome-server serve

# Start with debug logging
local-chrome-server serve --log-level debug

# Start on different ports
local-chrome-server serve --port 8888 --websocket-port 8889

# Bind to all interfaces (careful!)
local-chrome-server serve --host 0.0.0.0
```

### `check` - Check extension connectivity
Verify that Chrome extension is connected and responding.

```bash
local-chrome-server check [OPTIONS]
```

**Options**:
- `--timeout FLOAT`: Timeout in seconds (default: 5.0)
- `--help`: Show help

**Output**:
```
✅ Server is running on http://127.0.0.1:8765
✅ WebSocket server is running on ws://127.0.0.1:8766
✅ Chrome extension is connected (1 connection)
📊 Extension info: version 0.1.0, 3 tabs available
```

### `execute` - Execute command from file
Execute commands from a JSON file.

```bash
local-chrome-server execute [OPTIONS] FILE
```

**File format**:
```json
{
  "command": {
    "type": "mouse_move",
    "dx": 100,
    "dy": 50
  }
}
```

Or for multiple commands:
```json
[
  {
    "type": "mouse_move",
    "dx": 100,
    "dy": 50
  },
  {
    "type": "mouse_click",
    "button": "left"
  }
]
```

### `demo` - Run demonstration
Run a demonstration sequence showing server capabilities.

```bash
local-chrome-server demo [OPTIONS]
```

## Browser Automation (`chrome-cli`)

### `status` - Check server status
Check if server is running and extension is connected.

```bash
chrome-cli status
```

**Output**:
```
Server: ✅ Running (http://127.0.0.1:8765)
WebSocket: ✅ Connected (1 connection)
Extension: ✅ Connected (version 0.1.0)
Tabs: 3 tabs available
```

### Mouse Commands

#### `move` - Move mouse
Move mouse relative to current position.

```bash
chrome-cli mouse move [OPTIONS] --dx INTEGER --dy INTEGER
```

**Options**:
- `--dx INTEGER`: Horizontal movement (required)
- `--dy INTEGER`: Vertical movement (required)
- `--duration FLOAT`: Movement duration in seconds (default: 0.1)
- `--tab-id INTEGER`: Target tab ID (default: current tab)
- `--help`: Show help

**Examples**:
```bash
# Move right 100px, down 50px
chrome-cli mouse move --dx 100 --dy 50

# Move slowly
chrome-cli mouse move --dx 200 --dy 0 --duration 1.0

# Move in specific tab
chrome-cli mouse move --dx 50 --dy 50 --tab-id 123
```

#### `click` - Click mouse
Click at current mouse position.

```bash
chrome-cli mouse click [OPTIONS]
```

**Options**:
- `--button TEXT`: Mouse button (left, right, middle) (default: left)
- `--double`: Double click (default: false)
- `--count INTEGER`: Number of clicks (default: 1)
- `--tab-id INTEGER`: Target tab ID
- `--help`: Show help

**Examples**:
```bash
# Single left click
chrome-cli mouse click

# Double click
chrome-cli mouse click --double

# Right click
chrome-cli mouse click --button right

# Triple click
chrome-cli mouse click --count 3
```

#### `scroll` - Scroll at mouse position
Scroll at current mouse position.

```bash
chrome-cli mouse scroll [OPTIONS] --direction TEXT --amount INTEGER
```

**Options**:
- `--direction TEXT`: Scroll direction (up, down) (required)
- `--amount INTEGER`: Scroll amount in pixels (required)
- `--tab-id INTEGER`: Target tab ID
- `--help`: Show help

**Examples**:
```bash
# Scroll down 100px
chrome-cli mouse scroll --direction down --amount 100

# Scroll up 50px
chrome-cli mouse scroll --direction up --amount 50
```

### Keyboard Commands

#### `type` - Type text
Type text at current focus.

```bash
chrome-cli keyboard type [OPTIONS] TEXT
```

**Options**:
- `--tab-id INTEGER`: Target tab ID
- `--help`: Show help

**Examples**:
```bash
# Type simple text
chrome-cli keyboard type "Hello, World!"

# Type with tab targeting
chrome-cli keyboard type "Search query" --tab-id 123
```

#### `press` - Press key
Press special key with modifiers.

```bash
chrome-cli keyboard press [OPTIONS] --key TEXT
```

**Options**:
- `--key TEXT`: Key name (required)
- `--modifiers TEXT`: Modifiers (comma-separated: Control,Shift,Alt,Meta)
- `--tab-id INTEGER`: Target tab ID
- `--help`: Show help

**Key examples**: Enter, Tab, Escape, ArrowUp, ArrowDown, A, B, C, 1, 2, F1, F12

**Modifiers**: Control (or Ctrl), Shift, Alt (or Option), Meta (or Command)

**Examples**:
```bash
# Press Enter
chrome-cli keyboard press --key Enter

# Ctrl+C (copy)
chrome-cli keyboard press --key C --modifiers Control

# Ctrl+Shift+T (reopen closed tab)
chrome-cli keyboard press --key T --modifiers Control,Shift
```

### Screenshot Commands

#### `capture` - Capture screenshot
Capture screenshot of current tab.

```bash
chrome-cli screenshot capture [OPTIONS]
```

**Options**:
- `--save PATH`: Save to file (optional)
- `--include-cursor`: Include mouse cursor (default: true)
- `--no-cursor`: Exclude mouse cursor
- `--quality INTEGER`: JPEG quality 1-100 (default: 85)
- `--tab-id INTEGER`: Target tab ID
- `--include-metadata`: Include screenshot metadata in output
- `--help`: Show help

**Examples**:
```bash
# Capture and display info
chrome-cli screenshot capture

# Save to file
chrome-cli screenshot capture --save screenshot.jpg

# High quality without cursor
chrome-cli screenshot capture --save hi-res.png --quality 95 --no-cursor

# With metadata
chrome-cli screenshot capture --include-metadata
```

### Tab Commands

#### `list` - List all tabs
List all open tabs.

```bash
chrome-cli tabs list [OPTIONS]
```

**Options**:
- `--detailed`: Show detailed tab information
- `--help`: Show help

**Examples**:
```bash
# Simple list
chrome-cli tabs list

# Detailed information
chrome-cli tabs list --detailed
```

#### `open` - Open new tab
Open new tab with URL.

```bash
chrome-cli tabs open [OPTIONS] URL
```

**Options**:
- `--help`: Show help

**Examples**:
```bash
# Open Google
chrome-cli tabs open https://google.com

# Open local file
chrome-cli tabs open file:///path/to/file.html
```

#### `close` - Close tab
Close specified tab.

```bash
chrome-cli tabs close [OPTIONS] --tab-id INTEGER
```

**Options**:
- `--tab-id INTEGER`: Tab ID to close (required)
- `--help`: Show help

**Examples**:
```bash
# Close tab 123
chrome-cli tabs close --tab-id 123
```

#### `switch` - Switch to tab
Switch to specified tab.

```bash
chrome-cli tabs switch [OPTIONS] --tab-id INTEGER
```

**Options**:
- `--tab-id INTEGER`: Tab ID to switch to (required)
- `--help`: Show help

**Examples**:
```bash
# Switch to tab 123
chrome-cli tabs switch --tab-id 123
```

### Interactive Mode

#### `interactive` - Interactive REPL
Start interactive command-line interface.

```bash
chrome-cli interactive [OPTIONS]
```

**Features**:
- Tab-completion for commands
- Command history (up/down arrows)
- Real-time execution feedback
- Multi-line command input

**Interactive commands**:
- `mouse move <dx> <dy>`: Move mouse
- `mouse click [button]`: Click mouse
- `keyboard type <text>`: Type text
- `screenshot [filename]`: Capture screenshot
- `tabs list`: List tabs
- `tabs open <url>`: Open tab
- `tabs switch <id>`: Switch tab
- `help`: Show help
- `exit`: Exit interactive mode

**Example session**:
```
$ chrome-cli interactive
> tabs list
✅ Found 3 tabs:
  1. [123] Google - https://google.com (active)
  2. [456] GitHub - https://github.com
  3. [789] Local file - file:///test.html

> mouse move 100 50
✅ Mouse moved by (100, 50) pixels

> screenshot --save test.jpg
✅ Screenshot saved to test.jpg

> exit
```

### Script Execution

#### `script` - Execute commands from file
Execute commands from JSON script file.

```bash
chrome-cli script [OPTIONS] FILE
```

**File format**: JSON array of commands

**Example script** (`demo.json`):
```json
[
  {
    "type": "tabs",
    "action": "open",
    "url": "https://google.com"
  },
  {
    "type": "keyboard_type",
    "text": "Local Chrome Server"
  },
  {
    "type": "mouse_click",
    "button": "left"
  },
  {
    "type": "screenshot",
    "save": "google-search.png"
  }
]
```

**Usage**:
```bash
chrome-cli script demo.json
```

## Common Usage Patterns

### Automation Script
```bash
#!/bin/bash
# automate.sh

# Check server is running
chrome-cli status || {
  echo "Starting server..."
  local-chrome-server serve --log-level warning &
  SERVER_PID=$!
  sleep 2
}

# Open test page
chrome-cli tabs open file:///path/to/test.html
sleep 1

# Perform actions
chrome-cli mouse move --dx 100 --dy 100
chrome-cli mouse click --button left
chrome-cli keyboard type "Test input"
chrome-cli screenshot capture --save result.jpg

# Cleanup
if [ ! -z "$SERVER_PID" ]; then
  kill $SERVER_PID
fi
```

### Testing Workflow
```bash
# 1. Start server with debug logging
local-chrome-server serve --log-level debug > server.log 2>&1 &

# 2. Run test commands
chrome-cli tabs list
chrome-cli mouse move --dx 50 --dy 50
chrome-cli screenshot capture --save before.jpg

# 3. Check logs for issues
tail -f server.log

# 4. Stop server
pkill -f "local-chrome-server"
```

### Debugging Session
```bash
# Start server interactively
local-chrome-server serve --log-level debug

# In another terminal, test connectivity
chrome-cli status

# Test basic commands
chrome-cli tabs list
chrome-cli screenshot capture

# If commands fail, check extension background page
# chrome://extensions/ → Local Chrome Control → Inspect views: background page
```

## Environment Variables

### Server Configuration
- `CHROME_SERVER_HOST`: Server host (default: 127.0.0.1)
- `CHROME_SERVER_PORT`: HTTP port (default: 8765)
- `CHROME_SERVER_WEBSOCKET_PORT`: WebSocket port (default: 8766)
- `CHROME_SERVER_LOG_LEVEL`: Log level (default: info)

### CLI Configuration
- `CHROME_CLI_SERVER_URL`: Server URL (default: http://127.0.0.1:8765)
- `CHROME_CLI_TIMEOUT`: Command timeout in seconds (default: 30.0)

**Example**:
```bash
export CHROME_SERVER_PORT=8888
export CHROME_SERVER_LOG_LEVEL=debug
local-chrome-server serve
```

## Troubleshooting

### Command Not Found
```bash
# Check installation
which local-chrome-server
which chrome-cli

# Reinstall if missing
uv sync
```

### Connection Errors
```bash
# Check server status
chrome-cli status

# Start server if not running
local-chrome-server serve

# Check if port is in use
lsof -i :8765
```

### Permission Errors
- Ensure Chrome extension is loaded and enabled
- Extension needs `debugger` permission for CDP access
- Check extension background page for errors

### Timeout Errors
```bash
# Increase timeout
export CHROME_CLI_TIMEOUT=60
chrome-cli tabs list

# Or use command-line option
chrome-cli --timeout 60 tabs list
```

## Tips and Tricks

### Command Aliases
Create shell aliases for common commands:
```bash
# In ~/.bashrc or ~/.zshrc
alias ccs='local-chrome-server'
alias ccli='chrome-cli'
alias cctabs='chrome-cli tabs list'
alias ccscreen='chrome-cli screenshot capture --save'
```

### Scripting with Error Handling
```bash
#!/bin/bash
set -e  # Exit on error

# Function to execute with retry
execute_with_retry() {
  local cmd=$1
  local max_retries=3
  local retry_count=0
  
  while [ $retry_count -lt $max_retries ]; do
    if $cmd; then
      return 0
    fi
    retry_count=$((retry_count + 1))
    echo "Retrying ($retry_count/$max_retries)..."
    sleep 1
  done
  
  echo "Failed after $max_retries attempts"
  return 1
}

# Use in scripts
execute_with_retry "chrome-cli tabs open https://example.com"
```

### Logging to File
```bash
# Server logs
local-chrome-server serve --log-level info 2>&1 | tee server.log

# CLI output
chrome-cli tabs list 2>&1 | tee output.log
```

### Integration with Other Tools
```bash
# Use with jq for JSON processing
chrome-cli tabs list --detailed | jq '.data.tabs[] | select(.active)'

# Use with grep for filtering
chrome-cli tabs list | grep -i "github"

# Use in Python scripts
import subprocess
import json

result = subprocess.run(
    ['chrome-cli', 'tabs', 'list', '--detailed'],
    capture_output=True,
    text=True
)
data = json.loads(result.stdout)
print(f"Found {len(data['data']['tabs'])} tabs")
```