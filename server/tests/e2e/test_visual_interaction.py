"""End-to-end tests for visual interaction workflow.

Tests command parsing for all visual interaction commands:
- HighlightElementsCommand
- ClickElementCommand
- HoverElementCommand
- ScrollElementCommand
- KeyboardInputCommand
"""

import pytest
from pydantic import ValidationError

from server.models.commands import (
    HighlightElementsCommand,
    ClickElementCommand,
    HoverElementCommand,
    ScrollElementCommand,
    KeyboardInputCommand,
    parse_command,
)


class TestHighlightElementsCommand:
    """Tests for HighlightElementsCommand parsing with single-type design."""

    def test_parse_minimal(self):
        """Test parsing with minimal required fields."""
        cmd = HighlightElementsCommand()
        assert cmd.type == "highlight_elements"
        assert cmd.element_type == "any"  # Default is "any" for single-type design
        assert cmd.page == 1  # Default page is 1
        assert cmd.command_id is None
        assert cmd.tab_id is None
        assert cmd.conversation_id is None

    def test_parse_with_element_type(self):
        """Test parsing with custom element type (single)."""
        data = {
            "type": "highlight_elements",
            "element_type": "inputable",
        }
        cmd = HighlightElementsCommand(**data)
        assert cmd.element_type == "inputable"

    def test_parse_with_all_element_types(self):
        """Test parsing with all supported element types (one at a time)."""
        for element_type in ["clickable", "scrollable", "inputable", "hoverable"]:
            cmd = HighlightElementsCommand(element_type=element_type)
            assert cmd.element_type == element_type

    def test_parse_with_pagination(self):
        """Test parsing with page parameter for collision-aware pagination."""
        data = {
            "type": "highlight_elements",
            "page": 2,
        }
        cmd = HighlightElementsCommand(**data)
        assert cmd.page == 2

    def test_parse_with_metadata(self):
        """Test parsing with command metadata."""
        data = {
            "type": "highlight_elements",
            "command_id": "cmd-123",
            "tab_id": 42,
            "conversation_id": "conv-abc",
            "timestamp": 1709000000.0,
        }
        cmd = HighlightElementsCommand(**data)
        assert cmd.command_id == "cmd-123"
        assert cmd.tab_id == 42
        assert cmd.conversation_id == "conv-abc"
        assert cmd.timestamp == 1709000000.0

    def test_page_validation_min(self):
        """Test page must be at least 1."""
        with pytest.raises(ValidationError):
            HighlightElementsCommand(page=0)

    def test_page_validation_negative(self):
        """Test page cannot be negative."""
        with pytest.raises(ValidationError):
            HighlightElementsCommand(page=-1)

    def test_via_parse_command(self):
        """Test parsing via parse_command helper."""
        data = {
            "type": "highlight_elements",
            "page": 3,
            "element_type": "scrollable",
        }
        cmd = parse_command(data)
        assert isinstance(cmd, HighlightElementsCommand)
        assert cmd.page == 3
        assert cmd.element_type == "scrollable"


class TestClickElementCommand:
    """Tests for ClickElementCommand parsing."""

    def test_parse_required_fields(self):
        """Test parsing with required element_id field."""
        data = {
            "type": "click_element",
            "element_id": "elem-001",
        }
        cmd = ClickElementCommand(**data)
        assert cmd.type == "click_element"
        assert cmd.element_id == "elem-001"

    def test_parse_with_metadata(self):
        """Test parsing with command metadata."""
        data = {
            "type": "click_element",
            "element_id": "btn-submit",
            "command_id": "click-cmd-1",
            "tab_id": 5,
            "conversation_id": "session-xyz",
        }
        cmd = ClickElementCommand(**data)
        assert cmd.element_id == "btn-submit"
        assert cmd.command_id == "click-cmd-1"
        assert cmd.tab_id == 5
        assert cmd.conversation_id == "session-xyz"

    def test_missing_element_id(self):
        """Test that element_id is required."""
        with pytest.raises(ValidationError):
            ClickElementCommand()

    def test_via_parse_command(self):
        """Test parsing via parse_command helper."""
        data = {
            "type": "click_element",
            "element_id": "link-home",
        }
        cmd = parse_command(data)
        assert isinstance(cmd, ClickElementCommand)
        assert cmd.element_id == "link-home"


class TestHoverElementCommand:
    """Tests for HoverElementCommand parsing."""

    def test_parse_required_fields(self):
        """Test parsing with required element_id field."""
        data = {
            "type": "hover_element",
            "element_id": "menu-item-1",
        }
        cmd = HoverElementCommand(**data)
        assert cmd.type == "hover_element"
        assert cmd.element_id == "menu-item-1"

    def test_parse_with_metadata(self):
        """Test parsing with command metadata."""
        data = {
            "type": "hover_element",
            "element_id": "tooltip-trigger",
            "command_id": "hover-42",
            "tab_id": 10,
            "conversation_id": "conv-hover-test",
        }
        cmd = HoverElementCommand(**data)
        assert cmd.element_id == "tooltip-trigger"
        assert cmd.command_id == "hover-42"
        assert cmd.tab_id == 10
        assert cmd.conversation_id == "conv-hover-test"

    def test_missing_element_id(self):
        """Test that element_id is required."""
        with pytest.raises(ValidationError):
            HoverElementCommand()

    def test_via_parse_command(self):
        """Test parsing via parse_command helper."""
        data = {
            "type": "hover_element",
            "element_id": "dropdown-toggle",
        }
        cmd = parse_command(data)
        assert isinstance(cmd, HoverElementCommand)
        assert cmd.element_id == "dropdown-toggle"


class TestScrollElementCommand:
    """Tests for ScrollElementCommand parsing."""

    def test_parse_required_fields(self):
        """Test parsing with required element_id field."""
        data = {
            "type": "scroll_element",
            "element_id": "scroll-container",
        }
        cmd = ScrollElementCommand(**data)
        assert cmd.type == "scroll_element"
        assert cmd.element_id == "scroll-container"
        assert cmd.direction == "down"  # default

    def test_parse_with_direction(self):
        """Test parsing with custom direction."""
        for direction in ["up", "down", "left", "right"]:
            data = {
                "type": "scroll_element",
                "element_id": "list-view",
                "direction": direction,
            }
            cmd = ScrollElementCommand(**data)
            assert cmd.direction == direction

    def test_parse_with_metadata(self):
        """Test parsing with command metadata."""
        data = {
            "type": "scroll_element",
            "element_id": "feed-container",
            "direction": "up",
            "command_id": "scroll-99",
            "tab_id": 3,
            "conversation_id": "scroll-session",
        }
        cmd = ScrollElementCommand(**data)
        assert cmd.element_id == "feed-container"
        assert cmd.direction == "up"
        assert cmd.command_id == "scroll-99"
        assert cmd.tab_id == 3
        assert cmd.conversation_id == "scroll-session"

    def test_missing_element_id_is_optional(self):
        """Test that element_id is optional - page scroll without element."""
        # element_id is Optional with default=None, so ScrollElementCommand() is valid
        cmd = ScrollElementCommand()
        assert cmd.element_id is None
        assert cmd.direction == "down"  # Default direction
        assert cmd.scroll_amount == 0.5  # Default scroll amount

    def test_via_parse_command(self):
        """Test parsing via parse_command helper."""
        data = {
            "type": "scroll_element",
            "element_id": "chat-history",
            "direction": "up",
        }
        cmd = parse_command(data)
        assert isinstance(cmd, ScrollElementCommand)
        assert cmd.element_id == "chat-history"
        assert cmd.direction == "up"


class TestKeyboardInputCommand:
    """Tests for KeyboardInputCommand parsing."""

    def test_parse_required_fields(self):
        """Test parsing with required element_id and text fields."""
        data = {
            "type": "keyboard_input",
            "element_id": "search-input",
            "text": "Hello, World!",
        }
        cmd = KeyboardInputCommand(**data)
        assert cmd.type == "keyboard_input"
        assert cmd.element_id == "search-input"
        assert cmd.text == "Hello, World!"

    def test_parse_with_metadata(self):
        """Test parsing with command metadata."""
        data = {
            "type": "keyboard_input",
            "element_id": "email-field",
            "text": "user@example.com",
            "command_id": "input-email",
            "tab_id": 7,
            "conversation_id": "form-fill-session",
        }
        cmd = KeyboardInputCommand(**data)
        assert cmd.element_id == "email-field"
        assert cmd.text == "user@example.com"
        assert cmd.command_id == "input-email"
        assert cmd.tab_id == 7
        assert cmd.conversation_id == "form-fill-session"

    def test_empty_text(self):
        """Test with empty text string."""
        data = {
            "type": "keyboard_input",
            "element_id": "clear-input",
            "text": "",
        }
        cmd = KeyboardInputCommand(**data)
        assert cmd.text == ""

    def test_special_characters(self):
        """Test with special characters in text."""
        data = {
            "type": "keyboard_input",
            "element_id": "password-field",
            "text": "P@ssw0rd!#$%",
        }
        cmd = KeyboardInputCommand(**data)
        assert cmd.text == "P@ssw0rd!#$%"

    def test_missing_element_id(self):
        """Test that element_id is required."""
        with pytest.raises(ValidationError):
            KeyboardInputCommand(text="test")

    def test_missing_text(self):
        """Test that text is required."""
        with pytest.raises(ValidationError):
            KeyboardInputCommand(element_id="input")

    def test_via_parse_command(self):
        """Test parsing via parse_command helper."""
        data = {
            "type": "keyboard_input",
            "element_id": "comment-box",
            "text": "This is a test comment.",
        }
        cmd = parse_command(data)
        assert isinstance(cmd, KeyboardInputCommand)
        assert cmd.element_id == "comment-box"
        assert cmd.text == "This is a test comment."


class TestCollisionAwarePagination:
    """Tests for collision-aware pagination with single-type design."""

    def test_default_element_type(self):
        """Test default element type is 'any' for single-type design."""
        cmd = HighlightElementsCommand()
        assert cmd.element_type == "any"

    def test_default_page(self):
        """Test default page is 1."""
        cmd = HighlightElementsCommand()
        assert cmd.page == 1

    def test_single_type_pagination(self):
        """Test pagination with single element type."""
        # First page of clickable elements
        cmd1 = HighlightElementsCommand(element_type="clickable", page=1)
        assert cmd1.element_type == "clickable"
        assert cmd1.page == 1

        # Second page of clickable elements
        cmd2 = HighlightElementsCommand(element_type="clickable", page=2)
        assert cmd2.element_type == "clickable"
        assert cmd2.page == 2

        # Different type - independent pagination
        cmd3 = HighlightElementsCommand(element_type="inputable", page=1)
        assert cmd3.element_type == "inputable"
        assert cmd3.page == 1

    def test_page_boundary_min(self):
        """Test minimum valid page value."""
        cmd = HighlightElementsCommand(page=1)
        assert cmd.page == 1

    def test_page_boundary_large(self):
        """Test large page value."""
        cmd = HighlightElementsCommand(page=100)
        assert cmd.page == 100


class TestElementTypes:
    """Tests for single element type selection."""

    def test_clickable_elements(self):
        """Test highlighting clickable elements."""
        cmd = HighlightElementsCommand(element_type="clickable")
        assert cmd.element_type == "clickable"

    def test_scrollable_elements(self):
        """Test highlighting scrollable elements."""
        cmd = HighlightElementsCommand(element_type="scrollable")
        assert cmd.element_type == "scrollable"

    def test_inputable_elements(self):
        """Test highlighting inputable elements."""
        cmd = HighlightElementsCommand(element_type="inputable")
        assert cmd.element_type == "inputable"

    def test_hoverable_elements(self):
        """Test highlighting hoverable elements."""
        cmd = HighlightElementsCommand(element_type="hoverable")
        assert cmd.element_type == "hoverable"


class TestCommandTypeRouting:
    """Tests for command type routing via parse_command."""

    def test_routes_highlight_elements(self):
        """Test routing to HighlightElementsCommand."""
        cmd = parse_command({"type": "highlight_elements"})
        assert isinstance(cmd, HighlightElementsCommand)

    def test_routes_click_element(self):
        """Test routing to ClickElementCommand."""
        cmd = parse_command({"type": "click_element", "element_id": "x"})
        assert isinstance(cmd, ClickElementCommand)

    def test_routes_hover_element(self):
        """Test routing to HoverElementCommand."""
        cmd = parse_command({"type": "hover_element", "element_id": "x"})
        assert isinstance(cmd, HoverElementCommand)

    def test_routes_scroll_element(self):
        """Test routing to ScrollElementCommand."""
        cmd = parse_command({"type": "scroll_element", "element_id": "x"})
        assert isinstance(cmd, ScrollElementCommand)

    def test_routes_keyboard_input(self):
        """Test routing to KeyboardInputCommand."""
        cmd = parse_command({"type": "keyboard_input", "element_id": "x", "text": "t"})
        assert isinstance(cmd, KeyboardInputCommand)

    def test_unknown_type_raises_error(self):
        """Test that unknown command type raises ValueError."""
        with pytest.raises(ValueError, match="Unknown command type"):
            parse_command({"type": "unknown_command"})

    def test_missing_type_raises_error(self):
        """Test that missing type field raises ValueError."""
        with pytest.raises(ValueError, match="must have 'type' field"):
            parse_command({})
