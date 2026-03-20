"""
Tests for OpenBrowserToolSet - ToolSet that aggregates all 5 OpenBrowser tools.

This test suite verifies that the ToolSet correctly aggregates all 5 tools,
ensures shared executor state, and follows the OpenHands SDK pattern.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Add server root to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Mock openhands.tools to avoid import errors
import importlib
import types


class MockTerminalTool:
    name = "terminal"


class MockFileEditorTool:
    name = "file_editor"


class MockTaskTrackerTool:
    name = "task_tracker"


# Create mock modules
terminal_module = types.ModuleType("openhands.tools.terminal")
terminal_module.TerminalTool = MockTerminalTool
sys.modules["openhands.tools.terminal"] = terminal_module

file_editor_module = types.ModuleType("openhands.tools.file_editor")
file_editor_module.FileEditorTool = MockFileEditorTool
sys.modules["openhands.tools.file_editor"] = file_editor_module

task_tracker_module = types.ModuleType("openhands.tools.task_tracker")
task_tracker_module.TaskTrackerTool = MockTaskTrackerTool
sys.modules["openhands.tools.task_tracker"] = task_tracker_module

# Mock openhands.tools.preset.default
preset_default_module = types.ModuleType("openhands.tools.preset.default")
preset_default_module.get_default_condenser = MagicMock(return_value=None)
sys.modules["openhands.tools.preset.default"] = preset_default_module

# Parent modules
sys.modules["openhands.tools"] = types.ModuleType("openhands.tools")
sys.modules["openhands.tools.preset"] = types.ModuleType("openhands.tools.preset")

# Now we can import normally
from server.agent.tools.toolset import OpenBrowserToolSet
from server.agent.tools.browser_executor import BrowserExecutor


class TestOpenBrowserToolSet:
    """Test suite for OpenBrowserToolSet."""

    def test_create_returns_five_tools(self):
        """Test that ToolSet.create() returns exactly 5 tools."""
        tools = OpenBrowserToolSet.create(None)
        assert len(tools) == 5

    def test_all_expected_tool_names_present(self):
        """Test that all expected tool names are present."""
        tools = OpenBrowserToolSet.create(None)
        tool_names = [tool.name for tool in tools]

        assert "tab" in tool_names
        assert "highlight" in tool_names
        assert "element_interaction" in tool_names
        assert "dialog" in tool_names
        assert "javascript" in tool_names

    def test_all_tools_share_executor(self):
        """Test that all tools share the same executor instance.

        This is critical for 2PC flow where ElementInteractionTool
        needs to access shared pending_confirmations state.
        """
        tools = OpenBrowserToolSet.create(None)

        # All tools should have the same executor instance
        if len(tools) > 0:
            executor = tools[0].executor
            for tool in tools[1:]:
                assert tool.executor is executor, (
                    f"Tool {tool.name} does not share executor with other tools"
                )

    def test_tools_have_correct_action_types(self):
        """Test that each tool has the correct action type."""

        # Load action types directly from tool modules
        def load_action_class(module_name, class_name):
            module_path = (
                Path(__file__).parent.parent.parent
                / "agent"
                / "tools"
                / f"{module_name}.py"
            )
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return getattr(module, class_name)

        TabAction = load_action_class("tab_tool", "TabAction")
        HighlightAction = load_action_class("highlight_tool", "HighlightAction")
        ElementInteractionAction = load_action_class(
            "element_interaction_tool", "ElementInteractionAction"
        )
        DialogHandleAction = load_action_class("dialog_tool", "DialogHandleAction")
        JavaScriptAction = load_action_class("javascript_tool", "JavaScriptAction")

        tools = OpenBrowserToolSet.create(None)
        tool_map = {tool.name: tool for tool in tools}

        assert tool_map["tab"].action_type.__name__ == TabAction.__name__
        assert tool_map["highlight"].action_type.__name__ == HighlightAction.__name__
        assert (
            tool_map["element_interaction"].action_type.__name__
            == ElementInteractionAction.__name__
        )
        assert tool_map["dialog"].action_type.__name__ == DialogHandleAction.__name__
        assert tool_map["javascript"].action_type.__name__ == JavaScriptAction.__name__

    def test_tools_have_correct_observation_type(self):
        """Test that all tools use OpenBrowserObservation."""
        # Load base module directly
        base_path = Path(__file__).parent.parent.parent / "agent" / "tools" / "base.py"
        spec = importlib.util.spec_from_file_location("base", base_path)
        base_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(base_module)
        OpenBrowserObservation = base_module.OpenBrowserObservation

        tools = OpenBrowserToolSet.create(None)
        for tool in tools:
            assert tool.observation_type.__name__ == OpenBrowserObservation.__name__

    def test_tools_have_descriptions(self):
        """Test that all tools have non-empty descriptions."""
        tools = OpenBrowserToolSet.create(None)
        for tool in tools:
            assert tool.description, f"Tool {tool.name} has empty description"
            assert len(tool.description) > 50, (
                f"Tool {tool.name} description too short: {tool.description}"
            )

    def test_tools_have_annotations(self):
        """Test that all tools have ToolAnnotations."""
        tools = OpenBrowserToolSet.create(None)
        for tool in tools:
            assert tool.annotations is not None, f"Tool {tool.name} missing annotations"

    def test_create_with_none_executor(self):
        """Test that create() works with None executor."""
        tools = OpenBrowserToolSet.create(None)
        assert len(tools) == 5
        # All tools should have an executor when created with None
        # (shared executor instance for the conversation)
        for tool in tools:
            assert tool.executor is not None
            assert isinstance(tool.executor, BrowserExecutor)

    def test_tool_order_is_consistent(self):
        """Test that tools are returned in a consistent order."""
        tools1 = OpenBrowserToolSet.create(None)
        tools2 = OpenBrowserToolSet.create(None)

        names1 = [tool.name for tool in tools1]
        names2 = [tool.name for tool in tools2]

        assert names1 == names2, "Tool order should be consistent across calls"

    def test_all_tools_are_tool_definitions(self):
        """Test that all returned tools are ToolDefinition instances."""
        from openhands.sdk.tool import ToolDefinition

        tools = OpenBrowserToolSet.create(None)
        for tool in tools:
            assert isinstance(tool, ToolDefinition), (
                f"Tool {tool.name} is not a ToolDefinition instance"
            )
