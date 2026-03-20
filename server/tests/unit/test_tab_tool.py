"""Contract tests for TabTool and TabAction."""

import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from openhands.sdk.tool import ToolAnnotations
from pydantic import ValidationError

from server.agent.tools.browser_executor import BrowserExecutor

TOOLS_DIR = Path(__file__).resolve().parents[2] / "agent" / "tools"
AGENT_DIR = TOOLS_DIR.parent

agent_module = types.ModuleType("server.agent")
agent_module.__path__ = [str(AGENT_DIR)]
sys.modules.setdefault("server.agent", agent_module)

tools_module = types.ModuleType("server.agent.tools")
tools_module.__path__ = [str(TOOLS_DIR)]
sys.modules.setdefault("server.agent.tools", tools_module)


def _load_module(module_name: str, filename: str):
    module_path = TOOLS_DIR / filename
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_load_module("server.agent.tools.base", "base.py")
_load_module("server.agent.tools.prompt_context", "prompt_context.py")
tab_tool_module = _load_module("server.agent.tools.tab_tool", "tab_tool.py")

TabAction = tab_tool_module.TabAction
TabTool = tab_tool_module.TabTool
get_tab_tool_description = tab_tool_module.get_tab_tool_description


class TestTabAction:
    @pytest.mark.parametrize("action_name", ["back", "forward"])
    def test_history_navigation_does_not_require_url_or_tab_id(
        self, action_name: str
    ) -> None:
        action = TabAction(action=action_name)

        assert action.action == action_name
        assert action.url is None
        assert action.tab_id is None

    def test_invalid_action_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TabAction(action="duplicate")


class TestTabTool:
    def test_create_with_explicit_executor_uses_given_executor(self) -> None:
        executor = BrowserExecutor()

        tools = TabTool.create(conv_state=None, terminal_executor=executor)

        assert len(tools) == 1
        assert tools[0].executor is executor

    def test_create_without_executor_uses_registry_executor_for_conversation(
        self,
    ) -> None:
        from server.agent.tools.browser_executor import remove_browser_executor

        conversation_id = "tab-tool-conv"
        conv_state = SimpleNamespace(id=conversation_id)

        try:
            first_tool = TabTool.create(conv_state)[0]
            second_tool = TabTool.create(conv_state)[0]

            assert first_tool.executor is second_tool.executor
        finally:
            remove_browser_executor(conversation_id)

    def test_description_documents_clean_screenshot_and_history_navigation(
        self,
    ) -> None:
        description = get_tab_tool_description()

        assert "tab view" in description
        assert "clean screenshot" in description.lower()
        assert "tab back" in description
        assert "tab forward" in description

    def test_annotations_match_tab_capabilities(self) -> None:
        annotations = TabTool.create(None)[0].annotations

        assert isinstance(annotations, ToolAnnotations)
        assert annotations.title == "tab"
        assert annotations.readOnlyHint is False
        assert annotations.destructiveHint is True
        assert annotations.idempotentHint is False
        assert annotations.openWorldHint is True


class TestBrowserExecutorTabActions:
    def test_back_action_is_executable_through_browser_executor(self, monkeypatch):
        executor = BrowserExecutor()
        executor.conversation_id = "tab-history-conv"

        monkeypatch.setattr(
            executor,
            "_execute_command_sync",
            lambda command: {"success": True, "data": {"navigated": "back"}},
        )
        monkeypatch.setattr(
            executor,
            "_get_tabs_sync",
            lambda: {"success": True, "data": {"tabs": []}},
        )

        observation = executor._execute_tab_action(TabAction(action="back", tab_id=7))

        assert observation.success is True
        assert "back" in observation.message.lower()

    def test_forward_action_is_executable_through_browser_executor(
        self, monkeypatch
    ):
        executor = BrowserExecutor()
        executor.conversation_id = "tab-history-conv"

        monkeypatch.setattr(
            executor,
            "_execute_command_sync",
            lambda command: {"success": True, "data": {"navigated": "forward"}},
        )
        monkeypatch.setattr(
            executor,
            "_get_tabs_sync",
            lambda: {"success": True, "data": {"tabs": []}},
        )

        observation = executor._execute_tab_action(
            TabAction(action="forward", tab_id=7)
        )

        assert observation.success is True
        assert "forward" in observation.message.lower()
