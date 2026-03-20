"""Shared unit-test shims for optional OpenHands tool imports."""

import sys
import types
from unittest.mock import MagicMock


class MockTerminalTool:
    name = "terminal"


class MockFileEditorTool:
    name = "file_editor"


class MockTaskTrackerTool:
    name = "task_tracker"


terminal_module = types.ModuleType("openhands.tools.terminal")
terminal_module.TerminalTool = MockTerminalTool
sys.modules.setdefault("openhands.tools.terminal", terminal_module)

file_editor_module = types.ModuleType("openhands.tools.file_editor")
file_editor_module.FileEditorTool = MockFileEditorTool
sys.modules.setdefault("openhands.tools.file_editor", file_editor_module)

task_tracker_module = types.ModuleType("openhands.tools.task_tracker")
task_tracker_module.TaskTrackerTool = MockTaskTrackerTool
sys.modules.setdefault("openhands.tools.task_tracker", task_tracker_module)

preset_default_module = types.ModuleType("openhands.tools.preset.default")
preset_default_module.get_default_condenser = MagicMock(return_value=None)
sys.modules.setdefault("openhands.tools.preset.default", preset_default_module)
sys.modules.setdefault("openhands.tools", types.ModuleType("openhands.tools"))
sys.modules.setdefault("openhands.tools.preset", types.ModuleType("openhands.tools.preset"))

