"""Persistent storage for browser recording sessions and events."""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from server.core.session_manager import session_manager

logger = logging.getLogger(__name__)


class RecordingStatus(str, Enum):
    """Recording session status."""

    ACTIVE = "active"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class RecordingSession:
    """Recording session metadata."""

    recording_id: str
    browser_id: str
    status: RecordingStatus
    created_at: datetime
    updated_at: datetime
    started_at: datetime
    stopped_at: Optional[datetime] = None
    name: Optional[str] = None
    event_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to a JSON-friendly dictionary."""
        return {
            "recording_id": self.recording_id,
            "browser_id": self.browser_id,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "started_at": self.started_at.isoformat(),
            "stopped_at": self.stopped_at.isoformat() if self.stopped_at else None,
            "name": self.name,
            "event_count": self.event_count,
            "metadata": self.metadata,
        }


class RecordingManager:
    """Stores recording sessions and their captured browser events."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or session_manager.db_path
        self._init_database()

    def _init_database(self) -> None:
        """Initialize SQLite tables for recordings."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS recording_sessions (
                    recording_id TEXT PRIMARY KEY,
                    browser_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    stopped_at TEXT,
                    name TEXT,
                    event_count INTEGER NOT NULL DEFAULT 0,
                    metadata TEXT NOT NULL DEFAULT '{}'
                )
                """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS recording_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recording_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    event_data TEXT NOT NULL,
                    event_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (recording_id) REFERENCES recording_sessions(recording_id),
                    UNIQUE(recording_id, event_index)
                )
                """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_recording_sessions_browser_status
                ON recording_sessions(browser_id, status)
                """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_recording_sessions_updated_at
                ON recording_sessions(updated_at DESC)
                """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_recording_events_recording
                ON recording_events(recording_id, event_index)
                """)
            conn.commit()
        finally:
            conn.close()

    def create_recording(
        self,
        browser_id: str,
        name: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        recording_id: Optional[str] = None,
    ) -> RecordingSession:
        """Create a new active recording for a browser."""
        existing = self.get_active_recording_for_browser(browser_id)
        if existing is not None:
            raise ValueError(
                f"Browser {browser_id} already has an active recording: "
                f"{existing.recording_id}"
            )

        recording_id = recording_id or str(uuid.uuid4())
        now = datetime.now()
        session = RecordingSession(
            recording_id=recording_id,
            browser_id=browser_id,
            status=RecordingStatus.ACTIVE,
            created_at=now,
            updated_at=now,
            started_at=now,
            name=name,
            event_count=0,
            metadata=metadata or {},
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO recording_sessions (
                    recording_id,
                    browser_id,
                    status,
                    created_at,
                    updated_at,
                    started_at,
                    stopped_at,
                    name,
                    event_count,
                    metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.recording_id,
                    session.browser_id,
                    session.status.value,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                    session.started_at.isoformat(),
                    None,
                    session.name,
                    session.event_count,
                    json.dumps(session.metadata),
                ),
            )
            conn.commit()
            return session
        finally:
            conn.close()

    def get_recording(self, recording_id: str) -> Optional[RecordingSession]:
        """Get one recording session."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT
                    recording_id,
                    browser_id,
                    status,
                    created_at,
                    updated_at,
                    started_at,
                    stopped_at,
                    name,
                    event_count,
                    metadata
                FROM recording_sessions
                WHERE recording_id = ?
                """,
                (recording_id,),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        if row is None:
            return None

        return RecordingSession(
            recording_id=row[0],
            browser_id=row[1],
            status=RecordingStatus(row[2]),
            created_at=datetime.fromisoformat(row[3]),
            updated_at=datetime.fromisoformat(row[4]),
            started_at=datetime.fromisoformat(row[5]),
            stopped_at=datetime.fromisoformat(row[6]) if row[6] else None,
            name=row[7],
            event_count=row[8],
            metadata=json.loads(row[9]) if row[9] else {},
        )

    def get_active_recording_for_browser(
        self, browser_id: str
    ) -> Optional[RecordingSession]:
        """Return the active recording for a browser, if any."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT recording_id
                FROM recording_sessions
                WHERE browser_id = ? AND status = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (browser_id, RecordingStatus.ACTIVE.value),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        if row is None:
            return None

        return self.get_recording(row[0])

    def list_recordings(
        self,
        status: Optional[RecordingStatus] = None,
        browser_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[RecordingSession]:
        """List recordings with optional filters."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        conditions: list[str] = []
        parameters: list[Any] = []

        if status is not None:
            conditions.append("status = ?")
            parameters.append(status.value)
        if browser_id is not None:
            conditions.append("browser_id = ?")
            parameters.append(browser_id)

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        try:
            cursor.execute(
                f"""
                SELECT
                    recording_id,
                    browser_id,
                    status,
                    created_at,
                    updated_at,
                    started_at,
                    stopped_at,
                    name,
                    event_count,
                    metadata
                FROM recording_sessions
                {where_clause}
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
                """,
                [*parameters, limit, offset],
            )
            rows = cursor.fetchall()
        finally:
            conn.close()

        sessions: list[RecordingSession] = []
        for row in rows:
            sessions.append(
                RecordingSession(
                    recording_id=row[0],
                    browser_id=row[1],
                    status=RecordingStatus(row[2]),
                    created_at=datetime.fromisoformat(row[3]),
                    updated_at=datetime.fromisoformat(row[4]),
                    started_at=datetime.fromisoformat(row[5]),
                    stopped_at=datetime.fromisoformat(row[6]) if row[6] else None,
                    name=row[7],
                    event_count=row[8],
                    metadata=json.loads(row[9]) if row[9] else {},
                )
            )
        return sessions

    def set_recording_status(
        self,
        recording_id: str,
        status: RecordingStatus,
        metadata_updates: Optional[dict[str, Any]] = None,
    ) -> bool:
        """Update recording status and merge metadata."""
        existing = self.get_recording(recording_id)
        if existing is None:
            return False

        metadata = existing.metadata.copy()
        if metadata_updates:
            metadata.update(metadata_updates)

        now = datetime.now().isoformat()
        stopped_at = now if status != RecordingStatus.ACTIVE else None

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                UPDATE recording_sessions
                SET status = ?, updated_at = ?, stopped_at = ?, metadata = ?
                WHERE recording_id = ?
                """,
                (
                    status.value,
                    now,
                    stopped_at,
                    json.dumps(metadata),
                    recording_id,
                ),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def update_metadata(
        self,
        recording_id: str,
        metadata_updates: dict[str, Any],
    ) -> bool:
        """Merge metadata fields without changing status or stopped_at."""
        existing = self.get_recording(recording_id)
        if existing is None:
            return False

        metadata = existing.metadata.copy()
        metadata.update(metadata_updates)

        now = datetime.now().isoformat()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                UPDATE recording_sessions
                SET updated_at = ?, metadata = ?
                WHERE recording_id = ?
                """,
                (now, json.dumps(metadata), recording_id),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def save_recording_event(
        self,
        recording_id: str,
        event_type: str,
        event_data: dict[str, Any],
        event_index: Optional[int] = None,
    ) -> bool:
        """Persist a single recording event."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        now = datetime.now().isoformat()

        try:
            if event_index is None:
                cursor.execute(
                    """
                    SELECT COALESCE(MAX(event_index), -1) + 1
                    FROM recording_events
                    WHERE recording_id = ?
                    """,
                    (recording_id,),
                )
                row = cursor.fetchone()
                event_index = int(row[0]) if row is not None else 0

            cursor.execute(
                """
                INSERT INTO recording_events (
                    recording_id,
                    event_type,
                    event_data,
                    event_index,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    recording_id,
                    event_type,
                    json.dumps(self._strip_large_payloads(event_data)),
                    event_index,
                    now,
                ),
            )
            cursor.execute(
                """
                UPDATE recording_sessions
                SET updated_at = ?, event_count = event_count + 1
                WHERE recording_id = ?
                """,
                (now, recording_id),
            )
            conn.commit()
            return True
        except Exception:
            logger.exception("Failed to save recording event for %s", recording_id)
            return False
        finally:
            conn.close()

    def get_recording_events(
        self, recording_id: str, limit: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """Get recording event history."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            if limit is None:
                cursor.execute(
                    """
                    SELECT event_type, event_data, event_index, created_at
                    FROM recording_events
                    WHERE recording_id = ?
                    ORDER BY event_index ASC
                    """,
                    (recording_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT event_type, event_data, event_index, created_at
                    FROM recording_events
                    WHERE recording_id = ?
                    ORDER BY event_index ASC
                    LIMIT ?
                    """,
                    (recording_id, limit),
                )
            rows = cursor.fetchall()
        finally:
            conn.close()

        return [
            {
                "event_type": row[0],
                "event_data": json.loads(row[1]),
                "event_index": row[2],
                "created_at": row[3],
            }
            for row in rows
        ]

    def delete_recording(self, recording_id: str) -> bool:
        """Delete a recording session and all of its captured events.

        Returns True when the session row existed and was removed. Returns
        False when there was no such recording. The two tables (events and
        sessions) are cleared in a single transaction so we never leave
        orphaned events behind.
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM recording_events WHERE recording_id = ?",
                (recording_id,),
            )
            cursor.execute(
                "DELETE FROM recording_sessions WHERE recording_id = ?",
                (recording_id,),
            )
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        finally:
            conn.close()

    def _strip_large_payloads(self, event_data: dict[str, Any]) -> dict[str, Any]:
        """Drop obviously large fields that do not belong in trace storage."""
        stripped = dict(event_data)
        for key in ["image", "image_url", "screenshot", "screenshot_data_url"]:
            stripped.pop(key, None)
        return stripped


recording_manager = RecordingManager()
