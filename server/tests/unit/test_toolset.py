"""Behavior-focused tests for OpenBrowserToolSet wiring."""

import sys
from pathlib import Path

import types

# Add server root to path for imports.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
agent_dir = Path(__file__).resolve().parents[2] / "agent"
tools_dir = agent_dir / "tools"

agent_module = types.ModuleType("server.agent")
agent_module.__path__ = [str(agent_dir)]
sys.modules.setdefault("server.agent", agent_module)

tools_module = types.ModuleType("server.agent.tools")
tools_module.__path__ = [str(tools_dir)]
sys.modules.setdefault("server.agent.tools", tools_module)


class MockTerminalTool:
    name = "terminal"


class MockFileEditorTool:
    name = "file_editor"


class MockTaskTrackerTool:
    name = "task_tracker"


terminal_module = types.ModuleType("openhands.tools.terminal")
terminal_module.TerminalTool = MockTerminalTool
sys.modules["openhands.tools.terminal"] = terminal_module

file_editor_module = types.ModuleType("openhands.tools.file_editor")
file_editor_module.FileEditorTool = MockFileEditorTool
sys.modules["openhands.tools.file_editor"] = file_editor_module

task_tracker_module = types.ModuleType("openhands.tools.task_tracker")
task_tracker_module.TaskTrackerTool = MockTaskTrackerTool
sys.modules["openhands.tools.task_tracker"] = task_tracker_module

preset_default_module = types.ModuleType("openhands.tools.preset.default")
preset_default_module.get_default_condenser = lambda: None
sys.modules["openhands.tools.preset.default"] = preset_default_module
sys.modules["openhands.tools"] = types.ModuleType("openhands.tools")
sys.modules["openhands.tools.preset"] = types.ModuleType("openhands.tools.preset")

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools import javascript_tool
from server.agent.tools.toolset import OpenBrowserToolSet


class TestOpenBrowserToolSet:
    def test_create_shares_one_executor_within_single_toolset(self) -> None:
        tools = OpenBrowserToolSet.create(None)

        executors = {tool.executor for tool in tools}

        assert len(tools) == 5
        assert len(executors) == 1
        assert isinstance(next(iter(executors)), BrowserExecutor)

    def test_create_returns_fresh_executor_per_call(self) -> None:
        first_tools = OpenBrowserToolSet.create(None)
        second_tools = OpenBrowserToolSet.create(None)

        assert first_tools[0].executor is not second_tools[0].executor

    def test_provided_executor_is_reused_for_all_tools_in_workflow_order(self) -> None:
        executor = BrowserExecutor()

        tools = OpenBrowserToolSet.create(None, executor)

        assert [tool.name for tool in tools] == [
            "tab",
            "highlight",
            "element_interaction",
            "dialog",
            "javascript",
        ]
        assert all(tool.executor is executor for tool in tools)

    def test_disabling_javascript_removes_only_fallback_tool(self, monkeypatch) -> None:
        monkeypatch.setattr(javascript_tool, "DISABLE_JAVASCRIPT_EXECUTE", True)

        tools = OpenBrowserToolSet.create(None)

        assert [tool.name for tool in tools] == [
            "tab",
            "highlight",
            "element_interaction",
            "dialog",
        ]

    def test_capability_hints_match_actual_tool_behavior(self) -> None:
        tools = {tool.name: tool for tool in OpenBrowserToolSet.create(None)}

        assert tools["tab"].annotations.destructiveHint is True
        assert tools["highlight"].annotations.readOnlyHint is True
        assert tools["element_interaction"].annotations.destructiveHint is True
        assert tools["dialog"].annotations.readOnlyHint is False
        assert tools["javascript"].annotations.openWorldHint is True
