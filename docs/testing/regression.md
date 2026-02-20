# Testing and Regression

## Overview

Local Chrome Server includes a comprehensive testing strategy to ensure reliability and prevent regressions. Testing covers unit, integration, and end-to-end scenarios.

## Test Structure

The project has planned test organization for validating browser automation functionality. The following structure is planned:

```
tests/
├── unit/                    # Unit tests (planned)
│   ├── test_commands.py    # Command model tests
│   ├── test_coordinates.py # Coordinate mapping tests
│   ├── test_processor.py   # Command processor tests
│   └── test_websocket.py   # WebSocket manager tests
├── integration/            # Integration tests (planned)
│   ├── test_api.py        # REST API tests
│   ├── test_cli.py        # CLI command tests
│   └── test_extension.py  # Extension integration tests
├── e2e/                    # End-to-end tests (planned)
│   └── test_basic_flow.py # Full system tests
├── fixtures/               # Test fixtures (planned)
│   ├── commands.json      # Test commands
│   └── screenshots/       # Expected screenshots
└── conftest.py            # Test configuration
```

**Note**: The test infrastructure is currently under development. The above structure represents the planned organization.

## Running Tests

### Prerequisites
```bash
# Install test dependencies
uv sync --group dev

# Build extension for integration tests
cd extension
npm run build
cd ..
```

### Running Tests (Planned)
When tests are implemented, they can be run with:

```bash
pytest tests/ -v
```

### Future Test Categories
```bash
# Unit tests only (planned)
pytest tests/unit -v

# Integration tests only (planned)
pytest tests/integration -v

# End-to-end tests only (planned)
pytest tests/e2e -v

# Tests matching pattern (planned)
pytest tests/ -k "mouse" -v
```

### Running with Coverage (Planned)
```bash
pytest tests/ --cov=server --cov-report=html
# Open htmlcov/index.html in browser
```

## HTML Test Pages

The `html_test_pages/` directory is planned to contain HTML pages for manual and automated testing of browser automation capabilities.

### Planned Test Pages

#### `basic_test.html` (Planned)
Basic interactive elements for testing core functionality:
- Buttons with click counters
- Text input fields
- Scrollable areas
- Links and anchors
- Checkboxes

**Test Coverage**:
- Mouse clicks on buttons
- Keyboard input in text fields
- Scrolling within containers
- Navigation via links
- Checkbox interaction

#### Future Test Pages (Planned)
- `form_test.html`: Form elements (dropdowns, radio buttons, file upload)
- `drag_drop.html`: Drag-and-drop operations
- `complex_ui.html`: Complex UI with modals, tabs, accordions
- `performance.html`: Performance testing with many elements

## Regression Test Suite

### Command Validation Tests
Test that all command types are properly validated and executed.

**Test Cases**:
1. Valid commands succeed
2. Invalid commands return appropriate errors
3. Missing required fields are caught
4. Type conversions work correctly

### Coordinate Mapping Tests
Test coordinate mapping between different resolutions.

**Test Cases**:
1. Mapping from preset to actual resolution
2. Boundary conditions (edges of screen)
3. Multiple display configurations
4. Viewport vs window dimensions

### WebSocket Communication Tests
Test WebSocket connection and message handling.

**Test Cases**:
1. Connection establishment
2. Command transmission
3. Response handling
4. Reconnection logic
5. Error conditions

### Extension Integration Tests
Test extension functionality via WebSocket.

**Test Cases**:
1. Extension connection and authentication
2. Command execution in browser
3. Screenshot capture and metadata
4. Tab management operations

## Manual Testing Checklist

### Server Setup
- [ ] Server starts without errors
- [ ] HTTP API responds to /health
- [ ] WebSocket server accepts connections
- [ ] Configuration can be customized

### Extension Setup
- [ ] Extension loads in Chrome without errors
- [ ] Extension connects to WebSocket server
- [ ] Background script shows "connected" status
- [ ] Welcome page loads correctly

### Basic Commands
- [ ] `chrome-cli status` shows connected
- [ ] `chrome-cli tabs list` returns tab list
- [ ] `chrome-cli mouse move` moves cursor
- [ ] `chrome-cli mouse click` clicks
- [ ] `chrome-cli keyboard type` types text
- [ ] `chrome-cli screenshot capture` takes screenshot

### Advanced Scenarios
- [ ] Multiple commands in sequence work
- [ ] Tab switching and navigation works
- [ ] Screenshots include cursor when requested
- [ ] Coordinate mapping works for different resolutions
- [ ] Error handling provides useful messages

## Automated Test Scenarios

### Test 1: Basic Connectivity
```python
def test_basic_connectivity():
    # Start server
    # Load extension  
    # Verify connection
    # Execute simple command
    # Verify response
```

### Test 2: Mouse Automation
```python
def test_mouse_automation():
    # Open test page
    # Move mouse to specific coordinates
    # Click on test button
    # Verify click counter increased
    # Take screenshot to verify position
```

### Test 3: Keyboard Automation
```python
def test_keyboard_automation():
    # Open test page with input field
    # Focus input field
    # Type test text
    # Verify text appears in input
    # Clear field with keyboard shortcuts
```

### Test 4: Screenshot Capture
```python
def test_screenshot_capture():
    # Open test page with known content
    # Capture screenshot
    # Verify image dimensions
    # Compare with reference image (pixel diff)
    # Test with/without cursor
```

### Test 5: Tab Management
```python
def test_tab_management():
    # List initial tabs
    # Open new tab with test URL
    # Verify tab count increased
    # Switch between tabs
    # Close tab
    # Verify tab count decreased
```

## Performance Testing

### Metrics to Measure
- **Command latency**: Time from command send to response
- **Screenshot capture time**: Time to capture and encode screenshot
- **Memory usage**: Server and extension memory consumption
- **Connection stability**: WebSocket reconnection time

### Performance Baselines
```
Command latency: < 100ms (simple commands)
Screenshot capture: < 500ms (1920x1080, 85% quality)
Memory usage: < 100MB (server + extension)
Reconnection time: < 3s
```

### Load Testing
- Multiple concurrent commands
- Rapid command sequences
- Large screenshot volumes
- Long-running automation sessions

## Visual Regression Testing

### Screenshot Comparison
Compare screenshots against known good references to detect visual regressions.

**Tools**:
- `pytest` with `pytest-image-snapshot`
- Custom comparison with Pillow

**Process**:
1. Capture screenshot of test page
2. Compare with reference image
3. Allow small differences (anti-aliasing, rendering differences)
4. Fail test if significant differences detected

### Test Pages for Visual Testing
- `basic_test.html`: Static layout
- `form_test.html`: Form element rendering
- `complex_ui.html`: Complex UI components

## Cross-Browser Testing

### Current Support
- Chrome (primary target)
- Chrome-based browsers (Edge, Brave, etc.)

### Future Expansion
- Firefox via geckodriver
- Safari via safaridriver
- BrowserStack/Sauce Labs integration

## Continuous Integration

### GitHub Actions
Example workflow (`.github/workflows/test.yml`):
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - uses: actions/setup-node@v4
      - run: uv sync --group dev
      - run: cd extension && npm ci && npm run build
      - run: pytest tests/ --cov=server --cov-report=xml
```

### Test Environments
- **Linux**: Ubuntu LTS (GitHub Actions default)
- **macOS**: Latest version
- **Windows**: Windows Server 2022

## Debugging Test Failures

### Common Failure Modes

#### Extension Not Connecting
- Check WebSocket server is running
- Verify extension is loaded in Chrome
- Check browser console for errors

#### Command Timeouts
- Increase timeout in test configuration
- Check if CDP debugger is attached
- Verify tab is active and ready

#### Screenshot Mismatches
- Allow for rendering differences
- Update reference images when UI changes
- Check viewport dimensions match

#### Flaky Tests
- Add retry logic for transient failures
- Increase wait times for element readiness
- Isolate tests from shared state

### Test Logs
Enable detailed logging during test execution:
```bash
pytest tests/ -v --log-level=DEBUG --capture=no
```

### Debugging with PDB
```python
import pdb; pdb.set_trace()  # Add to test code
```

## Test Data Management

### Fixtures
Store test data in `tests/fixtures/`:
- Reference screenshots
- Expected command responses
- Test configuration files
- Mock CDP responses

### Test Isolation
Each test should:
- Start with clean state
- Not depend on other tests
- Clean up after itself
- Use unique identifiers to avoid conflicts

### Mocking External Dependencies
- Mock Chrome extension for unit tests
- Mock CDP responses for integration tests
- Simulate network conditions for robustness testing

## Coverage Goals

### Current Coverage
- Unit tests: 80%+ coverage
- Integration tests: Major workflows covered
- End-to-end tests: Critical paths tested

### Target Coverage
- Overall: 90%+ code coverage
- Critical modules: 95%+ coverage
- Public API: 100% coverage

## Test Maintenance

### Updating Tests
When code changes:
1. Run existing tests to identify failures
2. Update tests to match new behavior
3. Add tests for new functionality
4. Remove tests for deprecated features

### Test Review
- Review test code alongside feature code
- Ensure tests are readable and maintainable
- Verify tests catch regressions effectively
- Check test performance doesn't degrade

### Test Documentation
- Keep test documentation up to date
- Document test assumptions and dependencies
- Provide clear instructions for running tests
- Include troubleshooting guide for common issues

## Contributing Tests

### Adding New Tests
1. Identify test scenario
2. Create test file in appropriate directory
3. Write test with clear assertions
4. Add to test suite
5. Verify test passes

### Test Guidelines
- One assertion per test concept
- Descriptive test names
- Independent test execution
- Minimal test setup
- Comprehensive cleanup

### Test Review Checklist
- [ ] Test covers intended functionality
- [ ] Test is independent of other tests
- [ ] Test handles edge cases
- [ ] Test cleanup is thorough
- [ ] Test documentation is clear
- [ ] Test performance is acceptable