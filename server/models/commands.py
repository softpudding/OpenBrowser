from enum import Enum
from typing import Optional, List, Tuple, Literal, Union
from pydantic import BaseModel, Field, validator
import re


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


class BaseCommand(BaseModel):
    """Base command model with common fields"""
    command_id: Optional[str] = Field(
        default=None,
        description="Optional unique identifier for tracking command execution"
    )
    timestamp: Optional[float] = Field(
        default=None,
        description="Timestamp when command was created (epoch seconds)"
    )


class MouseMoveCommand(BaseCommand):
    """Move mouse relative to current position"""
    type: Literal["mouse_move"] = "mouse_move"
    dx: int = Field(
        description="Horizontal movement (positive = right, negative = left)",
        ge=-5000,
        le=5000
    )
    dy: int = Field(
        description="Vertical movement (positive = down, negative = up)",
        ge=-5000,
        le=5000
    )
    duration: Optional[float] = Field(
        default=0.1,
        description="Duration of movement in seconds (for animation)",
        gt=0,
        le=5.0
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
    amount: int = Field(default=100, ge=1, le=1000, description="Scroll amount in pixels")


class ResetMouseCommand(BaseCommand):
    """Reset mouse position to screen center"""
    type: Literal["reset_mouse"] = "reset_mouse"


class KeyboardTypeCommand(BaseCommand):
    """Type text at current focus"""
    type: Literal["keyboard_type"] = "keyboard_type"
    text: str = Field(description="Text to type", max_length=1000)
    
    @validator('text')
    def validate_text(cls, v):
        # Remove control characters except newline, tab
        v = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', v)
        return v


class KeyboardPressCommand(BaseCommand):
    """Press special key"""
    type: Literal["keyboard_press"] = "keyboard_press"
    key: str = Field(
        description="Key to press (e.g., 'Enter', 'Escape', 'Tab', 'Backspace')",
        max_length=50
    )
    modifiers: List[str] = Field(
        default_factory=list,
        description="Modifier keys (e.g., ['Control', 'Shift'])"
    )


class ScreenshotCommand(BaseCommand):
    """Capture screenshot"""
    type: Literal["screenshot"] = "screenshot"
    tab_id: Optional[int] = Field(
        default=None,
        description="Specific tab ID to capture (None = current tab)"
    )
    include_cursor: bool = Field(
        default=True,
        description="Whether to include mouse cursor in screenshot"
    )
    quality: int = Field(
        default=90,
        ge=1,
        le=100,
        description="JPEG quality (1-100)"
    )


class TabCommand(BaseCommand):
    """Tab management command"""
    type: Literal["tab"] = "tab"
    action: TabAction
    url: Optional[str] = Field(
        default=None,
        description="URL for open action, tab ID for close/switch"
    )
    tab_id: Optional[int] = Field(
        default=None,
        description="Tab ID for close/switch actions"
    )
    
    @validator('url')
    def validate_url(cls, v, values):
        action = values.get('action')
        if action in [TabAction.OPEN, TabAction.INIT]:
            if not v:
                raise ValueError(f"URL is required for {action} action")
            # Ensure URL has protocol
            if not re.match(r'^https?://', v):
                v = f'https://{v}'
        return v


class GetTabsCommand(BaseCommand):
    """Get list of all tabs"""
    type: Literal["get_tabs"] = "get_tabs"


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
        default=None,
        description="Screenshot data including image base64"
    )


class TabsResponse(CommandResponse):
    """Response for get tabs command"""
    data: Optional[dict] = Field(
        default=None,
        description="Tab list data"
    )


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
]


# Helper function to parse command from dict
def parse_command(data: dict) -> Command:
    """Parse command from dictionary based on type field"""
    cmd_type = data.get('type')
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
    }
    
    if cmd_type not in command_map:
        raise ValueError(f"Unknown command type: {cmd_type}")
    
    return command_map[cmd_type](**data)


import time  # Import at end to avoid circular import in default_factory