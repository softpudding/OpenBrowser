"""Tests for the state management module."""

import sys
from pathlib import Path
import importlib.util
import pytest

# Import state module directly to avoid package init dependencies
_state_path = Path(__file__).parent.parent.parent / "agent" / "tools" / "state.py"
_spec = importlib.util.spec_from_file_location("state", _state_path)
_state_module = importlib.util.module_from_spec(_spec)
sys.modules["server.agent.tools.state"] = _state_module
_spec.loader.exec_module(_state_module)

OpenBrowserState = _state_module.OpenBrowserState
PendingConfirmation = _state_module.PendingConfirmation

from server.agent.tools.state import OpenBrowserState, PendingConfirmation


class TestPendingConfirmation:
    """Tests for PendingConfirmation dataclass."""

    def test_creation_with_required_fields(self) -> None:
        """Test creating PendingConfirmation with only required fields."""
        confirmation = PendingConfirmation(
            element_id="abc123",
            action_type="click",
            full_html="<button>Click me</button>",
        )

        assert confirmation.element_id == "abc123"
        assert confirmation.action_type == "click"
        assert confirmation.full_html == "<button>Click me</button>"
        assert confirmation.extra_data == {}
        assert confirmation.screenshot_data_url is None

    def test_creation_with_all_fields(self) -> None:
        """Test creating PendingConfirmation with all fields."""
        confirmation = PendingConfirmation(
            element_id="xyz789",
            action_type="keyboard_input",
            full_html='<input type="text" />',
            extra_data={"text": "hello world"},
            screenshot_data_url="data:image/png;base64,abc123",
        )

        assert confirmation.element_id == "xyz789"
        assert confirmation.action_type == "keyboard_input"
        assert confirmation.full_html == '<input type="text" />'
        assert confirmation.extra_data == {"text": "hello world"}
        assert confirmation.screenshot_data_url == "data:image/png;base64,abc123"

    def test_extra_data_default_is_mutable(self) -> None:
        """Test that extra_data defaults to a new empty dict each time."""
        c1 = PendingConfirmation(element_id="a", action_type="click", full_html="")
        c2 = PendingConfirmation(
            element_id="b", action_type="keyboard_input", full_html=""
        )

        c1.extra_data["key"] = "value"
        assert "key" not in c2.extra_data


class TestOpenBrowserState:
    """Tests for OpenBrowserState class."""

    def test_initial_state(self) -> None:
        """Test that initial state has empty pending confirmations."""
        state = OpenBrowserState()
        assert state.pending_confirmations == {}

    def test_set_pending(self) -> None:
        """Test setting a pending confirmation."""
        state = OpenBrowserState()
        state.set_pending(
            conversation_id="conv-123",
            element_id="elem-456",
            action_type="click",
            full_html="<button>Submit</button>",
        )

        assert "conv-123" in state.pending_confirmations
        pending = state.pending_confirmations["conv-123"]
        assert pending.element_id == "elem-456"
        assert pending.action_type == "click"
        assert pending.full_html == "<button>Submit</button>"

    def test_set_pending_with_optional_fields(self) -> None:
        """Test setting a pending confirmation with all fields."""
        state = OpenBrowserState()
        state.set_pending(
            conversation_id="conv-789",
            element_id="elem-abc",
            action_type="keyboard_input",
            full_html="<input />",
            extra_data={"text": "hello"},
            screenshot_data_url="data:image/png;base64,test",
        )

        pending = state.pending_confirmations["conv-789"]
        assert pending.extra_data == {"text": "hello"}
        assert pending.screenshot_data_url == "data:image/png;base64,test"

    def test_get_pending_existing(self) -> None:
        """Test getting an existing pending confirmation."""
        state = OpenBrowserState()
        state.set_pending(
            conversation_id="conv-1",
            element_id="elem-1",
            action_type="keyboard_input",
            full_html="<input />",
        )

        pending = state.get_pending("conv-1")
        assert pending is not None
        assert pending.element_id == "elem-1"
        assert pending.action_type == "keyboard_input"

    def test_get_pending_nonexistent(self) -> None:
        """Test getting a non-existent pending confirmation."""
        state = OpenBrowserState()
        pending = state.get_pending("nonexistent")
        assert pending is None

    def test_clear_pending_existing(self) -> None:
        """Test clearing an existing pending confirmation."""
        state = OpenBrowserState()
        state.set_pending(
            conversation_id="conv-to-clear",
            element_id="elem-1",
            action_type="click",
            full_html="<button/>",
        )

        assert "conv-to-clear" in state.pending_confirmations
        state.clear_pending("conv-to-clear")
        assert "conv-to-clear" not in state.pending_confirmations

    def test_clear_pending_nonexistent(self) -> None:
        """Test clearing a non-existent pending confirmation (no error)."""
        state = OpenBrowserState()
        # Should not raise
        state.clear_pending("nonexistent")
        assert state.pending_confirmations == {}

    def test_multiple_conversations_isolation(self) -> None:
        """Test that different conversations have isolated state."""
        state = OpenBrowserState()

        # Set pending for conversation 1
        state.set_pending(
            conversation_id="conv-1",
            element_id="elem-1",
            action_type="click",
            full_html="<button>A</button>",
        )

        # Set pending for conversation 2
        state.set_pending(
            conversation_id="conv-2",
            element_id="elem-2",
            action_type="keyboard_input",
            full_html="<input>B</input>",
        )

        # Verify isolation
        assert len(state.pending_confirmations) == 2
        assert state.get_pending("conv-1").element_id == "elem-1"
        assert state.get_pending("conv-2").element_id == "elem-2"

        # Clear one doesn't affect the other
        state.clear_pending("conv-1")
        assert state.get_pending("conv-1") is None
        assert state.get_pending("conv-2") is not None

    def test_overwrite_pending(self) -> None:
        """Test that setting pending overwrites previous value."""
        state = OpenBrowserState()

        state.set_pending(
            conversation_id="conv-1",
            element_id="elem-1",
            action_type="click",
            full_html="<button>First</button>",
        )

        state.set_pending(
            conversation_id="conv-1",
            element_id="elem-2",
            action_type="keyboard_input",
            full_html="<input>Second</input>",
        )

        pending = state.get_pending("conv-1")
        assert pending.element_id == "elem-2"
        assert pending.action_type == "keyboard_input"
        assert pending.full_html == "<input>Second</input>"

    def test_all_action_types(self) -> None:
        """Test all valid action types."""
        state = OpenBrowserState()
        action_types = ["click", "keyboard_input"]

        for i, action_type in enumerate(action_types):
            state.set_pending(
                conversation_id=f"conv-{i}",
                element_id=f"elem-{i}",
                action_type=action_type,
                full_html=f"<{action_type}>",
            )

        for i, action_type in enumerate(action_types):
            pending = state.get_pending(f"conv-{i}")
            assert pending.action_type == action_type
