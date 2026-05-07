"""Browser command execution endpoints"""

from fastapi import APIRouter, HTTPException

from server.core.processor import command_processor
from server.core.session_manager import session_manager
from server.websocket.manager import ws_manager
from server.models.commands import parse_command, CommandResponse

router = APIRouter(tags=["commands"])


def _resolve_and_validate_browser_id(command_data: dict) -> str:
    """Resolve effective browser_id from request or bound conversation metadata."""
    requested_browser_id = command_data.get("browser_id")
    conversation_id = command_data.get("conversation_id")

    session = (
        session_manager.get_session(conversation_id)
        if conversation_id is not None
        else None
    )
    bound_browser_id = None
    if session is not None:
        maybe_browser_id = session.metadata.get("browser_id")
        if isinstance(maybe_browser_id, str) and maybe_browser_id:
            bound_browser_id = maybe_browser_id

    if requested_browser_id:
        if bound_browser_id and bound_browser_id != requested_browser_id:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Conversation {conversation_id} is already bound to browser_id "
                    f"{bound_browser_id}"
                ),
            )
        browser_id = requested_browser_id
    elif bound_browser_id:
        browser_id = bound_browser_id
    else:
        raise HTTPException(
            status_code=400,
            detail="browser_id is required to execute browser commands",
        )

    if not ws_manager.is_browser_valid(browser_id):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid or expired browser_id: {browser_id}",
        )

    return browser_id


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

    Required parameters:
    - browser_id: Browser UUID to route command to specific browser instance
    """
    try:
        browser_id = _resolve_and_validate_browser_id(command_data)
        command = parse_command({**command_data, "browser_id": browser_id})

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
async def mouse_move(x: int, y: int, browser_id: str, duration: float = 0.1):
    """Move mouse to an absolute CSS-pixel position in the live viewport.

    `x` and `y` are CSS pixels with `x, y >= 0`. The extension clamps to the
    live viewport before dispatch, so callers don't need to know the exact
    viewport size — but values should be within plausible browser dimensions
    (e.g. up to 4K). The legacy 0-1280/0-720 cap is no longer enforced now
    that the live agent path uses Qwen-VL [0,1000] coords with server-side
    denormalization (see `BrowserExecutor._denormalize_xy`).
    """
    command = {
        "type": "mouse_move",
        "x": x,
        "y": y,
        "duration": duration,
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.post("/mouse/click")
async def mouse_click(
    browser_id: str, button: str = "left", double: bool = False, count: int = 1
):
    """Click at current mouse position"""
    command = {
        "type": "mouse_click",
        "button": button,
        "double": double,
        "count": count,
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.post("/mouse/scroll")
async def mouse_scroll(browser_id: str, direction: str = "down", amount: int = 100):
    """Scroll at current mouse position"""
    command = {
        "type": "mouse_scroll",
        "direction": direction,
        "amount": amount,
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.post("/keyboard/type")
async def keyboard_type(text: str, browser_id: str):
    """Type text at current focus"""
    command = {"type": "keyboard_type", "text": text, "browser_id": browser_id}
    return await execute_command(command)


@router.post("/keyboard/press")
async def keyboard_press(key: str, browser_id: str, modifiers: list = None):
    """Press special key"""
    command = {
        "type": "keyboard_press",
        "key": key,
        "modifiers": modifiers or [],
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.post("/screenshot")
async def screenshot(
    browser_id: str,
    conversation_id: str | None = None,
    tab_id: int = None,
    include_cursor: bool = True,
    include_visual_mouse: bool = True,
    quality: int = 90,
):
    """Capture screenshot"""
    if not conversation_id:
        raise HTTPException(
            status_code=400,
            detail="conversation_id is required for screenshot in strict mode",
        )
    command = {
        "type": "screenshot",
        "conversation_id": conversation_id,
        "tab_id": tab_id,
        "include_cursor": include_cursor,
        "include_visual_mouse": include_visual_mouse,
        "quality": quality,
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.post("/tabs")
async def tab_action(
    action: str,
    browser_id: str,
    conversation_id: str | None = None,
    url: str = None,
    tab_id: int = None,
):
    """Tab management"""
    if not conversation_id:
        raise HTTPException(
            status_code=400,
            detail="conversation_id is required for tab commands in strict mode",
        )
    command = {
        "type": "tab",
        "action": action,
        "conversation_id": conversation_id,
        "url": url,
        "tab_id": tab_id,
        "browser_id": browser_id,
    }
    return await execute_command(command)


@router.get("/tabs")
async def get_tabs(
    browser_id: str,
    managed_only: bool = True,
    conversation_id: str | None = None,
):
    """Get list of all tabs"""
    if managed_only and not conversation_id:
        raise HTTPException(
            status_code=400,
            detail="conversation_id is required for managed tab listing in strict mode",
        )
    command = {
        "type": "get_tabs",
        "managed_only": managed_only,
        "conversation_id": conversation_id,
        "browser_id": browser_id,
    }
    return await execute_command(command)
