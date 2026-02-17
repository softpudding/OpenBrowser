# WebSocket API Reference

## Connection URLs

### Independent WebSocket Server
```
ws://127.0.0.1:8766
```

### FastAPI WebSocket Endpoint
```
ws://127.0.0.1:8765/ws
```

**Note**: The Chrome extension connects to the independent WebSocket server (port 8766) by default.

## Connection Lifecycle

### 1. Connection Establishment
- Client connects to WebSocket URL
- Server accepts connection and sends welcome message
- Extension begins listening for commands

### 2. Heartbeat/Ping
- Server sends periodic ping messages (every 30 seconds)
- Client should respond with pong
- Connection closed if no response after 10 seconds

### 3. Disconnection
- Normal closure: code 1000
- Extension disconnect: code 1001
- Server shutdown: code 1001
- Error: code 1011

## Message Format

All messages are JSON strings with the following base structure:

```json
{
  "type": "message_type",
  "timestamp": 1678886400.123,
  // ... type-specific fields
}
```

## Message Types

### Server → Client Messages

#### `connected` (Server → Client)
**Sent when**: Client connects successfully

**Message**:
```json
{
  "type": "connected",
  "message": "Connected to Local Chrome Server",
  "timestamp": 1678886400.123
}
```

#### `command` (Server → Client)
**Sent when**: Server wants client to execute a command

**Message**:
```json
{
  "type": "command",
  "command": {
    "type": "mouse_move",
    "dx": 100,
    "dy": 50,
    "command_id": "cmd-123"
  },
  "timestamp": 1678886400.123
}
```

#### `ping` (Server → Client)
**Sent when**: Server wants to check client connectivity

**Message**:
```json
{
  "type": "ping",
  "timestamp": 1678886400.123
}
```

**Client Response**: Should respond with `pong` message

### Client → Server Messages

#### `command_response` (Client → Server)
**Sent when**: Client has executed a command and returns result

**Message**:
```json
{
  "type": "command_response",
  "success": true,
  "command_id": "cmd-123",
  "message": "Mouse moved by (100, 50) pixels",
  "data": {
    "dx": 100,
    "dy": 50,
    "duration": 0.1
  },
  "error": null,
  "timestamp": 1678886400.123
}
```

Error response:
```json
{
  "type": "command_response",
  "success": false,
  "command_id": "cmd-123",
  "message": null,
  "data": null,
  "error": "Failed to attach debugger to tab",
  "timestamp": 1678886400.123
}
```

#### `pong` (Client → Server)
**Sent when**: Responding to server ping

**Message**:
```json
{
  "type": "pong",
  "timestamp": 1678886400.123
}
```

#### `event` (Client → Server)
**Sent when**: Client wants to notify server of an event

**Message**:
```json
{
  "type": "event",
  "event": "screenshot_captured",
  "data": {
    "tab_id": 123,
    "timestamp": 1678886400.123
  },
  "timestamp": 1678886400.123
}
```

## Command Execution Flow

### 1. Command Initiation
Server receives command via REST API or CLI and creates WebSocket message:

```json
{
  "type": "command",
  "command": {
    "type": "mouse_move",
    "dx": 100,
    "dy": 50,
    "command_id": "cmd-123"
  },
  "timestamp": 1678886400.123
}
```

### 2. Command Execution
Extension receives command, executes it via CDP, and sends response:

```json
{
  "type": "command_response",
  "success": true,
  "command_id": "cmd-123",
  "message": "Mouse moved by (100, 50) pixels",
  "data": {
    "dx": 100,
    "dy": 50,
    "duration": 0.1
  },
  "error": null,
  "timestamp": 1678886400.124
}
```

### 3. Response Forwarding
Server receives response and forwards to original client (REST API response or CLI output).

## Command Types

Commands sent via WebSocket use the same schema as REST API commands. See [REST API Documentation](rest.md) for complete command specifications.

### Mouse Commands
- `mouse_move`: `{ "type": "mouse_move", "dx": number, "dy": number, "duration": number (optional), "tab_id": number (optional) }`
- `mouse_click`: `{ "type": "mouse_click", "button": "left"|"right"|"middle", "double": boolean (optional), "count": number (optional), "tab_id": number (optional) }`
- `mouse_scroll`: `{ "type": "mouse_scroll", "direction": "up"|"down", "amount": number, "tab_id": number (optional) }`

### Keyboard Commands
- `keyboard_type`: `{ "type": "keyboard_type", "text": string, "tab_id": number (optional) }`
- `keyboard_press`: `{ "type": "keyboard_press", "key": string, "modifiers": array (optional), "tab_id": number (optional) }`

### Screenshot Command
- `screenshot`: `{ "type": "screenshot", "include_cursor": boolean (optional), "quality": number (optional), "tab_id": number (optional) }`

### Tab Commands
- `tab`: `{ "type": "tab", "action": "open"|"close"|"switch"|"list", "url": string (for "open"), "tab_id": number (for "close", "switch") }`
- `get_tabs`: `{ "type": "get_tabs" }`

## Error Handling

### Connection Errors
- **Connection refused**: Server not running or port blocked
- **Handshake failed**: Invalid origin or protocol mismatch
- **Timeout**: No response within configured timeout

### Message Errors
- **Invalid JSON**: Message not valid JSON
- **Missing type**: Message missing "type" field
- **Unknown type**: Message type not recognized
- **Validation error**: Command fails schema validation

### Command Execution Errors
- **Extension not ready**: Extension still initializing
- **CDP failure**: Chrome DevTools Protocol error
- **Tab not found**: Specified tab doesn't exist
- **Permission denied**: Extension lacks required permissions

## Example Session

### Client Connection
```
Client → Server: WebSocket handshake
Server → Client: { "type": "connected", "message": "Connected to Local Chrome Server", "timestamp": 1678886400.123 }
```

### Command Execution
```
Server → Client: { "type": "command", "command": { "type": "mouse_move", "dx": 100, "dy": 50, "command_id": "cmd-1" }, "timestamp": 1678886400.124 }
Client → Server: { "type": "command_response", "success": true, "command_id": "cmd-1", "message": "Mouse moved by (100, 50) pixels", "data": { "dx": 100, "dy": 50 }, "timestamp": 1678886400.125 }
```

### Heartbeat
```
Server → Client: { "type": "ping", "timestamp": 1678886430.123 }
Client → Server: { "type": "pong", "timestamp": 1678886430.124 }
```

### Disconnection
```
Server → Client: WebSocket close (code 1001, reason: "Server shutdown")
```

## Implementation Notes

### Chrome Extension
The extension's WebSocket client (`extension/src/websocket/client.ts`) handles:
- Connection establishment and reconnection
- Message serialization/deserialization
- Command routing to appropriate handlers
- Response sending back to server

### Python Server
The WebSocket server (`server/websocket/manager.py`) handles:
- Connection management
- Message routing between REST API and extension
- Heartbeat/ping mechanism
- Error handling and cleanup

### FastAPI WebSocket Endpoint
Alternative endpoint (`server/api/main.py`, `/ws`) provides:
- Direct WebSocket communication without independent server
- Same message format as independent server
- Integration with FastAPI middleware (CORS, etc.)

## Testing WebSocket Connection

### Using websocat
```bash
# Test independent WebSocket server
websocat ws://127.0.0.1:8766

# Test FastAPI WebSocket endpoint
websocat ws://127.0.0.1:8765/ws
```

### Using Python
```python
import asyncio
import websockets
import json

async def test_websocket():
    async with websockets.connect("ws://127.0.0.1:8766") as websocket:
        # Send ping
        await websocket.send(json.dumps({"type": "ping"}))
        
        # Receive response
        response = await websocket.recv()
        print(f"Received: {response}")

asyncio.run(test_websocket())
```

### Using Browser JavaScript
```javascript
const ws = new WebSocket('ws://127.0.0.1:8766');
ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => console.log('Received:', event.data);
ws.onclose = (event) => console.log('Disconnected:', event.code, event.reason);
```

## Performance Considerations

### Message Size
- Commands: Typically < 1KB
- Screenshot responses: 10KB - 2MB depending on quality and resolution
- Keep messages small for low latency

### Connection Management
- Single connection per extension instance
- Automatic reconnection on disconnect
- Connection pooling for multiple extensions (future)

### Latency
- Localhost WebSocket: < 1ms
- Command execution: 10-100ms
- Screenshot capture: 100-500ms
- Total round-trip: 50-600ms typical

## Security Considerations

### Local Development
- No authentication required
- Bind to localhost only (127.0.0.1)
- CORS allows all origins

### Production Deployment
- Add WebSocket authentication
- Use wss:// (WebSocket Secure)
- Validate message origins
- Implement rate limiting
- Log all connections and messages