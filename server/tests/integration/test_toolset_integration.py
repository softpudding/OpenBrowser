"""Integration tests for cross-tool shared state."""

import sys
from pathlib import Path
import types

# Mock optional OpenHands tool modules before importing agent code.
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

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
agent_dir = Path(__file__).resolve().parents[2] / "agent"
tools_dir = agent_dir / "tools"

agent_module = types.ModuleType("server.agent")
agent_module.__path__ = [str(agent_dir)]
sys.modules.setdefault("server.agent", agent_module)

tools_module = types.ModuleType("server.agent.tools")
tools_module.__path__ = [str(tools_dir)]
sys.modules.setdefault("server.agent.tools", tools_module)

from server.agent.tools import javascript_tool
from server.agent.tools.toolset import OpenBrowserToolSet


class TestToolSetIntegration:
    def test_pending_confirmation_is_shared_across_tool_instances(self) -> None:
        tools = {tool.name: tool for tool in OpenBrowserToolSet.create(None)}
        shared_executor = tools["element_interaction"].executor
        shared_executor.conversation_id = "conv-shared"

        shared_executor._set_pending_confirmation(
            element_id="abc123",
            action_type="click",
            full_html="<button>Delete</button>",
        )

        assert (
            tools["dialog"].executor._get_pending_confirmation()["element_id"] == "abc123"
        )
        assert tools["tab"].executor._get_pending_confirmation()["action_type"] == "click"

    def test_confirmed_element_cache_is_isolated_by_conversation(self) -> None:
        tools = {tool.name: tool for tool in OpenBrowserToolSet.create(None)}
        executor = tools["element_interaction"].executor

        executor.conversation_id = "conv-1"
        executor._add_confirmed_element("elem-1")

        executor.conversation_id = "conv-2"

        assert executor._is_element_confirmed("elem-1") is False

        executor._add_confirmed_element("elem-2")
        assert executor._is_element_confirmed("elem-2") is True

        executor.conversation_id = "conv-1"
        assert executor._is_element_confirmed("elem-1") is True
        assert executor._is_element_confirmed("elem-2") is False

    def test_disabling_javascript_keeps_core_workflow_tools_available(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(javascript_tool, "DISABLE_JAVASCRIPT_EXECUTE", True)

        tools = OpenBrowserToolSet.create(None)

        assert [tool.name for tool in tools] == [
            "tab",
            "highlight",
            "element_interaction",
            "dialog",
        ]
        assert len({tool.executor for tool in tools}) == 1
