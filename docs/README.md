# Local Chrome Server Documentation

Welcome to the Local Chrome Server documentation. This comprehensive guide covers installation, usage, development, and troubleshooting.

## Quick Links

- **[Getting Started](#getting-started)** - First-time setup and basic usage
- **[Architecture](architecture/overview.md)** - System design and components
- **[API Reference](api/rest.md)** - REST and WebSocket APIs
- **[Extension Guide](extension/setup.md)** - Chrome extension setup and development
- **[CLI Usage](cli/usage.md)** - Command-line interface reference
- **[Testing](testing/regression.md)** - Testing and regression strategies
- **[Troubleshooting](troubleshooting/common-issues.md)** - Common issues and solutions
- **[Development](AGENTS.md)** - Development guide and project knowledge

## Getting Started

### Prerequisites
- Python 3.9+ with `uv` (recommended) or `pip`
- Node.js 16+ with `npm`
- Chrome browser for extension testing

### Installation
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

# 4. Start server
local-chrome-server serve

# 5. Use CLI
chrome-cli interactive
```

### Quick Test
```bash
# Check server status
chrome-cli status

# Initialize managed session (creates tab group)
chrome-cli tabs init https://example.com

# List tabs (shows only managed tabs)
chrome-cli tabs list

# Take screenshot
chrome-cli screenshot capture --save test.png

# Move mouse
chrome-cli mouse move --dx 100 --dy 50
```

## Documentation Structure

### Architecture
- [Overview](architecture/overview.md) - System design and component architecture
- Component responsibilities and data flow
- Design decisions and trade-offs

### API Documentation
- [REST API](api/rest.md) - HTTP endpoints and command reference
- [WebSocket API](api/websocket.md) - Real-time communication protocol
- Command schemas and response formats
- Examples and usage patterns

### Extension Development
- [Setup Guide](extension/setup.md) - Building and loading the extension
- Module descriptions and responsibilities
- Development workflow and debugging
- Configuration and customization

### CLI Reference
- [Usage Guide](cli/usage.md) - Complete command reference
- Server management commands
- Browser automation commands
- Interactive mode and scripting

### Testing
- [Regression Testing](testing/regression.md) - Test strategies and automation
- HTML test pages for manual testing
- Performance testing and benchmarks
- Continuous integration setup

### Troubleshooting
- [Common Issues](troubleshooting/common-issues.md) - Solutions to frequent problems
- Connection and setup issues
- Command execution failures
- Performance and reliability problems

### Development
- [AGENTS.md](../AGENTS.md) - Development guide and project knowledge
- Module documentation and interfaces
- Development setup and workflow
- Contributing guidelines

## Key Features

### Browser Automation
- **Mouse Control**: Move, click, scroll with relative coordinates
- **Keyboard Input**: Type text, press special keys with modifiers
- **Screenshot Capture**: Real-time screenshots with mouse cursor
- **Tab Management**: Open, close, switch, list tabs with tab group isolation and explicit session initialization

### Multiple Interfaces
- **REST API**: HTTP/JSON interface for programmatic access
- **WebSocket**: Real-time bidirectional communication
- **CLI Tools**: Interactive and scriptable command-line interface

### Smart Features
- **Coordinate Mapping**: Handles resolution differences automatically
- **Visual-Only Operations**: Pixel-based, no HTML selector dependencies
- **Error Recovery**: Automatic reconnection and failure handling

## Use Cases

### Development and Testing
- Automated browser testing
- Visual regression testing
- UI automation scripts
- Performance benchmarking

### Research and Data Collection
- Web scraping with visual interaction
- Screenshot-based data extraction
- User interaction simulation
- Accessibility testing

### Automation and Integration
- Workflow automation
- Integration with CI/CD pipelines
- Cross-browser testing
- Custom automation tools

## Support

### Getting Help
1. Check the [Troubleshooting Guide](troubleshooting/common-issues.md)
2. Run diagnostics: `python diagnose.py`
3. Check server logs: `local-chrome-server serve --log-level DEBUG`
4. Check extension logs: Background page console

### Reporting Issues
When reporting issues, include:
- Exact error messages and logs
- Steps to reproduce
- System information (OS, Chrome version, Python version)
- Server and extension versions

### Contributing
See [AGENTS.md](../AGENTS.md) for development guidelines and contribution instructions.

## License

Local Chrome Server is open source under the MIT License.

## Acknowledgments

- **AIPex**: Reference implementation for CDP automation
- **FastAPI**: Python web framework
- **websockets**: WebSocket server implementation
- **Pydantic**: Data validation and settings management

## Version History

- **0.1.0**: Initial release with core functionality
- Future releases: Enhanced visual recognition, cross-browser support, cloud service

---

*Last updated: February 2025*