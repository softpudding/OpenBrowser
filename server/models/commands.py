from enum import Enum
from typing import Optional, List, Tuple, Literal, Union
from pydantic import BaseModel, Field, validator, model_validator
import re

URL_WITH_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")


class MouseButton(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    MIDDLE = "middle"


class ScrollDirection(str, Enum):
    UP = "up"
    DOWN = "down"
    LEFT = "left"
    RIGHT = "right"


class TabAction(str, Enum):
    OPEN = "open"
    CLOSE = "close"
    LIST = "list"
    SWITCH = "switch"
    INIT = "init"
    REFRESH = "refresh"
    VIEW = "view"
    BACK = "back"
    FORWARD = "forward"


class BaseCommand(BaseModel):
    """Base command model with common fields"""

    command_id: Optional[str] = Field(
        default=None,
        description="Optional unique identifier for tracking command execution",
    )
    timestamp: Optional[float] = Field(
        default=None, description="Timestamp when command was created (epoch seconds)"
    )
    tab_id: Optional[int] = Field(
        default=None, description="Tab ID to target (None = current managed tab)"
    )
    conversation_id: Optional[str] = Field(
        default=None,
        description="Conversation ID for session isolation (None = default session)",
    )
    browser_id: Optional[str] = Field(
        default=None,
        description="Browser UUID capability token for targeted routing",
    )


class MouseMoveCommand(BaseCommand):
    """Move mouse to absolute position in preset coordinate system"""

    type: Literal["mouse_move"] = "mouse_move"
    x: int = Field(
        description="X coordinate in preset coordinate system (0 to 1280, left to right)",
        ge=0,
        le=1280,
    )
    y: int = Field(
        description="Y coordinate in preset coordinate system (0 to 720, top to bottom)",
        ge=0,
        le=720,
    )
    duration: Optional[float] = Field(
        default=0.1,
        description="Duration of movement in seconds (for animation)",
        gt=0,
        le=5.0,
    )


class MouseClickCommand(BaseCommand):
    """Click at current mouse position"""

    type: Literal["mouse_click"] = "mouse_click"
    button: MouseButton = Field(default=MouseButton.LEFT)
    double: bool = Field(default=False, description="Double click if True")
    count: int = Field(default=1, ge=1, le=3, description="Number of clicks (1-3)")


class MouseScrollCommand(BaseCommand):
    """Scroll at current mouse position"""

    type: Literal["mouse_scroll"] = "mouse_scroll"
    direction: ScrollDirection = Field(default=ScrollDirection.DOWN)
    amount: int = Field(
        default=100, ge=1, le=1000, description="Scroll amount in pixels"
    )


class ResetMouseCommand(BaseCommand):
    """Reset mouse position to screen center"""

    type: Literal["reset_mouse"] = "reset_mouse"


class KeyboardTypeCommand(BaseCommand):
    """Type text at current focus"""

    type: Literal["keyboard_type"] = "keyboard_type"
    text: str = Field(description="Text to type", max_length=1000)

    @validator("text")
    def validate_text(cls, v):
        # Remove control characters except newline, tab
        v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", v)
        return v


class KeyboardPressCommand(BaseCommand):
    """Press special key"""

    type: Literal["keyboard_press"] = "keyboard_press"
    key: str = Field(
        description="Key to press (e.g., 'Enter', 'Escape', 'Tab', 'Backspace')",
        max_length=50,
    )
    modifiers: List[str] = Field(
        default_factory=list, description="Modifier keys (e.g., ['Control', 'Shift'])"
    )


class ScreenshotCommand(BaseCommand):
    """Capture screenshot"""

    type: Literal["screenshot"] = "screenshot"
    include_cursor: bool = Field(
        default=True, description="Whether to include mouse cursor in screenshot"
    )
    include_visual_mouse: bool = Field(
        default=True,
        description="Whether to include visual mouse pointer in screenshot",
    )
    quality: int = Field(
        default=90,  # 保持与扩展一致，PNG忽略此参数，JPEG使用
        ge=1,
        le=100,
        description="JPEG quality (1-100), PNG format ignores this parameter",
    )


class TabCommand(BaseCommand):
    """Tab management command"""

    type: Literal["tab"] = "tab"
    action: TabAction
    url: Optional[str] = Field(
        default=None, description="URL for open action, tab ID for close/switch"
    )

    @validator("url")
    def validate_url(cls, v, values):
        action = values.get("action")
        if action in [TabAction.OPEN, TabAction.INIT]:
            # Add a default scheme only when the caller did not provide one.
            if v and not URL_WITH_SCHEME_RE.match(v):
                v = f"https://{v}"
        return v

    @model_validator(mode="after")
    def validate_navigation_action_requirements(self):
        if self.action in [TabAction.OPEN, TabAction.INIT] and not self.url:
            raise ValueError(f"URL is required for {self.action} action")
        return self


class GetTabsCommand(BaseCommand):
    """Get list of all tabs"""

    type: Literal["get_tabs"] = "get_tabs"
    managed_only: bool = Field(
        default=True,
        description="If true, only return managed tabs (in OpenBrowser tab group)",
    )


class JavascriptExecuteCommand(BaseCommand):
    """Execute JavaScript code in browser tab"""

    type: Literal["javascript_execute"] = "javascript_execute"
    script: str = Field(description="JavaScript code to execute")
    return_by_value: bool = Field(
        default=True, description="If true, returns result as serializable JSON value"
    )
    await_promise: bool = Field(
        default=False, description="If true, waits for Promise resolution"
    )
    timeout: int = Field(
        default=30000,
        ge=100,
        le=120000,
        description="Execution timeout in milliseconds (100-120000)",
    )


class DialogAction(str, Enum):
    """Dialog handling action"""

    ACCEPT = "accept"
    DISMISS = "dismiss"


class RecordingControlAction(str, Enum):
    """Recording control action."""

    START = "start"
    STOP = "stop"


class RecordingLaunchMode(str, Enum):
    """How a recording session should allocate browser workspace."""

    DEDICATED_WINDOW = "dedicated_window"
    CURRENT_WINDOW = "current_window"


class HandleDialogCommand(BaseCommand):
    """Handle an open JavaScript dialog (confirm/prompt)"""

    type: Literal["handle_dialog"] = "handle_dialog"
    action: DialogAction = Field(description="Action to take: 'accept' or 'dismiss'")
    prompt_text: Optional[str] = Field(
        default=None, description="Text to enter for prompt dialogs"
    )


class GetGroundedElementsCommand(BaseCommand):
    """Extract interactive elements with selectors and bounding boxes for visual grounding"""

    type: Literal["get_grounded_elements"] = "get_grounded_elements"
    max_elements: int = Field(
        default=100,
        ge=1,
        le=500,
        description="Maximum number of elements to return (1-500, default 100)",
    )
    include_hidden: bool = Field(
        default=False,
        description="If true, include hidden/disabled elements (default false)",
    )


class GetAccessibilityTreeCommand(BaseCommand):
    """Get accessibility tree from the page for AI agent context"""

    type: Literal["get_accessibility_tree"] = "get_accessibility_tree"
    max_elements: Optional[int] = Field(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of elements to return (1-500, default 50)",
    )


class HighlightElementsCommand(BaseCommand):
    """Highlight interactive elements on the page for visual selection

    Uses collision-aware pagination to ensure no overlapping highlights.
    Each page returns a maximal set of non-colliding elements.
    Only one element type per call for stable, predictable pagination.

    When keywords is provided, use exact observed text or stable tokens only.
    Matching elements are returned without pagination.
    """

    type: Literal["highlight_elements"] = "highlight_elements"
    element_type: Optional[str] = Field(
        default="any",
        description="Single element type to highlight for agent-visible guidance: 'any', 'scrollable', 'inputable', 'hoverable', or 'selectable'",
    )
    page: Optional[int] = Field(
        default=1,
        ge=1,
        description="Page number for collision-aware pagination (1-indexed). Ignored when keywords is provided.",
    )
    keywords: Optional[List[str]] = Field(
        default=None,
        description="Exact observed text or stable tokens to filter by detected semantic text (visible text, labels, roles, and stable element tokens). Use only for wording already seen in the screenshot or returned HTML. When provided, only matching elements are returned (no pagination). Example: ['Continue with Email', 'View comments']",
    )


class ClickElementCommand(BaseCommand):
    """Click a highlighted element by its ID

    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["click_element"] = "click_element"
    element_id: str = Field(description="Element ID from highlight response")
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class HoverElementCommand(BaseCommand):
    """Hover over a highlighted element by its ID

    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["hover_element"] = "hover_element"
    element_id: str = Field(description="Element ID from highlight response")
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class ScrollElementCommand(BaseCommand):
    """Scroll a highlighted element in a direction, or the entire page if element_id not provided

    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["scroll_element"] = "scroll_element"
    element_id: Optional[str] = Field(
        default=None,
        description="Element ID from highlight response. If not provided, scrolls the entire page",
    )
    direction: str = Field(
        default="down", description="Scroll direction: 'up', 'down', 'left', 'right'"
    )
    scroll_amount: float = Field(
        default=0.5,
        ge=0.1,
        le=3.0,
        description=(
            "Scroll amount relative to the current scroll target's visible size "
            "(0.5 = half of the current target, 1.0 = one full visible span, "
            "2.0 = two spans). Without element_id the target is the page; with "
            "a scrollable element_id the target is that element's container."
        ),
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class SwipeElementCommand(BaseCommand):
    """Swipe a highlighted element in a direction, typically for carousel/swiper regions.

    Swipe directions are semantic content directions: next/prev refer to the next
    or previous visible item, not the finger movement direction.
    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["swipe_element"] = "swipe_element"
    element_id: str = Field(description="Element ID from highlight response")
    direction: Literal["next", "prev"] = Field(
        default="next",
        description=(
            "Semantic swipe direction for carousel/swiper regions: 'next' shows "
            "the next picture/item and 'prev' shows the previous picture/item. "
            "Do not reinterpret swipe as left/right gesture direction."
        ),
    )
    swipe_count: int = Field(
        default=1,
        ge=1,
        le=5,
        description="Number of swipe steps to perform (1-5)",
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class KeyboardInputCommand(BaseCommand):
    """Type text into a highlighted element by its ID

    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["keyboard_input"] = "keyboard_input"
    element_id: str = Field(description="Element ID from highlight response")
    text: str = Field(description="Text to input into the element")
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class SelectElementCommand(BaseCommand):
    """Select an option in a <select> element by its value.

    For multi-select (<select multiple>), pass a list of values.
    tab_id is optional and will be auto-resolved to the current managed tab if not provided.
    """

    type: Literal["select_element"] = "select_element"
    element_id: str = Field(description="Element ID from highlight response")
    value: Union[str, List[str]] = Field(
        description=(
            "The option to select. Match order: (1) the option's `value` "
            "attribute exactly, (2) the option's visible label exactly, "
            "(3) case-insensitive substring of the visible label. Prefer "
            "the `value` attribute — it is what the recorder captures from "
            "<select> change events. If unsure, run `highlight` with "
            "element_type=selectable first; the response shows the full "
            "<select> outerHTML including every <option value=\"...\">. "
            "Pass a string for single select, a list for multi-select."
        )
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, auto-resolved if not provided)",
    )


class GetElementHtmlCommand(BaseCommand):
    """Get the full HTML of a cached element by its ID from extension's elementCache"""

    type: Literal["get_element_html"] = "get_element_html"
    element_id: str = Field(description="Element ID from highlight response")
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, uses active tab if not provided)",
    )


class HighlightSingleElementCommand(BaseCommand):
    """Highlight a single element with visual confirmation for 2PC flow"""

    type: Literal["highlight_single_element"] = "highlight_single_element"
    element_id: str = Field(description="Element ID from highlight response")
    intended_action: Optional[Literal["click", "keyboard_input"]] = Field(
        default=None,
        description="Optional action name to render in the confirmation reminder banner",
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Target tab ID (optional, uses active tab if not provided)",
    )


class RecordingControlCommand(BaseCommand):
    """Start or stop browser recording mode."""

    type: Literal["recording_control"] = "recording_control"
    action: RecordingControlAction = Field(
        description="Recording action to perform: 'start' or 'stop'"
    )
    recording_id: str = Field(description="Recording session ID")
    launch_mode: Optional[RecordingLaunchMode] = Field(
        default=None,
        description=(
            "Optional recording workspace strategy for start actions. "
            "'dedicated_window' opens a fresh browser window, while "
            "'current_window' scopes recording to the focused window."
        ),
    )


class CommandResponse(BaseModel):
    """Response from command execution"""

    success: bool
    command_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    data: Optional[dict] = None
    timestamp: float = Field(default_factory=lambda: time.time())


class ScreenshotResponse(CommandResponse):
    """Response for screenshot command"""

    data: Optional[dict] = Field(
        default=None, description="Screenshot data including image base64"
    )


class TabsResponse(CommandResponse):
    """Response for get tabs command"""

    data: Optional[dict] = Field(default=None, description="Tab list data")


# Union type for all possible commands
Command = Union[
    MouseMoveCommand,
    MouseClickCommand,
    MouseScrollCommand,
    ResetMouseCommand,
    KeyboardTypeCommand,
    KeyboardPressCommand,
    ScreenshotCommand,
    TabCommand,
    GetTabsCommand,
    JavascriptExecuteCommand,
    HandleDialogCommand,
    GetGroundedElementsCommand,
    GetAccessibilityTreeCommand,
    HighlightElementsCommand,
    ClickElementCommand,
    HoverElementCommand,
    ScrollElementCommand,
    SwipeElementCommand,
    KeyboardInputCommand,
    SelectElementCommand,
    GetElementHtmlCommand | HighlightSingleElementCommand,
    RecordingControlCommand,
]


# Helper function to parse command from dict
def parse_command(data: dict) -> Command:
    """Parse command from dictionary based on type field"""
    cmd_type = data.get("type")
    if not cmd_type:
        raise ValueError("Command must have 'type' field")

    command_map = {
        "mouse_move": MouseMoveCommand,
        "mouse_click": MouseClickCommand,
        "mouse_scroll": MouseScrollCommand,
        "reset_mouse": ResetMouseCommand,
        "keyboard_type": KeyboardTypeCommand,
        "keyboard_press": KeyboardPressCommand,
        "screenshot": ScreenshotCommand,
        "tab": TabCommand,
        "get_tabs": GetTabsCommand,
        "javascript_execute": JavascriptExecuteCommand,
        "handle_dialog": HandleDialogCommand,
        "get_grounded_elements": GetGroundedElementsCommand,
        "get_accessibility_tree": GetAccessibilityTreeCommand,
        "highlight_elements": HighlightElementsCommand,
        "click_element": ClickElementCommand,
        "hover_element": HoverElementCommand,
        "scroll_element": ScrollElementCommand,
        "swipe_element": SwipeElementCommand,
        "keyboard_input": KeyboardInputCommand,
        "select_element": SelectElementCommand,
        "get_element_html": GetElementHtmlCommand,
        "highlight_single_element": HighlightSingleElementCommand,
        "recording_control": RecordingControlCommand,
    }

    if cmd_type not in command_map:
        raise ValueError(f"Unknown command type: {cmd_type}")

    return command_map[cmd_type](**data)


import time  # Import at end to avoid circular import in default_factory
