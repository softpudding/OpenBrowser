# Common Issues and Troubleshooting

## Issue 1: Extension Shows "Disconnected" Even After Starting Server

### Symptoms
- Chrome extension welcome page shows "🔴 Disconnected from Local Chrome Server"
- Status remains disconnected even after running `local-chrome-server serve`
- Refreshing the page doesn't help

### Root Causes
1. **Server not running**: The HTTP server is not accessible
2. **CORS issues**: Browser blocking requests to local server
3. **Port conflict**: Port 8765 is already in use
4. **Network configuration**: Localhost restrictions

### Solutions

#### Check Server Status
```bash
# Run diagnostics
python diagnose.py

# Or manually check
curl -v http://127.0.0.1:8765/health
```

#### Verify Server is Running
```bash
# Start server with debug logging
local-chrome-server serve --log-level DEBUG

# Check if process is running
ps aux | grep local-chrome-server
```

#### Check Port Availability
```bash
# Check if port 8765 is in use
lsof -i :8765  # macOS/Linux
netstat -ano | findstr :8765  # Windows

# Check if port 8766 (WebSocket) is in use
lsof -i :8766
```

#### Fix CORS Issues
The server already has permissive CORS settings for development. If issues persist:

1. **Check browser console** (F12 → Console) for CORS errors
2. **Try accessing directly**: Open `http://127.0.0.1:8765/health` in browser
3. **Disable CORS extensions**: Some Chrome extensions block localhost requests

#### Extension-Specific Checks
1. **Verify extension is loaded**: 
   - Open `chrome://extensions/`
   - Ensure "Local Chrome Control" is enabled
   - Check for errors in extension details

2. **Check extension background page**:
   - In `chrome://extensions/`, find "Local Chrome Control"
   - Click "Details" → "Inspect views: background page"
   - Check console for WebSocket connection errors

3. **Reload extension**:
   - In `chrome://extensions/`, click the refresh icon on the extension
   - Or disable/enable the extension

## Issue 2: WebSocket 403 Errors When Starting Server

### Symptoms
```bash
INFO:     127.0.0.1:53783 - "WebSocket /" 403
INFO:     connection rejected (403 Forbidden)
INFO:     connection closed
```

### Root Causes
1. **WebSocket handshake failure**: Missing or incorrect headers
2. **Origin rejection**: WebSocket server rejecting the connection origin
3. **Path mismatch**: Connecting to wrong WebSocket endpoint
4. **Authentication issue**: WebSocket server requiring authentication

### Solutions

#### Fix WebSocket Server Configuration
The WebSocket server has been updated to accept all origins. Ensure you're using the latest code:

1. **Update server configuration** in `server/websocket/manager.py`:
   ```python
   origins=None,  # Allow all origins for local development
   ```

2. **Restart server** with debug logging:
   ```bash
   local-chrome-server serve --log-level DEBUG
   ```

#### Verify Connection URLs
- **Extension connects to**: `ws://127.0.0.1:8766` (independent WebSocket server)
- **FastAPI WebSocket endpoint**: `ws://127.0.0.1:8765/ws`
- **Check extension code**: Ensure it's connecting to the correct URL

#### Test WebSocket Connection Manually
```bash
# Install websocat tool for testing WebSocket connections
# Then test both endpoints:
websocat ws://127.0.0.1:8766
websocat ws://127.0.0.1:8765/ws
```

#### Alternative: Use FastAPI WebSocket Endpoint
If independent WebSocket server has issues, modify extension to use FastAPI endpoint:

1. **Edit `extension/src/websocket/client.ts`**:
   ```typescript
   const DEFAULT_WS_URL = 'ws://127.0.0.1:8765/ws';
   ```

2. **Rebuild extension**:
   ```bash
   cd extension
   npm run build
   ```

3. **Reload extension** in Chrome

## Issue 3: Missing Python Dependencies (requests module)

### Symptoms
```bash
Traceback (most recent call last):
  File ".../chrome-cli", line 4, in <module>
    from cli.main import main
  File ".../cli/main.py", line 8, in <module>
    import requests
ModuleNotFoundError: No module named 'requests'
```

### Root Causes
1. **Dependencies not installed**: Missing `requests` package
2. **Virtual environment not activated**: Using system Python instead of project environment
3. **Outdated dependencies**: `pyproject.toml` doesn't include `requests`

### Solutions

#### Install Missing Dependencies
```bash
# Using uv (recommended)
uv sync

# Or using pip in virtual environment
source .venv/bin/activate  # macOS/Linux
pip install -e .
```

#### Check Virtual Environment
```bash
# Verify you're in the project virtual environment
which python
# Should show: /path/to/project/.venv/bin/python

# If not, activate it
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows
```

#### Verify Installation
```bash
# Check if requests is installed
python -c "import requests; print('✅ requests installed')"

# Check all dependencies
uv pip list | grep requests
```

## Issue 4: Commands Not Executing

### Symptoms
- CLI commands return success but nothing happens in browser
- Screenshot commands don't capture images
- Mouse/keyboard commands don't affect browser

### Root Causes
1. **Extension not connected**: WebSocket connection broken
2. **CDP attachment failed**: Chrome DevTools Protocol not attached to tab
3. **Command routing issue**: Commands not reaching extension
4. **Tab focus issue**: Wrong tab selected

### Solutions

#### Check Extension Connectivity
1. **Verify WebSocket connection** in extension background page console
2. **Check if commands are received** by extension
3. **Test simple command**:
   ```bash
   chrome-cli tabs list
   ```

#### Debug CDP Connection
1. **Check Chrome DevTools Protocol**:
   - Open `chrome://inspect/#devices` in Chrome
   - Ensure "Open dedicated DevTools for Node" is not blocking

2. **Verify debugger attachment**:
   - Extension needs `debugger` permission in manifest
   - Check for errors in background page console

#### Test Command Flow
1. **Send test command via HTTP**:
   ```bash
   curl -X POST http://127.0.0.1:8765/command \
     -H "Content-Type: application/json" \
     -d '{"type": "get_tabs", "command_id": "test"}'
   ```

2. **Check server logs** for command processing
3. **Check extension logs** for command receipt and execution

## Issue 5: Coordinate Mapping Issues

### Symptoms
- Mouse clicks at wrong positions
- Screenshots don't match expected area
- Scroll commands affect wrong amount

### Root Causes
1. **Resolution mismatch**: Preset vs actual screen resolution not calibrated
2. **Viewport issues**: CSS viewport different from window dimensions
3. **Multiple displays**: Coordinates scaled incorrectly across monitors

### Solutions

#### Calibrate Resolution Mapping
1. **Capture screenshot with metadata**:
   ```bash
   chrome-cli screenshot capture --include-metadata
   ```

2. **Check metadata** for actual screen and viewport dimensions
3. **Adjust preset resolution** in config if needed:
   ```python
   # server/core/config.py
   preset_resolution: tuple[int, int] = (1920, 1080)  # Your actual screen
   ```

#### Test Coordinate System
1. **Move mouse to known positions**:
   ```bash
   # Move to center of screen (relative to preset resolution)
   chrome-cli mouse move --dx 1280 --dy 720  # For 2560x1440 preset
   ```

2. **Take screenshot to verify** position
3. **Adjust coordinate mapping** if needed

## General Troubleshooting Steps

### Step 1: Run Diagnostics
```bash
python diagnose.py
```
Follow recommendations from the diagnostic output.

### Step 2: Check Logs
```bash
# Server logs (start with debug)
local-chrome-server serve --log-level DEBUG

# Extension logs (background page)
# 1. chrome://extensions/
# 2. Find "Local Chrome Control"
# 3. Click "Details" → "Inspect views: background page"

# Browser console for welcome page
# 1. Open welcome.html
# 2. F12 → Console
```

### Step 3: Verify All Components
1. **Python server**: `local-chrome-server serve`
2. **Chrome extension**: Loaded and enabled
3. **WebSocket connection**: Extension connected to server
4. **CDP access**: Extension has debugger permissions

### Step 4: Test Basic Functionality
```bash
# 1. Check server health
chrome-cli status

# 2. List tabs
chrome-cli tabs list

# 3. Test screenshot
chrome-cli screenshot capture --save test.png

# 4. Test mouse movement
chrome-cli mouse move --dx 100 --dy 100
```

### Step 5: Isolate the Issue
- Does HTTP API work? (`curl http://127.0.0.1:8765/health`)
- Does WebSocket connect? (Check extension background page)
- Do commands reach extension? (Check extension logs)
- Does CDP work? (Check for debugger attachment errors)

## Getting Help

If issues persist:

1. **Check existing issues**: Look for similar problems in issue tracker
2. **Collect debugging information**:
   ```bash
   # Server version
   local-chrome-server --version
   
   # Extension version
   cat extension/manifest.json | grep version
   
   # System information
   python --version
   node --version
   chrome://version/  # In Chrome browser
   ```

3. **Create detailed report** including:
   - Exact error messages
   - Steps to reproduce
   - Debug logs from server and extension
   - System configuration

4. **Submit issue** with all collected information