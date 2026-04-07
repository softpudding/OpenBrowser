"""Routine management routes.

Routines are saved, named workflow SOPs that the user can replay from the
Execute panel without re-recording.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from server.core.compiler_agent import validate_sop_markdown
from server.core.routine_manager import routine_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/routines", tags=["routines"])


class CreateRoutineRequest(BaseModel):
    """Body for creating a routine directly (not via the compile pipeline)."""

    name: str
    sop_markdown: str
    source_recording_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateRoutineRequest(BaseModel):
    """Body for editing a routine. All fields optional."""

    name: str | None = None
    sop_markdown: str | None = None
    metadata: dict[str, Any] | None = None


def _validate_or_raise(content: str) -> dict[str, Any]:
    """Validate SOP markdown, raising HTTPException(400) on failure."""
    problems, summary = validate_sop_markdown(content)
    if problems or summary is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Routine SOP markdown failed validation.",
                "problems": problems,
            },
        )
    return summary


@router.get("")
async def list_routines():
    """List all saved routines, newest-updated first."""
    routines = routine_manager.list_routines()
    return {
        "success": True,
        "routines": [r.to_dict() for r in routines],
        "count": len(routines),
    }


@router.get("/{routine_id}")
async def get_routine(routine_id: str):
    """Fetch a single routine by ID."""
    routine = routine_manager.get_routine(routine_id)
    if routine is None:
        raise HTTPException(status_code=404, detail="Routine not found")
    return {"success": True, "routine": routine.to_dict()}


@router.post("")
async def create_routine(request: CreateRoutineRequest):
    """Create a routine from raw SOP markdown."""
    name = (request.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Routine name is required.")

    summary = _validate_or_raise(request.sop_markdown)

    try:
        routine = routine_manager.create_routine(
            name=name,
            sop_markdown=request.sop_markdown,
            goal=summary["goal"],
            step_count=summary["step_count"],
            source_recording_id=request.source_recording_id,
            metadata=request.metadata or {},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"success": True, "routine": routine.to_dict()}


@router.patch("/{routine_id}")
async def update_routine(routine_id: str, request: UpdateRoutineRequest):
    """Edit a routine's name or SOP markdown."""
    existing = routine_manager.get_routine(routine_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Routine not found")

    new_name = request.name
    if new_name is not None and not new_name.strip():
        raise HTTPException(status_code=400, detail="Routine name cannot be empty.")

    goal: str | None = None
    step_count: int | None = None
    if request.sop_markdown is not None:
        summary = _validate_or_raise(request.sop_markdown)
        goal = summary["goal"]
        step_count = summary["step_count"]

    try:
        updated = routine_manager.update_routine(
            routine_id=routine_id,
            name=new_name,
            sop_markdown=request.sop_markdown,
            goal=goal,
            step_count=step_count,
            metadata_updates=request.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if updated is None:
        raise HTTPException(status_code=404, detail="Routine not found")

    return {"success": True, "routine": updated.to_dict()}


@router.delete("/{routine_id}")
async def delete_routine(routine_id: str):
    """Delete a routine permanently."""
    removed = routine_manager.delete_routine(routine_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Routine not found")
    return {"success": True, "routine_id": routine_id}
