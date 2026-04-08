"""Persistent storage for finalized Browser Routines.

A Browser Routine is a named, executable form of a finalized routine
markdown document. It's created when the user finalizes a compiled
Routine and can later be replayed from the Execute panel without
re-recording or re-typing.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from server.core.session_manager import session_manager

logger = logging.getLogger(__name__)


@dataclass
class Routine:
    """A saved Browser Routine."""

    routine_id: str
    name: str
    routine_markdown: str
    goal: str = ""
    step_count: int = 0
    source_recording_id: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to a JSON-friendly dictionary."""
        return {
            "routine_id": self.routine_id,
            "name": self.name,
            "routine_markdown": self.routine_markdown,
            "goal": self.goal,
            "step_count": self.step_count,
            "source_recording_id": self.source_recording_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
        }


class RoutineManager:
    """Stores and retrieves saved Browser Routines."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path or session_manager.db_path
        self._init_database()

    def _init_database(self) -> None:
        """Initialize the routines table and migrate legacy column names."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS routines (
                    routine_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    routine_markdown TEXT NOT NULL,
                    goal TEXT NOT NULL DEFAULT '',
                    step_count INTEGER NOT NULL DEFAULT 0,
                    source_recording_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata TEXT NOT NULL DEFAULT '{}'
                )
                """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_routines_updated_at
                ON routines(updated_at DESC)
                """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_routines_name
                ON routines(name)
                """)

            # Migrate pre-rename databases that still have the old
            # `sop_markdown` column. Safe to run on every startup because
            # we only rename when the old column is present.
            cursor.execute("PRAGMA table_info(routines)")
            columns = {row[1] for row in cursor.fetchall()}
            if "sop_markdown" in columns and "routine_markdown" not in columns:
                cursor.execute(
                    "ALTER TABLE routines RENAME COLUMN sop_markdown TO routine_markdown"
                )
                logger.info(
                    "Migrated routines.sop_markdown -> routines.routine_markdown"
                )

            conn.commit()
        finally:
            conn.close()

    def create_routine(
        self,
        name: str,
        routine_markdown: str,
        goal: str = "",
        step_count: int = 0,
        source_recording_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Routine:
        """Create and persist a new routine."""
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("Routine name is required.")

        clean_markdown = routine_markdown or ""
        if not clean_markdown.strip():
            raise ValueError("Routine markdown is required.")

        now = datetime.now()
        routine = Routine(
            routine_id=str(uuid.uuid4()),
            name=clean_name,
            routine_markdown=clean_markdown,
            goal=goal or "",
            step_count=int(step_count or 0),
            source_recording_id=source_recording_id,
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO routines (
                    routine_id,
                    name,
                    routine_markdown,
                    goal,
                    step_count,
                    source_recording_id,
                    created_at,
                    updated_at,
                    metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    routine.routine_id,
                    routine.name,
                    routine.routine_markdown,
                    routine.goal,
                    routine.step_count,
                    routine.source_recording_id,
                    routine.created_at.isoformat(),
                    routine.updated_at.isoformat(),
                    json.dumps(routine.metadata),
                ),
            )
            conn.commit()
            return routine
        finally:
            conn.close()

    def get_routine(self, routine_id: str) -> Optional[Routine]:
        """Get a single routine by ID."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT
                    routine_id,
                    name,
                    routine_markdown,
                    goal,
                    step_count,
                    source_recording_id,
                    created_at,
                    updated_at,
                    metadata
                FROM routines
                WHERE routine_id = ?
                """,
                (routine_id,),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        if row is None:
            return None
        return self._row_to_routine(row)

    def list_routines(self, limit: int = 200, offset: int = 0) -> list[Routine]:
        """List all routines, newest-updated first."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT
                    routine_id,
                    name,
                    routine_markdown,
                    goal,
                    step_count,
                    source_recording_id,
                    created_at,
                    updated_at,
                    metadata
                FROM routines
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            )
            rows = cursor.fetchall()
        finally:
            conn.close()
        return [self._row_to_routine(row) for row in rows]

    def update_routine(
        self,
        routine_id: str,
        name: Optional[str] = None,
        routine_markdown: Optional[str] = None,
        goal: Optional[str] = None,
        step_count: Optional[int] = None,
        metadata_updates: Optional[dict[str, Any]] = None,
    ) -> Optional[Routine]:
        """Update fields on an existing routine. Returns the updated routine."""
        existing = self.get_routine(routine_id)
        if existing is None:
            return None

        new_name = existing.name if name is None else name.strip()
        if not new_name:
            raise ValueError("Routine name cannot be empty.")

        new_markdown = (
            existing.routine_markdown if routine_markdown is None else routine_markdown
        )
        if not (new_markdown or "").strip():
            raise ValueError("Routine markdown cannot be empty.")

        new_goal = existing.goal if goal is None else (goal or "")
        new_step_count = (
            existing.step_count if step_count is None else int(step_count or 0)
        )

        merged_metadata = existing.metadata.copy()
        if metadata_updates:
            merged_metadata.update(metadata_updates)

        now = datetime.now()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                UPDATE routines
                SET name = ?,
                    routine_markdown = ?,
                    goal = ?,
                    step_count = ?,
                    updated_at = ?,
                    metadata = ?
                WHERE routine_id = ?
                """,
                (
                    new_name,
                    new_markdown,
                    new_goal,
                    new_step_count,
                    now.isoformat(),
                    json.dumps(merged_metadata),
                    routine_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_routine(routine_id)

    def delete_routine(self, routine_id: str) -> bool:
        """Delete a routine by ID. Returns True if a row was removed."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM routines WHERE routine_id = ?",
                (routine_id,),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def _row_to_routine(self, row: tuple) -> Routine:
        return Routine(
            routine_id=row[0],
            name=row[1],
            routine_markdown=row[2],
            goal=row[3] or "",
            step_count=int(row[4] or 0),
            source_recording_id=row[5],
            created_at=datetime.fromisoformat(row[6]),
            updated_at=datetime.fromisoformat(row[7]),
            metadata=json.loads(row[8]) if row[8] else {},
        )


routine_manager = RoutineManager()
