"""Browser command execution endpoints"""

from typing import Optional
from fastapi import APIRouter, HTTPException

from server.core.processor import command_processor
from server.websocket.manager import ws_manager
from server.models.commands import parse_command, CommandResponse

router = APIRouter(tags=["commands"])


@router.post("/command", response_model=CommandResponse)
async def execute_command(command_data: dict):
    """
    Execute a browser command

    Supported command types:
    - mouse_move: Move mouse relative to current position
    - mouse_click: Click at current mouse position
    - mouse_scroll: Scroll at current mouse position
    - keyboard_type: Type text at current focus
    - keyboard_press: Press special key
    - screenshot: Capture screenshot
    - tab: Tab management (open, close, switch)
    - get_tabs: Get list of all tabs

    Optional parameters:
    - browser_id: Browser UUID to route command to specific browser instance
    """
    try:
        browser_id = command_data.get("browser_id")

        if browser_id is not None:
            if not ws_manager.is_browser_valid(browser_id):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid or expired browser_id: {browser_id}",
                )

        command = parse_command(command_data)

        response = await command_processor.execute(command)

        return response

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except ConnectionError as e:
        raise HTTPException(
            status_code=503, detail=f"No Chrome extension connection: {e}"
        )
    except Exception as e:
        import logging

        logging.getLogger(__name__).error(f"Unexpected error executing command: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/mouse/move")
async def mouse_move(x: int, y: int, duration: float = 0.1):
    """Move mouse to absolute position in preset coordinate system (0-1280, 0-720)"""
    command = {"type": "mouse_move", "x": x, "y": y, "duration": duration}
    return await execute_command(command)


@router.post("/mouse/click")
async def mouse_click(button: str = "left", double: bool = False, count: int = 1):
    """Click at current mouse position"""
    command = {
        "type": "mouse_click",
        "button": button,
        "double": double,
        "count": count,
    }
    return await execute_command(command)


@router.post("/mouse/scroll")
async def mouse_scroll(direction: str = "down", amount: int = 100):
    """Scroll at current mouse position"""
    command = {"type": "mouse_scroll", "direction": direction, "amount": amount}
    return await execute_command(command)


@router.post("/keyboard/type")
async def keyboard_type(text: str):
    """Type text at current focus"""
    command = {"type": "keyboard_type", "text": text}
    return await execute_command(command)


@router.post("/keyboard/press")
async def keyboard_press(key: str, modifiers: list = None):
    """Press special key"""
    command = {"type": "keyboard_press", "key": key, "modifiers": modifiers or []}
    return await execute_command(command)


@router.post("/screenshot")
async def screenshot(
    tab_id: int = None,
    include_cursor: bool = True,
    include_visual_mouse: bool = True,
    quality: int = 90,
):
    """Capture screenshot"""
    command = {
        "type": "screenshot",
        "tab_id": tab_id,
        "include_cursor": include_cursor,
        "include_visual_mouse": include_visual_mouse,
        "quality": quality,
    }
    return await execute_command(command)


@router.post("/tabs")
async def tab_action(action: str, url: str = None, tab_id: int = None):
    """Tab management"""
    command = {"type": "tab", "action": action, "url": url, "tab_id": tab_id}
    return await execute_command(command)


@router.get("/tabs")
async def get_tabs(managed_only: bool = True):
    """Get list of all tabs"""
    command = {"type": "get_tabs", "managed_only": managed_only}
    return await execute_command(command)
