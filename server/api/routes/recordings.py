"""Recording session routes."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from server.api.sse import create_sse_response_headers
from server.core.compiler_agent import (
    close_compiler_session,
    compile_with_agent,
    continue_compilation,
    finalize_compiler_session,
    has_compiler_session,
)
from server.core.llm_config import llm_config_manager
from server.core.processor import command_processor
from server.core.recording_manager import (
    RecordingStatus,
    recording_manager,
)
from server.core.routine_manager import routine_manager
from server.core.workflow_compiler import compile_recording_trace
from server.models.commands import (
    RecordingControlAction,
    RecordingControlCommand,
    RecordingLaunchMode,
)
from server.websocket.manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recordings", tags=["recordings"])


async def _wrap_compiler_stream(
    inner: AsyncGenerator[str, None],
    recording_id: str,
) -> AsyncGenerator[str, None]:
    """Wrap compiler SSE stream to persist Routine metadata on completion."""
    async for payload in inner:
        yield payload
        # Intercept the complete event to save metadata. Persist for both
        # "completed" (terminal) and "review" (in-progress draft) so the
        # latest Routine draft is recoverable if the user navigates away.
        if payload.startswith("event: complete\n"):
            try:
                data_line = payload.split("data: ", 1)[1].split("\n")[0]
                data = json.loads(data_line)
                result = data.get("result", {})
                if result.get("status") in ("completed", "review"):
                    recording_manager.update_metadata(
                        recording_id, {"compiler_routine": result}
                    )
            except Exception as exc:
                logger.warning("Failed to save compiler Routine metadata: %s", exc)


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
    name: str | None = None
    launch_mode: RecordingLaunchMode = RecordingLaunchMode.DEDICATED_WINDOW
    metadata: dict[str, Any] = Field(default_factory=dict)


class IntentNoteRequest(BaseModel):
    """Request body for saving a user intent note."""

    intent_note: str


class CompileRecordingRequest(BaseModel):
    """Request body for compiling a recording trace."""

    model_alias: str | None = None


class CompileAnswerRequest(BaseModel):
    """Request body for answering a compiler clarification question."""

    answer: str


class FinalizeCompilerRequest(BaseModel):
    """Request body for finalizing a compiled Routine draft."""

    name: str


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
        raise HTTPException(status_code=409, detail=str(exc)) from exc

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
async def list_recordings(status: str | None = None, browser_id: str | None = None):
    """List recording sessions."""
    parsed_status: RecordingStatus | None = None
    if status:
        try:
            parsed_status = RecordingStatus(status)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=f"Unknown status: {status}"
            ) from exc

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


@router.delete("/{recording_id}")
async def delete_recording(recording_id: str):
    """Permanently delete a recording session and all its events.

    Refuses to delete a still-active recording — stop it first. Clears any
    in-memory compiler session bound to this recording before dropping the
    row so we do not leave dangling state.
    """
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    if session.status == RecordingStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail=(
                "Recording is still active. Stop the recording before " "deleting it."
            ),
        )

    close_compiler_session(recording_id)

    deleted = recording_manager.delete_recording(recording_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Recording not found",
        )

    return {"success": True, "recording_id": recording_id}


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


@router.get("/{recording_id}/workflow-draft")
async def get_recording_workflow_draft(recording_id: str):
    """Compile recording trace into normalized steps and workflow JSON draft."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    events = recording_manager.get_recording_events(recording_id)
    draft = compile_recording_trace(
        recording_id=recording_id,
        events=events,
        recording_name=session.name,
    )

    return {
        "success": True,
        "recording_id": recording_id,
        "normalized_steps": draft.normalized_steps,
        "normalized_step_count": len(draft.normalized_steps),
        "workflow": draft.workflow,
    }


@router.post("/{recording_id}/stop")
async def stop_recording(recording_id: str):
    """Stop an active recording session."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    extension_response = None
    if session.status == RecordingStatus.ACTIVE:
        if not ws_manager.is_browser_valid(session.browser_id):
            # The browser is no longer connected — we can't deliver a stop
            # command, but we also must NOT leave the row stuck in ACTIVE:
            # that would block `DELETE /recordings/{id}` (it refuses active
            # rows) AND block `create_recording()` (it refuses a second
            # active recording for the same browser), locking the user out
            # until the DB is fixed manually. Transition the row to STOPPED
            # locally with a metadata note so the user can clean up and
            # start a new recording.
            recording_manager.set_recording_status(
                recording_id,
                RecordingStatus.STOPPED,
                {
                    "stop_reason": "browser_disconnected",
                    "stop_note": (
                        "Browser websocket was no longer valid when /stop "
                        "was called; recording marked stopped locally "
                        "without delivering a stop command to the extension."
                    ),
                },
            )
            updated = recording_manager.get_recording(recording_id)
            return {
                "success": True,
                "recording": updated.to_dict() if updated else None,
                "extension_response": None,
                "stop_reason": "browser_disconnected",
            }

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


@router.post("/{recording_id}/intent-note")
async def save_intent_note(recording_id: str, request: IntentNoteRequest):
    """Save or update the user intent note for a recording."""
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    recording_manager.update_metadata(
        recording_id, {"intent_note": request.intent_note}
    )
    updated = recording_manager.get_recording(recording_id)
    return {
        "success": True,
        "recording": updated.to_dict() if updated else None,
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
    if session.status != RecordingStatus.ACTIVE:
        # Keyframe captures in the recorder run async, so an in-flight POST
        # can arrive after /stop has already flipped the row out of ACTIVE.
        # Reject late arrivals so a trace the user has already reviewed or
        # compiled cannot silently change underneath them.
        raise HTTPException(
            status_code=409,
            detail=(
                f"Recording {recording_id} is no longer active "
                f"(status={session.status.value}); cannot append events."
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


@router.post("/{recording_id}/compile")
async def compile_recording_with_agent(
    recording_id: str, request: CompileRecordingRequest
):
    """Compile a recording trace into a Browser Routine via the Compiler Agent.

    Returns an SSE stream. Events:
    - agent_event: compiler agent tool calls and reasoning
    - complete: final result with status "asking" or "completed"
    - error: on failure
    """
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    events = recording_manager.get_recording_events(recording_id)
    intent_note = (session.metadata or {}).get("intent_note")

    # Pre-validate LLM config before starting the stream
    llm_config = llm_config_manager.get_llm_config(request.model_alias)
    if not llm_config.api_key:
        raise HTTPException(status_code=400, detail="LLM API key is not configured")

    sse_generator = compile_with_agent(
        recording_id=recording_id,
        events=events,
        intent_note=intent_note,
        recording_name=session.name,
        model_alias=request.model_alias,
    )

    return StreamingResponse(
        _wrap_compiler_stream(sse_generator, recording_id),
        media_type="text/event-stream",
        headers=create_sse_response_headers(),
    )


@router.post("/{recording_id}/compile/answer")
async def answer_compiler_question(recording_id: str, request: CompileAnswerRequest):
    """Answer a clarification question from the Compiler Agent.

    Returns an SSE stream as the compiler agent resumes.
    """
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    if not has_compiler_session(recording_id):
        raise HTTPException(
            status_code=400,
            detail=f"No active compiler session for recording {recording_id}. Call compile first.",
        )

    sse_generator = continue_compilation(
        recording_id=recording_id,
        user_answer=request.answer,
    )

    return StreamingResponse(
        _wrap_compiler_stream(sse_generator, recording_id),
        media_type="text/event-stream",
        headers=create_sse_response_headers(),
    )


@router.post("/{recording_id}/compile/finalize")
async def finalize_compiler_routine(
    recording_id: str, request: FinalizeCompilerRequest
):
    """Approve the Routine currently in review and save it as a named routine.

    The user clicks this when the post-submit wrap-up looks correct. They
    must also pick a name for the routine — the routine is created
    atomically with finalize and is the user-facing handle for replaying
    the workflow later.
    """
    session = recording_manager.get_recording(recording_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    routine_name = (request.name or "").strip()
    if not routine_name:
        raise HTTPException(
            status_code=400, detail="Routine name is required to finalize."
        )

    if not has_compiler_session(recording_id):
        raise HTTPException(
            status_code=400,
            detail=(
                f"No active compiler session for recording {recording_id}. "
                f"Cannot finalize — start a new compile first."
            ),
        )

    try:
        routine_doc = finalize_compiler_session(recording_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    routine_markdown = routine_doc.get("routine_markdown") or ""
    if not routine_markdown.strip():
        raise HTTPException(
            status_code=400,
            detail="Cannot finalize: compiler session has no Routine markdown.",
        )

    try:
        routine = routine_manager.create_routine(
            name=routine_name,
            routine_markdown=routine_markdown,
            goal=routine_doc.get("goal", ""),
            step_count=int(routine_doc.get("step_count", 0) or 0),
            source_recording_id=recording_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to persist routine for recording %s", recording_id)
        raise HTTPException(
            status_code=500, detail=f"Failed to save routine: {exc}"
        ) from exc

    try:
        recording_manager.update_metadata(
            recording_id,
            {
                "compiler_routine": routine_doc,
                "routine_id": routine.routine_id,
                "routine_name": routine.name,
            },
        )
    except Exception as exc:
        logger.warning("Failed to save compiler Routine metadata: %s", exc)

    return {"result": routine_doc, "routine": routine.to_dict()}
