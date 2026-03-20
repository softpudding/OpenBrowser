"""Browser UUID management endpoints"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.websocket.manager import ws_manager

router = APIRouter(prefix="/browsers", tags=["browsers"])

logger = logging.getLogger(__name__)


class BrowserRegisterRequest(BaseModel):
    """Request model for browser registration"""

    uuid: str
    connection_id: str
    ttl_hours: int = 24


class BrowserRegisterResponse(BaseModel):
    """Response model for browser registration"""

    success: bool
    uuid: str
    message: str


class BrowserValidityResponse(BaseModel):
    """Response model for browser validity check"""

    success: bool
    uuid: str
    valid: bool
    message: str


@router.post("/register", response_model=BrowserRegisterResponse)
async def register_browser(request: BrowserRegisterRequest):
    """
    Register a browser with UUID for identification.

    This endpoint allows a browser extension to register itself with a unique UUID.
    The UUID can then be used to route commands to specific browser instances.

    Args:
        request: BrowserRegisterRequest containing uuid and optional ttl_hours

    Returns:
        BrowserRegisterResponse with success status and uuid
    """
    try:
        # Validate UUID format (basic check)
        if not request.uuid or len(request.uuid) < 8:
            raise HTTPException(
                status_code=400, detail="UUID must be at least 8 characters"
            )

        websocket = ws_manager.get_websocket_by_connection_id(request.connection_id)
        if websocket is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid or stale connection_id. "
                    "Reconnect the extension and try again."
                ),
            )

        # Register the browser with UUID
        ws_manager.register_browser(
            uuid=request.uuid, websocket=websocket, ttl_hours=request.ttl_hours
        )

        logger.info(
            "Registered browser with UUID: "
            f"{request.uuid} on connection {request.connection_id}"
        )

        return BrowserRegisterResponse(
            success=True,
            uuid=request.uuid,
            message=f"Browser registered successfully with TTL of {request.ttl_hours} hours",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering browser: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to register browser: {e}")


@router.get("/{uuid}/valid", response_model=BrowserValidityResponse)
async def check_browser_validity(uuid: str):
    """
    Check if a browser UUID is valid and not expired.

    Args:
        uuid: UUID string to validate

    Returns:
        BrowserValidityResponse with validity status
    """
    try:
        is_valid = ws_manager.is_browser_valid(uuid)

        return BrowserValidityResponse(
            success=True,
            uuid=uuid,
            valid=is_valid,
            message=(
                "Browser UUID is valid"
                if is_valid
                else "Browser UUID is invalid or expired"
            ),
        )

    except Exception as e:
        logger.error(f"Error checking browser validity: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to check validity: {e}")


@router.delete("/{uuid}")
async def unregister_browser(uuid: str):
    """
    Unregister a browser by UUID.

    Args:
        uuid: UUID string identifying the browser to unregister

    Returns:
        Success response if unregistered, 404 if not found
    """
    try:
        success = ws_manager.unregister_browser(uuid)

        if success:
            return {"success": True, "uuid": uuid, "message": "Browser unregistered"}
        else:
            raise HTTPException(
                status_code=404, detail=f"Browser with UUID {uuid} not found"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error unregistering browser: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to unregister browser: {e}"
        )
