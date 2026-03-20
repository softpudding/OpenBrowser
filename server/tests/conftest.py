"""Pytest fixtures for OpenBrowser server tests."""

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# Ensure server/ is in path for imports
_server_path = Path(__file__).resolve().parent.parent.parent / "server"
if str(_server_path) not in sys.path:
    sys.path.insert(0, str(_server_path.parent))

# Remove any cached imports of openhands.tools modules to ensure our mocks take effect
for key in list(sys.modules.keys()):
    if key.startswith("openhands.tools"):
        del sys.modules[key]

# Mock openhands.tools modules to avoid import errors during testing
# These modules are required by server/agent/manager.py but may not be available
# in the test environment or may cause import cycles.


# Create mock tool classes with proper name attributes
class MockTerminalTool:
    name = "terminal"


class MockFileEditorTool:
    name = "file_editor"


class MockTaskTrackerTool:
    name = "task_tracker"


# Create real module objects
terminal_module = types.ModuleType("openhands.tools.terminal")
terminal_module.TerminalTool = MockTerminalTool
sys.modules["openhands.tools.terminal"] = terminal_module

file_editor_module = types.ModuleType("openhands.tools.file_editor")
file_editor_module.FileEditorTool = MockFileEditorTool
sys.modules["openhands.tools.file_editor"] = file_editor_module

task_tracker_module = types.ModuleType("openhands.tools.task_tracker")
task_tracker_module.TaskTrackerTool = MockTaskTrackerTool
sys.modules["openhands.tools.task_tracker"] = task_tracker_module

# Mock openhands.tools.preset.default module
preset_default_module = types.ModuleType("openhands.tools.preset.default")
preset_default_module.get_default_condenser = MagicMock(return_value=None)
sys.modules["openhands.tools.preset.default"] = preset_default_module

# Parent modules (empty)
sys.modules["openhands.tools"] = types.ModuleType("openhands.tools")
sys.modules["openhands.tools.preset"] = types.ModuleType("openhands.tools.preset")

import pytest


@pytest.fixture
def sample_fixture():
    """A sample fixture for testing the test framework setup."""
    return {"status": "ok"}


@pytest.fixture
def mock_conversation_id():
    """Sample conversation ID for testing."""
    return "test-conversation-123"
