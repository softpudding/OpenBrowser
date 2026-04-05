"""Recording session routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.core.processor import command_processor
from server.core.recording_manager import (
    RecordingStatus,
    recording_manager,
)
from server.models.commands import (
    RecordingControlAction,
    RecordingControlCommand,
    RecordingLaunchMode,
)
from server.websocket.manager import ws_manager

router = APIRouter(prefix="/recordings", tags=["recordings"])


def _require_valid_browser_id(browser_id: str) -> str:
    """Require a valid browser UUID."""
    if not browser_id:
        raise HTTPException(status_code=400, detail="browser_id is required")
    if not ws_manager.is_browser_valid(browser_id):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid or expired browser_id: {browser_id}",
        )
    return browser_id


class CreateRecordingRequest(BaseModel):
    """Request body for creating a recording session."""

    browser_id: str
    name: Optional[str] = None
    launch_mode: RecordingLaunchMode = RecordingLaunchMode.DEDICATED_WINDOW
    metadata: dict[str, Any] = Field(default_factory=dict)


class RecordingEventRequest(BaseModel):
    """Request body for appending a recording event."""

    browser_id: str
    event_type: str
    event_data: dict[str, Any] = Field(default_factory=dict)


@router.post("")
async def create_recording(request: CreateRecordingRequest):
    """Create and start a new recording session."""
    browser_id = _require_valid_browser_id(request.browser_id)
    try:
        session = recording_manager.create_recording(
            browser_id=browser_id,
            name=request.name,
            metadata={
                **request.metadata,
                "launch_mode": request.launch_mode.value,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    command = RecordingControlCommand(
        action=RecordingControlAction.START,
        recording_id=session.recording_id,
        browser_id=browser_id,
        launch_mode=request.launch_mode,
    )
    response = await command_processor.execute(command)
    if not response.success:
        recording_manager.set_recording_status(
            session.recording_id,
            RecordingStatus.ERROR,
            {"start_error": response.error or response.message or "Unknown error"},
        )
        raise HTTPException(
            status_code=502,
            detail=response.error or response.message or "Failed to start recording",
        )

    session = recording_manager.get_recording(session.recording_id)
    return {
        "success": True,
        "recording": session.to_dict() if session else None,
        "extension_response": response.dict(),
    }


@router.get("")
async def list_recordings(status: Optional[str] = None, browser_id: Optional[str] = None):
    """List recording sessions."""
    parsed_status: Optional[RecordingStatus] = None
    if status:
        try:
            parsed_status = RecordingStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown status: {status}")

    sessions = recording_manager.list_recordings(
        status=parsed_status,
        browser_id=browser_id,
    )
    return {
        "success": True,
        "recordings": [session.to_dict() for session in sessions],
        "count": len(sessions),
    }


@router.get("/{recording_id}")
async def get_recording(recording_id: str):
    """Get one recording session."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    return {"success": True, "recording": session.to_dict()}


@router.get("/{recording_id}/events")
async def get_recording_events(recording_id: str):
    """Get recorded browser events."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    events = recording_manager.get_recording_events(recording_id)
    return {
        "success": True,
        "recording_id": recording_id,
        "events": events,
        "count": len(events),
    }


@router.post("/{recording_id}/stop")
async def stop_recording(recording_id: str):
    """Stop an active recording session."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    extension_response = None
    if session.status == RecordingStatus.ACTIVE and ws_manager.is_browser_valid(
        session.browser_id
    ):
        response = await command_processor.execute(
            RecordingControlCommand(
                action=RecordingControlAction.STOP,
                recording_id=recording_id,
                browser_id=session.browser_id,
            )
        )
        extension_response = response.dict()
        if not response.success:
            recording_manager.set_recording_status(
                recording_id,
                RecordingStatus.ERROR,
                {"stop_error": response.error or response.message or "Unknown error"},
            )
            raise HTTPException(
                status_code=502,
                detail=response.error or response.message or "Failed to stop recording",
            )

    recording_manager.set_recording_status(recording_id, RecordingStatus.STOPPED)
    updated = recording_manager.get_recording(recording_id)
    return {
        "success": True,
        "recording": updated.to_dict() if updated else None,
        "extension_response": extension_response,
    }


@router.post("/{recording_id}/events")
async def append_recording_event(recording_id: str, request: RecordingEventRequest):
    """Append one event to an active recording trace."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    if session.browser_id != request.browser_id:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Recording {recording_id} is bound to browser_id "
                f"{session.browser_id}"
            ),
        )

    saved = recording_manager.save_recording_event(
        recording_id=recording_id,
        event_type=request.event_type,
        event_data=request.event_data,
    )
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save recording event")

    return {"success": True, "recording_id": recording_id}
