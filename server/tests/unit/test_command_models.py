"""
Tests for command models - visual interaction commands with optional tab_id
"""

import pytest
from server.models.commands import (
    ClickElementCommand,
    HoverElementCommand,
    ScrollElementCommand,
    KeyboardInputCommand,
)


class TestVisualInteractionCommands:
    """Test that visual interaction commands have optional tab_id"""

    def test_click_element_without_tab_id(self):
        """ClickElementCommand should work without tab_id"""
        cmd = ClickElementCommand(element_id="test-element")
        assert cmd.element_id == "test-element"
        assert cmd.tab_id is None
        assert cmd.type == "click_element"

    def test_click_element_with_tab_id(self):
        """ClickElementCommand should accept explicit tab_id"""
        cmd = ClickElementCommand(element_id="test-element", tab_id=123)
        assert cmd.element_id == "test-element"
        assert cmd.tab_id == 123

    def test_hover_element_without_tab_id(self):
        """HoverElementCommand should work without tab_id"""
        cmd = HoverElementCommand(element_id="test-hover")
        assert cmd.element_id == "test-hover"
        assert cmd.tab_id is None
        assert cmd.type == "hover_element"

    def test_hover_element_with_tab_id(self):
        """HoverElementCommand should accept explicit tab_id"""
        cmd = HoverElementCommand(element_id="test-hover", tab_id=456)
        assert cmd.element_id == "test-hover"
        assert cmd.tab_id == 456

    def test_scroll_element_without_tab_id(self):
        """ScrollElementCommand should work without tab_id"""
        cmd = ScrollElementCommand()
        assert cmd.tab_id is None
        assert cmd.type == "scroll_element"
        assert cmd.direction == "down"
        assert cmd.scroll_amount == 0.5

    def test_scroll_element_with_all_params(self):
        """ScrollElementCommand should accept all parameters including tab_id"""
        cmd = ScrollElementCommand(
            element_id="scroll-area", direction="up", scroll_amount=1.0, tab_id=789
        )
        assert cmd.element_id == "scroll-area"
        assert cmd.direction == "up"
        assert cmd.scroll_amount == 1.0
        assert cmd.tab_id == 789

    def test_keyboard_input_without_tab_id(self):
        """KeyboardInputCommand should work without tab_id"""
        cmd = KeyboardInputCommand(element_id="input-field", text="hello world")
        assert cmd.element_id == "input-field"
        assert cmd.text == "hello world"
        assert cmd.tab_id is None
        assert cmd.type == "keyboard_input"

    def test_keyboard_input_with_tab_id(self):
        """KeyboardInputCommand should accept explicit tab_id"""
        cmd = KeyboardInputCommand(
            element_id="input-field", text="test text", tab_id=999
        )
        assert cmd.element_id == "input-field"
        assert cmd.text == "test text"
        assert cmd.tab_id == 999

    def test_commands_inherit_conversation_id(self):
        """All commands should inherit conversation_id from BaseCommand"""
        click = ClickElementCommand(element_id="test", conversation_id="conv-123")
        assert click.conversation_id == "conv-123"

        keyboard = KeyboardInputCommand(
            element_id="test", text="test", conversation_id="conv-456"
        )
        assert keyboard.conversation_id == "conv-456"

    def test_scroll_element_optional_element_id(self):
        """ScrollElementCommand should work without element_id (scrolls page)"""
        cmd = ScrollElementCommand(direction="up", scroll_amount=1.0)
        assert cmd.element_id is None
        assert cmd.direction == "up"
        assert cmd.scroll_amount == 1.0

    def test_commands_serialization_without_tab_id(self):
        """Commands should serialize correctly without tab_id"""
        cmd = ClickElementCommand(element_id="test")
        data = cmd.model_dump(exclude_none=True)

        # tab_id should not be in the serialized data when None
        assert "tab_id" not in data or data["tab_id"] is None
        assert data["element_id"] == "test"
        assert data["type"] == "click_element"

    def test_commands_serialization_with_tab_id(self):
        """Commands should serialize correctly with explicit tab_id"""
        cmd = ClickElementCommand(element_id="test", tab_id=123)
        data = cmd.model_dump(exclude_none=True)

        assert data["tab_id"] == 123
        assert data["element_id"] == "test"
