"""Behavior-focused tests for command model contracts."""

import pytest
from pydantic import ValidationError

from server.models.commands import (
    ClickElementCommand,
    HighlightElementsCommand,
    KeyboardInputCommand,
    ScrollElementCommand,
    SwipeElementCommand,
    TabAction,
    TabCommand,
    parse_command,
)


class TestTabCommandContracts:
    @pytest.mark.parametrize("action", [TabAction.INIT, TabAction.OPEN])
    def test_navigation_actions_normalize_urls(self, action: TabAction) -> None:
        command = TabCommand(action=action, url="example.com")

        assert command.url == "https://example.com"

    @pytest.mark.parametrize("action", [TabAction.INIT, TabAction.OPEN])
    def test_navigation_actions_require_url(self, action: TabAction) -> None:
        with pytest.raises(ValidationError, match="URL is required"):
            TabCommand(action=action)


class TestHighlightCommandContracts:
    def test_highlight_defaults_match_visual_workflow(self) -> None:
        command = HighlightElementsCommand()

        assert command.element_type == "any"
        assert command.page == 1
        assert command.keywords is None

    @pytest.mark.parametrize("page", [0, -1])
    def test_highlight_rejects_invalid_page_numbers(self, page: int) -> None:
        with pytest.raises(ValidationError):
            HighlightElementsCommand(page=page)

    def test_highlight_allows_pagination_without_snapshot_id(self) -> None:
        command = HighlightElementsCommand(page=2)

        assert command.page == 2

    def test_highlight_ignores_snapshot_id_input_for_backward_compatibility(self) -> None:
        command = HighlightElementsCommand(page=2, highlight_snapshot_id=101)

        assert command.page == 2
        assert "highlight_snapshot_id" not in command.model_dump()


class TestVisualInteractionContracts:
    def test_scroll_supports_page_level_scrolling_without_element_id(self) -> None:
        command = ScrollElementCommand(direction="up", scroll_amount=1.0)

        assert command.element_id is None
        assert command.direction == "up"
        assert command.scroll_amount == 1.0

    @pytest.mark.parametrize("amount", [0.1, 3.0])
    def test_scroll_accepts_documented_amount_boundaries(self, amount: float) -> None:
        command = ScrollElementCommand(scroll_amount=amount)

        assert command.scroll_amount == amount

    @pytest.mark.parametrize("amount", [0.09, 3.01])
    def test_scroll_rejects_out_of_range_amounts(self, amount: float) -> None:
        with pytest.raises(ValidationError):
            ScrollElementCommand(scroll_amount=amount)

    def test_keyboard_input_allows_empty_text_for_clear_style_interactions(
        self,
    ) -> None:
        command = KeyboardInputCommand(
            element_id="field123",
            highlight_snapshot_id=101,
            text="",
        )

        assert command.text == ""
        assert command.highlight_snapshot_id == 101

    def test_swipe_defaults_match_carousel_workflow(self) -> None:
        command = SwipeElementCommand(element_id="carousel1", highlight_snapshot_id=202)

        assert command.direction == "next"
        assert command.swipe_count == 1
        assert command.highlight_snapshot_id == 202

    def test_swipe_direction_description_uses_content_semantics(self) -> None:
        description = SwipeElementCommand.model_fields["direction"].description

        assert description is not None
        assert "next picture/item" in description
        assert "previous picture/item" in description
        assert "left/right gesture direction" in description

    @pytest.mark.parametrize("count", [1, 5])
    def test_swipe_accepts_documented_count_boundaries(self, count: int) -> None:
        command = SwipeElementCommand(
            element_id="carousel1",
            highlight_snapshot_id=202,
            swipe_count=count,
        )

        assert command.swipe_count == count

    @pytest.mark.parametrize("count", [0, 6])
    def test_swipe_rejects_out_of_range_counts(self, count: int) -> None:
        with pytest.raises(ValidationError):
            SwipeElementCommand(element_id="carousel1", swipe_count=count)

    @pytest.mark.parametrize("direction", ["left", "right", "up", "down"])
    def test_swipe_rejects_non_semantic_directions(self, direction: str) -> None:
        with pytest.raises(ValidationError):
            SwipeElementCommand(element_id="carousel1", direction=direction)


class TestParseCommandContracts:
    @pytest.mark.parametrize(
        ("payload", "expected_type"),
        [
            (
                {
                    "type": "click_element",
                    "element_id": "abc123",
                    "highlight_snapshot_id": 11,
                    "conversation_id": "conv-1",
                    "browser_id": "browser-1",
                },
                ClickElementCommand,
            ),
            (
                {
                    "type": "keyboard_input",
                    "element_id": "field123",
                    "highlight_snapshot_id": 12,
                    "text": "hello",
                    "tab_id": 7,
                    "conversation_id": "conv-2",
                    "browser_id": "browser-2",
                },
                KeyboardInputCommand,
            ),
            (
                {
                    "type": "highlight_elements",
                    "keywords": ["Submit", "提交"],
                    "conversation_id": "conv-3",
                    "browser_id": "browser-3",
                },
                HighlightElementsCommand,
            ),
            (
                {
                    "type": "swipe_element",
                    "element_id": "carousel1",
                    "highlight_snapshot_id": 13,
                    "direction": "prev",
                    "swipe_count": 2,
                    "conversation_id": "conv-4",
                    "browser_id": "browser-4",
                },
                SwipeElementCommand,
            ),
        ],
    )
    def test_parse_command_preserves_routing_metadata(
        self, payload: dict[str, object], expected_type: type
    ) -> None:
        command = parse_command(payload)

        assert isinstance(command, expected_type)
        assert command.conversation_id == payload["conversation_id"]
        assert command.browser_id == payload["browser_id"]
        if "highlight_snapshot_id" in payload:
            assert command.highlight_snapshot_id == payload["highlight_snapshot_id"]

    def test_parse_command_rejects_missing_type(self) -> None:
        with pytest.raises(ValueError, match="must have 'type' field"):
            parse_command({})

    def test_parse_command_rejects_unknown_type(self) -> None:
        with pytest.raises(ValueError, match="Unknown command type"):
            parse_command({"type": "does_not_exist"})
