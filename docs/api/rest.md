# REST API Reference

## Base URL

```
http://127.0.0.1:8765
```

Default host and port can be changed via configuration.

## Authentication

No authentication required for local development. In production, consider adding API key authentication.

## Response Format

All endpoints return JSON responses with the following structure:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { /* command-specific data */ },
  "error": null,
  "timestamp": 1678886400.123
}
```

Error responses:
```json
{
  "success": false,
  "message": null,
  "data": null,
  "error": "Error description",
  "timestamp": 1678886400.123
}
```

## Health Check Endpoints

### GET `/`
**Description**: Server information and status

**Response**:
```json
{
  "success": true,
  "message": "Local Chrome Server is running",
  "data": {
    "name": "Local Chrome Server",
    "version": "0.1.0",
    "status": "healthy",
    "websocket_connections": 1,
    "extensions_connected": 1
  },
  "timestamp": 1678886400.123
}
```

### GET `/health`
**Description**: Simple health check

**Response**:
```json
{
  "success": true,
  "message": "Server is healthy",
  "data": {
    "status": "ok",
    "timestamp": 1678886400.123
  },
  "timestamp": 1678886400.123
}
```

## Command Execution

### POST `/command`
**Description**: Execute any command

**Request Body**:
```json
{
  "type": "command_type",
  "command_id": "optional-unique-id",
  // ... command-specific parameters
}
```

**Command Types**:
- `mouse_move`: Move mouse
- `mouse_click`: Click mouse
- `mouse_scroll`: Scroll at mouse position
- `keyboard_type`: Type text
- `keyboard_press`: Press key with modifiers
- `screenshot`: Capture screenshot
- `tab`: Tab operations (init, open, close, switch, list)
- `get_tabs`: Get list of all tabs (shows only managed tabs when session initialized)

**Response**:
```json
{
  "success": true,
  "message": "Command executed successfully",
  "data": { /* command-specific response data */ },
  "command_id": "request-command-id",
  "timestamp": 1678886400.123
}
```

## Mouse Commands

### POST `/mouse/move`
**Description**: Move mouse relative to current position

**Request Body**:
```json
{
  "dx": 100,
  "dy": 50,
  "duration": 0.1,
  "tab_id": 123,  // optional, uses current tab if not specified
  "command_id": "move-1"
}
```

**Parameters**:
- `dx` (number): Horizontal movement in pixels (relative to preset resolution)
- `dy` (number): Vertical movement in pixels (relative to preset resolution)
- `duration` (number, optional): Movement duration in seconds (default: 0.1)
- `tab_id` (number, optional): Target tab ID (uses current tab if not specified)

**Response**:
```json
{
  "success": true,
  "message": "Mouse moved by (100, 50) pixels",
  "data": {
    "dx": 100,
    "dy": 50,
    "duration": 0.1,
    "tab_id": 123
  },
  "command_id": "move-1",
  "timestamp": 1678886400.123
}
```

### POST `/mouse/click`
**Description**: Click at current mouse position

**Request Body**:
```json
{
  "button": "left",  // "left", "right", "middle"
  "double": false,   // true for double-click
  "count": 1,        // number of clicks (overrides double)
  "tab_id": 123,
  "command_id": "click-1"
}
```

**Parameters**:
- `button` (string): Mouse button ("left", "right", "middle")
- `double` (boolean, optional): Double click (default: false)
- `count` (number, optional): Number of clicks (default: 1, 2 for double)
- `tab_id` (number, optional): Target tab ID

**Response**:
```json
{
  "success": true,
  "message": "Mouse clicked with left button",
  "data": {
    "button": "left",
    "count": 1,
    "tab_id": 123
  },
  "command_id": "click-1",
  "timestamp": 1678886400.123
}
```

### POST `/mouse/scroll`
**Description**: Scroll at current mouse position

**Request Body**:
```json
{
  "direction": "down",  // "up", "down"
  "amount": 100,        // scroll amount in pixels
  "tab_id": 123,
  "command_id": "scroll-1"
}
```

**Parameters**:
- `direction` (string): Scroll direction ("up", "down")
- `amount` (number): Scroll amount in pixels
- `tab_id` (number, optional): Target tab ID

**Response**:
```json
{
  "success": true,
  "message": "Scrolled down by 100 pixels",
  "data": {
    "direction": "down",
    "amount": 100,
    "tab_id": 123
  },
  "command_id": "scroll-1",
  "timestamp": 1678886400.123
}
```

## Keyboard Commands

### POST `/keyboard/type`
**Description**: Type text at current focus

**Request Body**:
```json
{
  "text": "Hello, World!",
  "tab_id": 123,
  "command_id": "type-1"
}
```

**Parameters**:
- `text` (string): Text to type
- `tab_id` (number, optional): Target tab ID

**Response**:
```json
{
  "success": true,
  "message": "Typed: Hello, World!",
  "data": {
    "text": "Hello, World!",
    "length": 13,
    "tab_id": 123
  },
  "command_id": "type-1",
  "timestamp": 1678886400.123
}
```

### POST `/keyboard/press`
**Description**: Press special key with modifiers

**Request Body**:
```json
{
  "key": "Enter",  // Key name
  "modifiers": ["Control", "Shift"],  // Optional modifiers
  "tab_id": 123,
  "command_id": "press-1"
}
```

**Common Key Names**:
- `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`
- `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- `Home`, `End`, `PageUp`, `PageDown`
- `F1` through `F12`
- Letters: `A`, `B`, `C`, etc.
- Digits: `0` through `9`

**Modifiers**:
- `Control` (or `Ctrl`)
- `Shift`
- `Alt` (or `Option` on macOS)
- `Meta` (or `Command` on macOS)

**Response**:
```json
{
  "success": true,
  "message": "Pressed Enter with modifiers Control,Shift",
  "data": {
    "key": "Enter",
    "modifiers": ["Control", "Shift"],
    "tab_id": 123
  },
  "command_id": "press-1",
  "timestamp": 1678886400.123
}
```

## Screenshot Command

### POST `/screenshot`
**Description**: Capture screenshot of current tab

**Request Body**:
```json
{
  "include_cursor": true,
  "quality": 85,
  "tab_id": 123,
  "command_id": "screenshot-1"
}
```

**Parameters**:
- `include_cursor` (boolean, optional): Include mouse cursor in screenshot (default: true)
- `quality` (number, optional): JPEG quality 1-100 (default: 85)
- `tab_id` (number, optional): Target tab ID (uses current tab if not specified)

**Response**:
```json
{
  "success": true,
  "message": "Screenshot captured",
  "data": {
    "imageData": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
    "format": "jpeg",
    "width": 1920,
    "height": 1080,
    "quality": 85,
    "includeCursor": true,
    "tab_id": 123,
    "timestamp": 1678886400.123
  },
  "command_id": "screenshot-1",
  "timestamp": 1678886400.123
}
```

**Note**: The `imageData` field contains a data URL with base64-encoded image. You can extract the base64 portion after the comma.

## Tab Commands

### POST `/tabs`
**Description**: Tab management operations

**Request Body**:
```json
{
  "action": "open",  // "init", "open", "close", "switch", "list"
  "url": "https://example.com",  // required for "init" and "open"
  "tab_id": 123,  // required for "close", "switch"
  "command_id": "tab-1"
}
```

**Actions**:
- `init`: Initialize new managed session with starting URL (creates tab group)
- `open`: Open new tab with specified URL (automatically added to managed tab group)
- `close`: Close specified tab
- `switch`: Switch to specified tab
- `list`: List all tabs (shows only managed tabs when session initialized)

**Response for "init"**:
```json
{
  "success": true,
  "message": "Session initialized with https://example.com",
  "data": {
    "tabId": 456,
    "groupId": 1070690641,
    "url": "https://example.com/",
    "isManaged": true
  },
  "command_id": "tab-1",
  "timestamp": 1678886400.123
}
```

**Response for "open"**:
```json
{
  "success": true,
  "message": "Tab opened successfully",
  "data": {
    "tabId": 456,
    "url": "https://example.com",
    "title": "Example Domain"
  },
  "command_id": "tab-1",
  "timestamp": 1678886400.123
}
```

**Response for "close"**:
```json
{
  "success": true,
  "message": "Tab closed successfully",
  "data": {
    "tabId": 123
  },
  "command_id": "tab-1",
  "timestamp": 1678886400.123
}
```

**Response for "switch"**:
```json
{
  "success": true,
  "message": "Switched to tab 123",
  "data": {
    "tabId": 123,
    "active": true
  },
  "command_id": "tab-1",
  "timestamp": 1678886400.123
}
```

**Response for "list"**:
```json
{
  "success": true,
  "message": "Found 3 tabs",
  "data": {
    "tabs": [
      {
        "id": 123,
        "title": "Google",
        "url": "https://google.com",
        "active": true,
        "windowId": 1
      },
      {
        "id": 456,
        "title": "Example",
        "url": "https://example.com",
        "active": false,
        "windowId": 1
      }
    ],
    "count": 2
  },
  "command_id": "tab-1",
  "timestamp": 1678886400.123
}
```

### GET `/tabs`
**Description**: Get list of all tabs (same as POST with action="list")

**Response**: Same as POST `/tabs` with action="list"

## Error Handling

### HTTP Status Codes
- `200 OK`: Command executed successfully
- `400 Bad Request`: Invalid command or parameters
- `404 Not Found`: Endpoint not found
- `422 Unprocessable Entity`: Validation error
- `503 Service Unavailable`: Server or extension not ready

### Common Errors

**Invalid Command Type**:
```json
{
  "success": false,
  "message": null,
  "data": null,
  "error": "Unknown command type: invalid_type",
  "timestamp": 1678886400.123
}
```

**Missing Required Parameter**:
```json
{
  "success": false,
  "message": null,
  "data": null,
  "error": "Field required: 'dx'",
  "timestamp": 1678886400.123
}
```

**Extension Not Connected**:
```json
{
  "success": false,
  "message": null,
  "data": null,
  "error": "No Chrome extension connected",
  "timestamp": 1678886400.123
}
```

## Examples

### Using curl

**Check server health**:
```bash
curl http://127.0.0.1:8765/health
```

**Move mouse**:
```bash
curl -X POST http://127.0.0.1:8765/mouse/move \
  -H "Content-Type: application/json" \
  -d '{"dx": 100, "dy": 50}'
```

**Take screenshot**:
```bash
curl -X POST http://127.0.0.1:8765/screenshot \
  -H "Content-Type: application/json" \
  -d '{"include_cursor": true, "quality": 90}' \
  -o screenshot.json
```

**Initialize managed session**:
```bash
curl -X POST http://127.0.0.1:8765/tabs \
  -H "Content-Type: application/json" \
  -d '{"action": "init", "url": "https://example.com"}'
```

**Open new tab**:
```bash
curl -X POST http://127.0.0.1:8765/tabs \
  -H "Content-Type: application/json" \
  -d '{"action": "open", "url": "https://google.com"}'
```

### Using Python

```python
import requests

base_url = "http://127.0.0.1:8765"

# Check health
response = requests.get(f"{base_url}/health")
print(response.json())

# Move mouse
response = requests.post(f"{base_url}/mouse/move", json={
    "dx": 100,
    "dy": 50,
    "command_id": "test-move"
})
print(response.json())

# Take screenshot and save
response = requests.post(f"{base_url}/screenshot", json={
    "include_cursor": True,
    "quality": 85
})
data = response.json()
if data["success"]:
    import base64
    image_data = data["data"]["imageData"]
    # Extract base64 from data URL
    if image_data.startswith('data:image/'):
        image_data = image_data.split(',', 1)[1]
    
    with open('screenshot.jpg', 'wb') as f:
        f.write(base64.b64decode(image_data))
    print("Screenshot saved")
```

## Rate Limiting

No rate limiting implemented for local development. In production, consider adding rate limiting to prevent abuse.

## Versioning

API version is included in the server response metadata. Current version: 0.1.0

Backward compatibility will be maintained within major version 0.x. Breaking changes will be introduced in major version 1.0.0.