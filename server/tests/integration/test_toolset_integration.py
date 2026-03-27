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

from server.agent.tools.toolset import OpenBrowserToolSet


class TestToolSetIntegration:
    def test_pending_confirmation_is_shared_across_tool_instances(self) -> None:
        tools = {tool.name: tool for tool in OpenBrowserToolSet.create(None)}
        shared_executor = tools["element_interaction"].executor
        shared_executor.conversation_id = "conv-shared"

        shared_executor._set_pending_confirmation(
            element_id="abc123",
            highlight_snapshot_id=17,
            action_type="click",
            full_html="<button>Delete</button>",
        )

        assert (
            tools["dialog"].executor._get_pending_confirmation()["element_id"]
            == "abc123"
        )
        assert (
            tools["tab"].executor._get_pending_confirmation()["action_type"] == "click"
        )

    def test_pending_confirmation_is_isolated_by_conversation(self) -> None:
        tools = {tool.name: tool for tool in OpenBrowserToolSet.create(None)}
        executor = tools["element_interaction"].executor

        executor.conversation_id = "conv-1"
        executor._set_pending_confirmation(
            element_id="elem-1",
            highlight_snapshot_id=11,
            action_type="click",
            full_html="<button>First</button>",
        )

        executor.conversation_id = "conv-2"

        assert executor._get_pending_confirmation() is None

        executor._set_pending_confirmation(
            element_id="elem-2",
            highlight_snapshot_id=22,
            action_type="keyboard_input",
            full_html='<input value="second" />',
        )
        assert executor._get_pending_confirmation()["element_id"] == "elem-2"
        assert executor._get_pending_confirmation()["highlight_snapshot_id"] == 22

        executor.conversation_id = "conv-1"
        assert executor._get_pending_confirmation()["element_id"] == "elem-1"
        assert executor._get_pending_confirmation()["highlight_snapshot_id"] == 11

    def test_toolset_keeps_core_workflow_tools_available(self) -> None:
        tools = OpenBrowserToolSet.create(None)

        assert [tool.name for tool in tools] == [
            "tab",
            "highlight",
            "element_interaction",
            "dialog",
        ]
        assert len({tool.executor for tool in tools}) == 1
