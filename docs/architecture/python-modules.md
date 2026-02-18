# Python Server Modules

This document provides detailed documentation for the Python server modules.

## Module Overview

### `server/models/commands.py`

**Purpose**: Command schema definitions and validation

**Key Components**:
- `BaseCommand`: Base class for all commands
- Command types: `MouseMoveCommand`, `MouseClickCommand`, `KeyboardTypeCommand`, `JavascriptExecuteCommand`, etc.
- `TabCommand`: Tab management command with `TabAction` enum (OPEN, CLOSE, LIST, SWITCH, INIT, REFRESH)
- `parse_command()`: Factory function to create commands from JSON
- **Validation**: Uses Pydantic for schema validation

**Recent Updates**:
- Added `JavascriptExecuteCommand` for executing JavaScript code in browser tabs
- Added `INIT` action to `TabAction` enum for explicit session initialization
- Added `REFRESH` action to `TabAction` enum for tab refresh functionality
- Updated URL validator to support both `OPEN` and `INIT` actions
- `INIT` action requires URL parameter and creates managed tab group

**JavaScript Execution Support**:
- `JavascriptExecuteCommand`: Executes JavaScript code with options for return value serialization and Promise handling
- Parameters: `script` (required), `return_by_value` (default: true), `await_promise` (default: false), `timeout` (default: 30000ms)
- Returns: CDP result object with value or exception details
- Integrated with tab management system for isolated execution in managed tabs

### `server/core/config.py`

**Purpose**: Configuration management

**Key Components**:
- `ServerConfig`: Pydantic settings class
- Configuration sources: Environment variables, defaults

**Settings**:
- Host, port, preset resolution, timeouts, etc.

### `server/core/coordinates.py`

**Purpose**: Coordinate mapping between different resolutions

**Key Components**:
- `CoordinateMapping`: Maps between preset and actual screen resolutions
- `CoordinateManager`: Manages mappings for multiple tabs

**Algorithm**: Linear scaling with boundary clamping

### `server/core/processor.py`

**Purpose**: Command execution and routing

**Key Components**:
- `CommandProcessor`: Dispatches commands to appropriate handlers
- Integration with WebSocket manager for extension communication

**Tab Tracking**:
- Maintains `_current_tab_id` state
- Auto-fills `tab_id` when not specified
- Updates current tab on `init`, `open`, `switch` actions

### `server/websocket/manager.py`

**Purpose**: WebSocket server for extension communication

**Key Components**:
- `WebSocketManager`: Manages connections and message routing
- `ws_manager`: Global instance

**Protocol**: JSON-based message format with command/response pattern

**Features**:
- Support for large messages (100MB max size) for screenshot transmission
- Command timeout handling (30 seconds default)
- Automatic response matching using command_id
- Connection management with ping/pong keepalive

### `server/api/main.py`

**Purpose**: FastAPI application with REST and WebSocket endpoints

**Key Endpoints**:
- `GET /`, `/health`: Health checks
- `POST /command`: Generic command execution
- `POST /mouse/*`, `/keyboard/*`, `/screenshot`, `/tabs`: Shortcut endpoints
- `WS /ws`: WebSocket endpoint (alternative to independent WebSocket server)

### `server/main.py`

**Purpose**: CLI entry point for server management

**Commands**:
- `serve`: Start the server
- `check`: Check extension connectivity
- `execute`: Execute single command from file
- `demo`: Run demonstration sequence

## Command Processing Flow

```
Client Request → FastAPI → Command Validation → CommandProcessor → WebSocket Manager → Extension
                                                                                              ↓
Client Response ← FastAPI ← Response Formatting ← CommandProcessor ← WebSocket Manager ← Extension Response
```

## Tab Management System

The server maintains a unified tab management system:

1. **BaseCommand with tab_id**: All commands have optional `tab_id` field
2. **CommandProcessor tab tracking**: 
   - Maintains `_current_tab_id` state
   - Auto-fills `tab_id` when not specified
   - Updates current tab on `init`, `open`, `switch` actions
3. **Prepared command flow**: All commands go through `_send_prepared_command()` which ensures proper `tab_id`

**Workflow**:
```
tabs init https://example.com  # Creates managed tab, sets as current
screenshot                      # Captures from current managed tab
mouse_move 100 0               # Moves in current managed tab  
tabs switch <tab_id>           # Changes current tab
screenshot                      # Now captures from new current tab
```

## Configuration

### Environment Variables

- `CHROME_SERVER_HOST`: Server host (default: 127.0.0.1)
- `CHROME_SERVER_PORT`: HTTP port (default: 8765)
- `CHROME_SERVER_WEBSOCKET_PORT`: WebSocket port (default: 8766)
- `CHROME_SERVER_LOG_LEVEL`: Log level (default: info)

### Server Configuration

Configuration is managed via `server/core/config.py` using pydantic-settings:

```python
class ServerConfig(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8765
    websocket_port: int = 8766
    log_level: str = "info"
    preset_resolution: tuple[int, int] = (1280, 720)
    # ... more settings
```

## Error Handling

The server implements comprehensive error handling:

1. **Validation Errors**: Pydantic validation for all commands
2. **Connection Errors**: WebSocket connection monitoring
3. **Timeout Errors**: Command timeout handling (30s default)
4. **Extension Errors**: Extension disconnection detection

## Related Documentation

- [Architecture Overview](../architecture/overview.md) - System design and component architecture
- [REST API Reference](../api/rest.md) - HTTP endpoints and command reference
- [WebSocket API](../api/websocket.md) - Real-time communication protocol
- [CLI Usage](../cli/usage.md) - Command-line interface reference
