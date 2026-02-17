# Chrome Extension Setup and Development

## Overview

The Chrome extension is the bridge between the Python server and Chrome browser. It uses Chrome DevTools Protocol (CDP) to execute browser automation commands.

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

## Manifest (manifest.json)

Key configuration:
- **Manifest version**: 3 (modern Chrome extensions)
- **Permissions**: `debugger`, `tabs`, `activeTab`, `scripting`, `storage`
- **Background script**: Service worker for persistent execution
- **Content script**: Injected into web pages for viewport information
- **Host permissions**: Access to all URLs for tab management
- **WebSocket**: Connects to `ws://127.0.0.1:8766`

## Building the Extension

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation
```bash
cd extension
npm install
```

### Development Build
```bash
npm run dev  # Watch mode, rebuilds on changes
```

### Production Build
```bash
npm run build  # Creates dist/ directory
```

### Type Checking
```bash
npm run typecheck  # TypeScript compilation check
```

## Loading the Extension in Chrome

### Development Mode
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `extension/dist` directory
5. Extension should appear in list as "Local Chrome Control"

### Verifying Installation
- Check extension icon appears in Chrome toolbar
- Click extension icon to open welcome page
- Open background page console for debugging

### Debugging
1. **Background script**:
   - Go to `chrome://extensions/`
   - Find "Local Chrome Control"
   - Click "Details" → "Inspect views: background page"

2. **Content script**:
   - Open any web page
   - Open DevTools (F12)
   - Go to "Sources" → "Content scripts"

3. **Popup/welcome page**:
   - Click extension icon
   - Open DevTools on the welcome page

## Extension Modules

### WebSocket Client (`src/websocket/client.ts`)
- Manages connection to Python server
- Automatic reconnection on disconnect
- Message serialization/deserialization
- Command/response routing

### Command Implementations (`src/commands/`)

#### `cdp-commander.ts`
- Chrome DevTools Protocol wrapper
- Session management
- CDP command execution

#### `debugger-manager.ts`
- Debugger attachment/detachment
- Auto-detach to prevent browser lock
- Tab debugging state management

#### `computer.ts` (adapted from AIPex)
- Mouse movements, clicks, scrolling
- Keyboard typing and key presses
- Coordinate handling for CDP

#### `screenshot.ts`
- Screenshot capture via CDP
- Metadata caching (dimensions, viewport)
- Base64 encoding and optimization

#### `tabs.ts`
- Tab opening, closing, switching
- Tab listing and information
- Active tab management

### Background Script (`src/background/index.ts`)
- Main extension entry point
- WebSocket connection management
- Command routing to appropriate handlers
- Response sending back to server
- Extension lifecycle management

### Content Script (`src/content/index.ts`)
- Currently minimal implementation
- Provides viewport information
- Future: Mouse position tracking, element interaction

## Configuration

### WebSocket URL
Default: `ws://127.0.0.1:8766`

To change:
1. Edit `src/websocket/client.ts`:
   ```typescript
   const DEFAULT_WS_URL = 'ws://your-host:your-port';
   ```
2. Rebuild extension: `npm run build`
3. Reload extension in Chrome

### CDP Timeouts
Configured in `src/commands/cdp-commander.ts`:
- Connection timeout: 5000ms
- Command timeout: 30000ms
- Screenshot timeout: 10000ms

### Screenshot Settings
Configured in `src/commands/screenshot.ts`:
- Default quality: 85
- Default format: jpeg
- Metadata caching: Enabled

## Development Workflow

### 1. Make Code Changes
```bash
cd extension
# Edit TypeScript files in src/
```

### 2. Build and Test
```bash
npm run build
# Or use watch mode during development
npm run dev
```

### 3. Reload Extension
After building:
1. Go to `chrome://extensions/`
2. Find "Local Chrome Control"
3. Click the refresh icon
4. Check background page console for errors

### 4. Debug
- Check background page console
- Check server logs
- Use Chrome DevTools for debugging

## Testing

### Manual Testing
1. Start Python server: `local-chrome-server serve`
2. Load extension in Chrome
3. Use CLI to test commands:
   ```bash
   chrome-cli tabs list
   chrome-cli screenshot capture --save test.png
   chrome-cli mouse move --dx 100 --dy 100
   ```

### Automated Testing
To be implemented:
- Unit tests for command modules
- Integration tests with mock CDP
- End-to-end tests with test server

## Common Issues and Solutions

### Extension Not Connecting
1. **Check WebSocket URL** in background page console
2. **Verify server is running**: `local-chrome-server serve`
3. **Check firewall/network**: Allow localhost connections
4. **Try different port**: Modify URL and server config

### CDP Debugger Attachment Failed
1. **Check permissions**: Extension needs `debugger` permission
2. **Verify Chrome version**: CDP compatibility
3. **Check other debuggers**: Close other DevTools sessions
4. **Restart Chrome**: Sometimes needed after extension changes

### Commands Not Executing
1. **Check background page console** for errors
2. **Verify tab is attached**: CDP debugger must be attached
3. **Check command format**: Server logs show received commands
4. **Test simple command**: `chrome-cli tabs list`

### Screenshot Issues
1. **Check CDP permissions**: Some sites restrict screenshot
2. **Verify tab is active**: Screenshot requires active tab
3. **Check image encoding**: Base64 encoding issues
4. **Adjust quality**: Lower quality for faster capture

## Performance Optimization

### Connection Management
- Single WebSocket connection reused
- Automatic reconnection with exponential backoff
- Connection state persistence

### CDP Session Reuse
- CDP sessions reused across commands
- Debugger attached once per tab
- Session cleanup on tab close

### Screenshot Optimization
- Metadata cached to avoid repeated queries
- Quality adjustment based on use case
- Progressive JPEG encoding (future)

### Memory Management
- Screenshot data cleared after transmission
- CDP session cleanup
- Event listener removal

## Security Considerations

### Permissions
Minimum required permissions:
- `debugger`: For CDP access
- `tabs`: For tab management
- `activeTab`: For current tab access
- `scripting`: For content script injection

### Data Handling
- No user data stored permanently
- Screenshots transmitted only to local server
- No external network calls (except to configured server)

### Code Safety
- TypeScript for type safety
- Input validation for all commands
- Error handling for all operations
- No eval or dynamic code execution

## Updating the Extension

### Version Updates
1. Update version in `manifest.json` and `package.json`
2. Update changelog
3. Build new version: `npm run build`
4. Load updated extension in Chrome

### Chrome Web Store Submission
For public distribution:
1. Package extension: Create `.crx` file
2. Create developer account on Chrome Web Store
3. Submit extension for review
4. Publish after approval

## Troubleshooting

### Extension Not Loading
- Check manifest.json for errors
- Verify all required files exist in dist/
- Check Chrome console for extension errors

### WebSocket Connection Failed
- Verify server is running on correct port
- Check CORS settings on server
- Test WebSocket connection manually

### CDP Commands Failing
- Check debugger attachment status
- Verify tab ID is correct
- Check Chrome DevTools Protocol compatibility

### Memory Leaks
- Monitor memory usage in Chrome task manager
- Check for event listener accumulation
- Verify proper cleanup in content scripts

## Getting Help

1. **Check logs**: Background page console and server logs
2. **Reproduce issue**: Note exact steps
3. **Collect information**:
   - Chrome version
   - Extension version
   - Server version
   - Error messages
4. **Submit issue**: With all collected information