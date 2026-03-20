"""Tests for TabTool."""

import sys
import importlib.util
from pathlib import Path

import pytest
from openhands.sdk.tool import ToolAnnotations

# Import base module first
BASE_MODULE_PATH = Path(__file__).parent.parent.parent / "agent" / "tools" / "base.py"
spec = importlib.util.spec_from_file_location("base", BASE_MODULE_PATH)
assert spec is not None and spec.loader is not None
base_module = importlib.util.module_from_spec(spec)
sys.modules["server.agent.tools.base"] = base_module
spec.loader.exec_module(base_module)

# Import tab_tool module
TAB_TOOL_PATH = Path(__file__).parent.parent.parent / "agent" / "tools" / "tab_tool.py"
spec = importlib.util.spec_from_file_location("tab_tool", TAB_TOOL_PATH)
assert spec is not None and spec.loader is not None
tab_tool_module = importlib.util.module_from_spec(spec)
sys.modules["server.agent.tools.tab_tool"] = tab_tool_module
spec.loader.exec_module(tab_tool_module)

TabAction = tab_tool_module.TabAction
TabTool = tab_tool_module.TabTool
get_tab_tool_description = tab_tool_module.get_tab_tool_description
TAB_TOOL_DESCRIPTION = get_tab_tool_description()


class TestTabAction:
    """Tests for TabAction model."""

    def test_action_with_init(self) -> None:
        """Test init action with URL."""
        action = TabAction(action="init", url="https://example.com")
        assert action.action == "init"
        assert action.url == "https://example.com"
        assert action.tab_id is None

    def test_action_with_open(self) -> None:
        """Test open action with URL."""
        action = TabAction(action="open", url="https://example.com")
        assert action.action == "open"
        assert action.url == "https://example.com"
        assert action.tab_id is None

    def test_action_with_close(self) -> None:
        """Test close action with tab_id."""
        action = TabAction(action="close", tab_id=123)
        assert action.action == "close"
        assert action.tab_id == 123
        assert action.url is None

    def test_action_with_switch(self) -> None:
        """Test switch action with tab_id."""
        action = TabAction(action="switch", tab_id=456)
        assert action.action == "switch"
        assert action.tab_id == 456
        assert action.url is None

    def test_action_with_list(self) -> None:
        """Test list action with no parameters."""
        action = TabAction(action="list")
        assert action.action == "list"
        assert action.url is None
        assert action.tab_id is None

    def test_action_with_refresh(self) -> None:
        """Test refresh action with tab_id."""
        action = TabAction(action="refresh", tab_id=789)
        assert action.action == "refresh"
        assert action.tab_id == 789
        assert action.url is None

    def test_action_with_view(self) -> None:
        """Test view action with tab_id."""
        action = TabAction(action="view", tab_id=111)
        assert action.action == "view"
        assert action.tab_id == 111
        assert action.url is None

    def test_action_is_serializable(self) -> None:
        """Test that action can be serialized."""
        action = TabAction(action="open", url="https://test.com")
        data = action.model_dump()
        assert data["action"] == "open"
        assert data["url"] == "https://test.com"

    def test_action_inherits_conversation_id(self) -> None:
        """Test that TabAction inherits conversation_id from base."""
        action = TabAction(action="list", conversation_id="test-conv-123")
        assert action.conversation_id == "test-conv-123"


class TestTabTool:
    """Tests for TabTool class."""

    def test_create_returns_single_instance(self) -> None:
        """Test that create() returns a list with one instance."""
        tools = TabTool.create(None)
        assert len(tools) == 1
        assert isinstance(tools[0], TabTool)

    def test_tool_has_correct_name(self) -> None:
        """Test that tool name is 'tab'."""
        assert TabTool.name == "tab"

    def test_tool_has_description(self) -> None:
        """Test that tool has a description."""
        tools = TabTool.create(None)
        assert tools[0].description == TAB_TOOL_DESCRIPTION
        assert "init" in TAB_TOOL_DESCRIPTION
        assert "open" in TAB_TOOL_DESCRIPTION
        assert "close" in TAB_TOOL_DESCRIPTION
        assert "switch" in TAB_TOOL_DESCRIPTION
        assert "list" in TAB_TOOL_DESCRIPTION
        assert "refresh" in TAB_TOOL_DESCRIPTION
        assert "view" in TAB_TOOL_DESCRIPTION

    def test_tool_action_type(self) -> None:
        """Test that tool uses correct action type."""
        tools = TabTool.create(None)
        assert tools[0].action_type == TabAction

    def test_tool_annotations(self) -> None:
        """Test that tool has correct annotations."""
        tools = TabTool.create(None)
        annotations = tools[0].annotations
        assert isinstance(annotations, ToolAnnotations)
        assert annotations.title == "tab"
        assert annotations.readOnlyHint is False
        assert annotations.destructiveHint is True  # close can be destructive
        assert annotations.idempotentHint is False
        assert annotations.openWorldHint is True

    def test_create_with_executor(self) -> None:
        """Test that create() can accept an executor."""
        # Just verify it doesn't raise an error
        tools = TabTool.create(conv_state=None, terminal_executor=None)
        assert len(tools) == 1

    def test_description_includes_required_parameters(self) -> None:
        """Test that description mentions required parameters."""
        desc = TAB_TOOL_DESCRIPTION
        # Check that description mentions key parameters
        # New template format doesn't use "Required:" prefix but still mentions parameters
        assert "url" in desc.lower()  # for init/open
        assert (
            "tab_id" in desc or "tab id" in desc.lower()
        )  # for close/switch/refresh/view
