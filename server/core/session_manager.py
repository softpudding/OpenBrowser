"""
Session Manager - Persistent conversation management with SQLite backend
"""

import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)


class SessionStatus(str, Enum):
    """Session status enum"""

    ACTIVE = "active"
    IDLE = "idle"
    ERROR = "error"
    COMPLETED = "completed"


@dataclass
class SessionMetadata:
    """Session metadata model"""

    conversation_id: str
    status: SessionStatus
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message_at: Optional[datetime] = None
    working_directory: str = "."
    first_user_message: Optional[str] = None  # First user message for preview
    tags: List[str] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []
        if self.metadata is None:
            self.metadata = {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "conversation_id": self.conversation_id,
            "status": (
                self.status.value
                if isinstance(self.status, SessionStatus)
                else self.status
            ),
            "created_at": (
                self.created_at.isoformat()
                if isinstance(self.created_at, datetime)
                else self.created_at
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if isinstance(self.updated_at, datetime)
                else self.updated_at
            ),
            "message_count": self.message_count,
            "last_message_at": (
                self.last_message_at.isoformat()
                if self.last_message_at and isinstance(self.last_message_at, datetime)
                else self.last_message_at
            ),
            "working_directory": self.working_directory,
            "first_user_message": self.first_user_message,
            "tags": self.tags,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SessionMetadata":
        """Create from dictionary"""
        # Parse datetime fields
        if isinstance(data.get("created_at"), str):
            data["created_at"] = datetime.fromisoformat(data["created_at"])
        if isinstance(data.get("updated_at"), str):
            data["updated_at"] = datetime.fromisoformat(data["updated_at"])
        if isinstance(data.get("last_message_at"), str):
            data["last_message_at"] = datetime.fromisoformat(data["last_message_at"])

        # Parse status
        if isinstance(data.get("status"), str):
            data["status"] = SessionStatus(data["status"])

        return cls(**data)


class SessionManager:
    """Manages conversation sessions with SQLite persistence"""

    def __init__(self, db_path: str = None):
        """
        Initialize session manager

        Args:
            db_path: Path to SQLite database file. If None, uses default location.
        """
        if db_path is None:
            # Use default location in user's home directory
            home_dir = Path.home()
            config_dir = home_dir / ".openbrowser"
            config_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(config_dir / "sessions.db")

        self.db_path = db_path
        self._init_database()
        logger.info(f"SessionManager initialized with database: {db_path}")

    def _init_database(self):
        """Initialize SQLite database schema and run migrations"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Create sessions table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    conversation_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'idle',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    message_count INTEGER DEFAULT 0,
                    last_message_at TEXT,
                    working_directory TEXT DEFAULT '.',
                    first_user_message TEXT,
                    tags TEXT DEFAULT '[]',
                    metadata TEXT DEFAULT '{}'
                )
            """
            )

            # Run migrations to add missing columns
            self._migrate_database(cursor)

            # Create user_messages table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS user_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    message_text TEXT NOT NULL,
                    message_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES sessions(conversation_id),
                    UNIQUE(conversation_id, message_index)
                )
            """
            )

            # Create session_events table for SSE event history
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS session_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    event_data TEXT NOT NULL,
                    event_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES sessions(conversation_id)
                )
            """
            )

            # Create indexes for faster queries
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_user_messages_conversation 
                ON user_messages(conversation_id)
            """
            )

            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_session_events_conversation 
                ON session_events(conversation_id)
            """
            )

            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_session_events_index 
                ON session_events(conversation_id, event_index)
            """
            )

            conn.commit()
            conn.close()
            logger.debug("Database schema initialized with event history support")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise

    def _migrate_database(self, cursor):
        """Run database migrations to add missing columns"""
        try:
            # Check if first_user_message column exists
            cursor.execute("PRAGMA table_info(sessions)")
            columns = [row[1] for row in cursor.fetchall()]

            if "first_user_message" not in columns:
                logger.info("Adding missing column: first_user_message")
                cursor.execute(
                    """
                    ALTER TABLE sessions ADD COLUMN first_user_message TEXT
                """
                )
                logger.info("Migration completed: first_user_message column added")

        except Exception as e:
            logger.error(f"Migration failed: {e}")
            raise

    def create_session(
        self,
        conversation_id: str = None,
        working_directory: str = ".",
        tags: List[str] = None,
        metadata: Dict[str, Any] = None,
    ) -> SessionMetadata:
        """
        Create a new session

        Args:
            conversation_id: Optional conversation ID. If None, generates a new UUID.
            working_directory: Working directory for the session
            tags: List of tags for the session
            metadata: Additional metadata

        Returns:
            SessionMetadata for the created session
        """
        if conversation_id is None:
            conversation_id = str(uuid.uuid4())

        now = datetime.now()
        session = SessionMetadata(
            conversation_id=conversation_id,
            status=SessionStatus.IDLE,
            created_at=now,
            updated_at=now,
            working_directory=working_directory,
            tags=tags or [],
            metadata=metadata or {},
        )

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                INSERT INTO sessions 
                (conversation_id, status, created_at, updated_at, working_directory, tags, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    session.conversation_id,
                    session.status.value,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                    session.working_directory,
                    json.dumps(session.tags),
                    json.dumps(session.metadata),
                ),
            )

            conn.commit()
            conn.close()

            logger.info(f"Created session: {conversation_id}")
            return session
        except Exception as e:
            logger.error(f"Failed to create session: {e}")
            raise

    def update_first_user_message(self, conversation_id: str, message: str) -> bool:
        """Update first user message for session preview"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Only update if not already set
            cursor.execute(
                """
                UPDATE sessions
                SET first_user_message = ?
                WHERE conversation_id = ? AND first_user_message IS NULL
            """,
                (message[:100], conversation_id),
            )  # Store first 100 chars

            success = cursor.rowcount > 0
            conn.commit()
            conn.close()

            return success
        except Exception as e:
            logger.error(f"Failed to update first user message: {e}")
            return False

    def save_user_message(
        self, conversation_id: str, message_text: str, message_index: int = None
    ) -> bool:
        """Save user message for history"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            now = datetime.now().isoformat()

            # If index not provided, get next index
            if message_index is None:
                cursor.execute(
                    """
                    SELECT COALESCE(MAX(message_index), -1) + 1
                    FROM user_messages
                    WHERE conversation_id = ?
                """,
                    (conversation_id,),
                )
                message_index = cursor.fetchone()[0]

            cursor.execute(
                """
                INSERT INTO user_messages (conversation_id, message_text, message_index, created_at)
                VALUES (?, ?, ?, ?)
            """,
                (conversation_id, message_text, message_index, now),
            )

            # Commit the INSERT first to avoid database lock
            conn.commit()

            # Update first user message if this is the first message
            if message_index == 0:
                conn.close()  # Close connection before calling update_first_user_message
                self.update_first_user_message(conversation_id, message_text)
            else:
                conn.close()

            logger.debug(f"Saved user message {message_index} for {conversation_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to save user message: {e}")
            return False

    def save_event(
        self,
        conversation_id: str,
        event_type: str,
        event_data: Dict[str, Any],
        event_index: int = None,
    ) -> bool:
        """Save SSE event for history"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            now = datetime.now().isoformat()

            # If index not provided, get next index
            if event_index is None:
                cursor.execute(
                    """
                    SELECT COALESCE(MAX(event_index), -1) + 1
                    FROM session_events
                    WHERE conversation_id = ?
                """,
                    (conversation_id,),
                )
                event_index = cursor.fetchone()[0]

            # Strip image data from event_data to save space
            event_data_stripped = self._strip_image_data(event_data)

            cursor.execute(
                """
                INSERT INTO session_events (conversation_id, event_type, event_data, event_index, created_at)
                VALUES (?, ?, ?, ?, ?)
            """,
                (
                    conversation_id,
                    event_type,
                    json.dumps(event_data_stripped),
                    event_index,
                    now,
                ),
            )

            conn.commit()
            conn.close()

            logger.debug(
                f"Saved event {event_index} ({event_type}) for {conversation_id}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to save event: {e}")
            return False

    def _strip_image_data(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """Strip image data from event to save space in history"""
        stripped = event_data.copy()

        # Remove common image fields
        if "image" in stripped:
            del stripped["image"]
        if "screenshot_data_url" in stripped:
            del stripped["screenshot_data_url"]
        if "image_url" in stripped:
            del stripped["image_url"]

        # Also strip from nested data structures
        if "data" in stripped and isinstance(stripped["data"], dict):
            stripped["data"] = self._strip_image_data(stripped["data"])

        return stripped

    def get_session_events(
        self, conversation_id: str, include_images: bool = False, limit: int = None
    ) -> List[Dict[str, Any]]:
        """
        Get event history for a session

        Args:
            conversation_id: Conversation ID
            include_images: Whether to include image data (always False for history)
            limit: Maximum number of events to return

        Returns:
            List of events
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            if limit:
                cursor.execute(
                    """
                    SELECT event_type, event_data, event_index, created_at
                    FROM session_events
                    WHERE conversation_id = ?
                    ORDER BY created_at ASC
                    LIMIT ?
                """,
                    (conversation_id, limit),
                )
            else:
                cursor.execute(
                    """
                    SELECT event_type, event_data, event_index, created_at
                    FROM session_events
                    WHERE conversation_id = ?
                    ORDER BY created_at ASC
                """,
                    (conversation_id,),
                )

            rows = cursor.fetchall()
            conn.close()

            events = []
            for row in rows:
                events.append(
                    {
                        "event_type": row[0],
                        "event_data": json.loads(row[1]),
                        "event_index": row[2],
                        "created_at": row[3],
                    }
                )

            logger.debug(f"Retrieved {len(events)} events for {conversation_id}")
            return events
        except Exception as e:
            logger.error(f"Failed to get session events: {e}")
            return []

    def get_user_messages(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Get user message history for a session"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT message_text, message_index, created_at
                FROM user_messages
                WHERE conversation_id = ?
                ORDER BY message_index ASC
            """,
                (conversation_id,),
            )

            rows = cursor.fetchall()
            conn.close()

            messages = []
            for row in rows:
                messages.append(
                    {
                        "message_text": row[0],
                        "message_index": row[1],
                        "created_at": row[2],
                    }
                )

            return messages
        except Exception as e:
            logger.error(f"Failed to get user messages: {e}")
            return []

    def get_session(self, conversation_id: str) -> Optional[SessionMetadata]:
        """
        Get session by conversation ID

        Args:
            conversation_id: Conversation ID

        Returns:
            SessionMetadata if found, None otherwise
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT conversation_id, status, created_at, updated_at, 
                       message_count, last_message_at, working_directory, 
                       first_user_message, tags, metadata
                FROM sessions
                WHERE conversation_id = ?
            """,
                (conversation_id,),
            )

            row = cursor.fetchone()
            conn.close()

            if row is None:
                return None

            return SessionMetadata(
                conversation_id=row[0],
                status=SessionStatus(row[1]),
                created_at=datetime.fromisoformat(row[2]),
                updated_at=datetime.fromisoformat(row[3]),
                message_count=row[4],
                last_message_at=datetime.fromisoformat(row[5]) if row[5] else None,
                working_directory=row[6],
                first_user_message=row[7],
                tags=json.loads(row[8]),
                metadata=json.loads(row[9]),
            )
        except Exception as e:
            logger.error(f"Failed to get session {conversation_id}: {e}")
            return None

    def update_session_status(
        self,
        conversation_id: str,
        status: SessionStatus,
        increment_message_count: bool = False,
    ) -> bool:
        """
        Update session status

        Args:
            conversation_id: Conversation ID
            status: New status
            increment_message_count: Whether to increment message count

        Returns:
            True if successful, False otherwise
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            now = datetime.now().isoformat()

            if increment_message_count:
                cursor.execute(
                    """
                    UPDATE sessions
                    SET status = ?, updated_at = ?, message_count = message_count + 1,
                        last_message_at = ?
                    WHERE conversation_id = ?
                """,
                    (status.value, now, now, conversation_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE sessions
                    SET status = ?, updated_at = ?
                    WHERE conversation_id = ?
                """,
                    (status.value, now, conversation_id),
                )

            success = cursor.rowcount > 0
            conn.commit()
            conn.close()

            if success:
                logger.debug(f"Updated session {conversation_id} status to {status}")
            else:
                logger.warning(f"Session {conversation_id} not found for status update")

            return success
        except Exception as e:
            logger.error(f"Failed to update session {conversation_id}: {e}")
            return False

    def update_session_metadata(
        self, conversation_id: str, metadata_updates: Dict[str, Any]
    ) -> bool:
        """Merge metadata updates into an existing session."""
        try:
            session = self.get_session(conversation_id)
            if session is None:
                logger.warning(
                    f"Session {conversation_id} not found for metadata update"
                )
                return False

            merged_metadata = session.metadata.copy()
            merged_metadata.update(metadata_updates)

            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                UPDATE sessions
                SET metadata = ?, updated_at = ?
                WHERE conversation_id = ?
                """,
                (
                    json.dumps(merged_metadata),
                    datetime.now().isoformat(),
                    conversation_id,
                ),
            )

            success = cursor.rowcount > 0
            conn.commit()
            conn.close()
            return success
        except Exception as e:
            logger.error(
                f"Failed to update session metadata for {conversation_id}: {e}"
            )
            return False

    def list_sessions(
        self, status: SessionStatus = None, limit: int = 100, offset: int = 0
    ) -> List[SessionMetadata]:
        """
        List sessions with optional filtering

        Args:
            status: Optional status filter
            limit: Maximum number of sessions to return
            offset: Offset for pagination

        Returns:
            List of SessionMetadata
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            if status:
                cursor.execute(
                    """
                    SELECT conversation_id, status, created_at, updated_at, 
                           message_count, last_message_at, working_directory, 
                           first_user_message, tags, metadata
                    FROM sessions
                    WHERE status = ?
                    ORDER BY updated_at DESC
                    LIMIT ? OFFSET ?
                """,
                    (status.value, limit, offset),
                )
            else:
                cursor.execute(
                    """
                    SELECT conversation_id, status, created_at, updated_at, 
                           message_count, last_message_at, working_directory, 
                           first_user_message, tags, metadata
                    FROM sessions
                    ORDER BY updated_at DESC
                    LIMIT ? OFFSET ?
                """,
                    (limit, offset),
                )

            rows = cursor.fetchall()
            conn.close()

            sessions = []
            for row in rows:
                sessions.append(
                    SessionMetadata(
                        conversation_id=row[0],
                        status=SessionStatus(row[1]),
                        created_at=datetime.fromisoformat(row[2]),
                        updated_at=datetime.fromisoformat(row[3]),
                        message_count=row[4],
                        last_message_at=(
                            datetime.fromisoformat(row[5]) if row[5] else None
                        ),
                        working_directory=row[6],
                        first_user_message=row[7],
                        tags=json.loads(row[8]),
                        metadata=json.loads(row[9]),
                    )
                )

            return sessions
        except Exception as e:
            logger.error(f"Failed to list sessions: {e}")
            return []

    def delete_session(self, conversation_id: str) -> bool:
        """
        Delete a session and all associated data

        Args:
            conversation_id: Conversation ID

        Returns:
            True if successful, False otherwise
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Delete associated events
            cursor.execute(
                "DELETE FROM session_events WHERE conversation_id = ?",
                (conversation_id,),
            )
            events_deleted = cursor.rowcount

            # Delete associated messages
            cursor.execute(
                "DELETE FROM user_messages WHERE conversation_id = ?",
                (conversation_id,),
            )
            messages_deleted = cursor.rowcount

            # Delete session
            cursor.execute(
                "DELETE FROM sessions WHERE conversation_id = ?", (conversation_id,)
            )
            session_deleted = cursor.rowcount > 0

            conn.commit()
            conn.close()

            if session_deleted:
                logger.info(
                    f"Deleted session {conversation_id}: {events_deleted} events, {messages_deleted} messages"
                )
            else:
                logger.warning(f"Session {conversation_id} not found for deletion")

            return session_deleted
        except Exception as e:
            logger.error(f"Failed to delete session {conversation_id}: {e}")
            return False

    def get_session_count(self, status: SessionStatus = None) -> int:
        """
        Get total session count with optional status filter

        Args:
            status: Optional status filter

        Returns:
            Session count
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            if status:
                cursor.execute(
                    "SELECT COUNT(*) FROM sessions WHERE status = ?", (status.value,)
                )
            else:
                cursor.execute("SELECT COUNT(*) FROM sessions")

            count = cursor.fetchone()[0]
            conn.close()

            return count
        except Exception as e:
            logger.error(f"Failed to get session count: {e}")
            return 0


# Global session manager instance
session_manager = SessionManager()
