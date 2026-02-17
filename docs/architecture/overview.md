# Architecture Overview

## System Design

Local Chrome Server is a distributed system for browser automation that uses visual coordinates rather than HTML element selectors. The system consists of two main components:

1. **Python Server**: REST API, WebSocket server, and command processor
2. **Chrome Extension**: Browser automation via Chrome DevTools Protocol (CDP)

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Clients                         │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐  │
│  │   CLI      │  │   REST API │  │   Other Clients     │  │
│  │   Tool     │  │   Clients  │  │   (Python, etc.)    │  │
│  └────────────┘  └────────────┘  └─────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │ HTTP/JSON
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Python Server (FastAPI)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    FastAPI App                       │  │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────┐   │  │
│  │  │   REST     │  │   WebSocket│  │   Command    │   │  │
│  │  │   Endpoints│  │   Endpoint │  │   Processor  │   │  │
│  │  └────────────┘  └────────────┘  └──────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                    │                    │                   │
│           WebSocket│             Internal│                  │
│           (port 8766)           │                  │
│                    ▼                    ▼                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              WebSocket Server                        │  │
│  │          (Independent, port 8766)                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │ WebSocket (JSON)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Chrome Extension                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Background Script                      │  │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────┐   │  │
│  │  │ WebSocket  │  │  Command   │  │   Response   │   │  │
│  │  │  Client    │  │  Router    │  │   Handler    │   │  │
│  │  └────────────┘  └────────────┘  └──────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                    │                                        │
│           Chrome   │                                        │
│           Runtime  │                                        │
│           API      ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Chrome Automation                       │  │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────┐   │  │
│  │  │   CDP      │  │   Mouse/   │  │   Tabs       │   │  │
│  │  │ Commander  │  │   Keyboard │  │   Manager    │   │  │
│  │  └────────────┘  └────────────┘  └──────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │ Chrome DevTools Protocol
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Browser                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Target Tab                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Communication Flow

### 1. Command Initiation
- **CLI**: User runs `chrome-cli mouse move --dx 100 --dy 50`
- **REST API**: Client sends POST request to `/command` endpoint
- **WebSocket**: Client sends JSON command directly via WebSocket

### 2. Server Processing
- **Command Validation**: Pydantic models validate command structure
- **Coordinate Mapping**: Commands with coordinates are mapped from preset to actual resolution
- **Command Routing**: Command processor routes to appropriate handler

### 3. Extension Communication
- **WebSocket Forwarding**: Server sends command to connected extension via WebSocket
- **Extension Reception**: Background script receives and parses command
- **Command Execution**: Extension executes command using CDP (mouse movement, keyboard, etc.)

### 4. Response Handling
- **Extension Response**: Extension sends success/error response back via WebSocket
- **Server Forwarding**: Server forwards response to original client
- **Client Notification**: CLI/REST client receives result

## Key Design Decisions

### 1. Visual-Only Automation
- **No HTML Selectors**: Operations use pixel coordinates only
- **Resolution Independence**: Coordinate mapping handles different screen sizes
- **Browser Agnostic**: In principle, works with any browser supporting CDP

### 2. Dual Communication Channels
- **REST API**: For simple, synchronous command execution
- **WebSocket**: For real-time, bidirectional communication
- **Independent WebSocket Server**: Dedicated server for extension communication

### 3. Coordinate System
- **Preset Resolution**: Default 2560x1440 (2K) as reference coordinate system
- **Actual Resolution**: User's actual screen/window dimensions
- **Linear Mapping**: Simple proportional scaling between coordinate systems
- **Viewport Awareness**: Accounts for CSS viewport vs window differences

### 4. Extension Architecture
- **Background Script**: Main logic, WebSocket communication, command routing
- **Content Script**: Minimal, for future viewport information gathering
- **CDP Integration**: Based on AIPex reference implementation
- **Manifest V3**: Modern Chrome extension architecture

## Data Flow

### Command Flow
```
Client → HTTP/WebSocket → FastAPI → Command Processor → WebSocket Server → Extension → CDP → Browser
```

### Response Flow
```
Browser → CDP → Extension → WebSocket Server → Command Processor → FastAPI → HTTP/WebSocket → Client
```

### Screenshot Flow
```
Browser → CDP → Extension → Screenshot Capture → Base64 Encoding → WebSocket Server → Command Processor → FastAPI → Client
```

## Module Responsibilities

### Python Server Modules

#### `server/models/commands.py`
- Command schema definitions using Pydantic
- Command validation and parsing
- Type-safe command creation

#### `server/core/config.py`
- Configuration management with pydantic-settings
- Environment variable support
- Default values for development

#### `server/core/coordinates.py`
- Coordinate mapping between preset and actual resolutions
- Linear scaling algorithm
- Viewport dimension handling

#### `server/core/processor.py`
- Command execution and routing
- Integration with WebSocket manager
- Response formatting

#### `server/websocket/manager.py`
- Independent WebSocket server
- Connection management
- Message routing between server and extension

#### `server/api/main.py`
- FastAPI application with REST endpoints
- WebSocket endpoint (`/ws`) for direct communication
- CORS middleware configuration

#### `server/main.py`
- CLI interface for server management
- Server lifecycle management
- Command-line argument parsing

### Chrome Extension Modules

#### `extension/src/types.ts`
- TypeScript type definitions
- Command and response interfaces
- Screenshot metadata types

#### `extension/src/websocket/client.ts`
- WebSocket client implementation
- Connection management with automatic reconnection
- Message sending and receiving

#### `extension/src/commands/`
- **cdp-commander.ts**: Chrome DevTools Protocol wrapper
- **debugger-manager.ts**: Debugger attachment management
- **computer.ts**: Mouse, keyboard, scroll operations (adapted from AIPex)
- **screenshot.ts**: Screenshot capture with metadata caching
- **tabs.ts**: Tab management operations

#### `extension/src/background/index.ts`
- Main extension background script
- Command routing and execution
- Extension lifecycle management

#### `extension/src/content/index.ts`
- Content script for web page interaction
- Viewport information gathering
- Future: Mouse position tracking

### CLI Module

#### `cli/main.py`
- Command-line interface for interacting with server
- Interactive REPL mode for real-time control
- Script execution from JSON files
- Health checking and diagnostics

## Scalability Considerations

### Single User, Single Browser
- Designed for local development and testing
- One Chrome instance controlled at a time
- Simple connection management

### Potential Extensions
- **Multiple Browsers**: Connection pooling for multiple Chrome instances
- **Multiple Extensions**: Load balancing across multiple extension instances
- **Remote Control**: WebSocket tunneling for remote browser control
- **Cluster Mode**: Multiple servers coordinating browser automation

## Security Considerations

### Local Development Focus
- **Localhost Only**: Default bind to 127.0.0.1
- **No Authentication**: Simple local development setup
- **CORS Permissive**: Allow all origins for development

### Production Hardening
- **Authentication**: API key or token-based authentication
- **CORS Restrictions**: Limit to specific origins
- **Input Validation**: Comprehensive command validation
- **Rate Limiting**: Prevent abuse of automation capabilities

## Performance Characteristics

### Latency Sources
1. **Network**: Localhost WebSocket communication (<1ms)
2. **CDP**: Chrome DevTools Protocol execution (10-100ms)
3. **Screenshot Processing**: Image capture and encoding (100-500ms)
4. **Coordinate Mapping**: Simple arithmetic (<1ms)

### Optimization Opportunities
- **Command Batching**: Group multiple operations
- **Screenshot Caching**: Reuse screenshots when possible
- **Connection Pooling**: Reuse WebSocket connections
- **Parallel Execution**: Concurrent command execution where possible

## Future Architecture Evolution

### Short-term Improvements
1. **Unified WebSocket Server**: Consolidate FastAPI and independent WebSocket servers
2. **Enhanced Error Handling**: Better recovery from connection failures
3. **Performance Monitoring**: Metrics collection and analysis

### Medium-term Enhancements
1. **Visual Recognition**: Template matching and OCR integration
2. **Script Recording**: Record user actions as executable scripts
3. **Cross-browser Support**: Firefox, Safari via their automation protocols

### Long-term Vision
1. **Cloud Service**: Browser automation as a service
2. **AI Integration**: Intelligent command generation and optimization
3. **Visual Testing Framework**: Comprehensive visual regression testing