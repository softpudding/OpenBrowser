"""
BrowserExecutor - Two-Phase Commit (2PC) state machine for browser command execution.

This module implements a 2PC protocol for coordinating browser commands between
the main process and conversation processes in the multi-process architecture.

2PC Flow:
1. IDLE → PREPARING: prepare() called
2. PREPARING → PREPARED: Prepare acknowledged
3. PREPARED → COMMITTING: commit() called
4. COMMITTING → COMMITTED: Commit acknowledged
   OR
3. PREPARED → ABORTING: abort() called
4. ABORTING → ABORTED: Abort acknowledged
"""

import logging
from dataclasses import dataclass
from enum import Enum
from multiprocessing import Queue
from typing import Any, Optional, cast

from server.core.ipc_types import BrowserCommandMessage, BrowserResponseMessage

logger = logging.getLogger(__name__)


class ExecutorState(Enum):
    """States for the 2PC state machine."""

    IDLE = "idle"
    PREPARING = "preparing"
    PREPARED = "prepared"
    COMMITTING = "committing"
    COMMITTED = "committed"
    ABORTING = "aborting"
    ABORTED = "aborted"


@dataclass
class PrepareRequest:
    """Request to prepare a browser command."""

    command: dict[str, Any]
    command_id: Optional[str] = None


@dataclass
class PrepareResponse:
    """Response to a prepare request."""

    success: bool
    error: Optional[str] = None


@dataclass
class CommitRequest:
    """Request to commit a prepared command."""

    pass


@dataclass
class CommitResponse:
    """Response to a commit request."""

    success: bool
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class AbortRequest:
    """Request to abort a prepared command."""

    reason: str


@dataclass
class AbortResponse:
    """Response to an abort request."""

    success: bool
    error: Optional[str] = None


# Default timeout in seconds for 2PC operations
DEFAULT_TIMEOUT = 30.0


class BrowserExecutor:
    """Two-Phase Commit state machine for browser command execution.

    This executor coordinates browser commands using a 2PC protocol:
    - Phase 1 (Prepare): Send command to browser process, wait for acknowledgment
    - Phase 2 (Commit/Abort): Either commit the command or abort it

    The executor uses multiprocessing.Queue for inter-process communication,
    enabling safe coordination between the main process and conversation processes.

    Attributes:
        conversation_id: UUID identifying the conversation session
        browser_id: UUID identifying the browser instance
        command_queue: Queue for sending commands to browser process
        response_queue: Queue for receiving responses from browser process
        state: Current state of the 2PC state machine
        timeout: Timeout in seconds for prepare/commit/abort operations
    """

    def __init__(
        self,
        conv_id: str,
        browser_id: str,
        command_queue: Queue,
        response_queue: Queue,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        """Initialize the BrowserExecutor.

        Args:
            conv_id: UUID identifying the conversation session
            browser_id: UUID identifying the browser instance
            command_queue: Queue for sending commands to browser process
            response_queue: Queue for receiving responses from browser process
            timeout: Timeout in seconds for prepare/commit/abort operations
        """
        self.conversation_id = conv_id
        self.browser_id = browser_id
        self.command_queue = command_queue
        self.response_queue = response_queue
        self.timeout = timeout
        self._state = ExecutorState.IDLE
        self._pending_command: Optional[dict[str, Any]] = None
        self._pending_command_id: Optional[str] = None

    def get_state(self) -> str:
        """Return the current state of the 2PC state machine.

        Returns:
            Current state as a string (e.g., "idle", "preparing", "prepared")
        """
        return self._state.value

    def prepare(
        self, command: dict[str, Any], command_id: Optional[str] = None
    ) -> bool:
        """Send a prepare request and wait for acknowledgment.

        Transitions: IDLE → PREPARING → PREPARED (on success)
                    IDLE → PREPARING → ABORTED (on failure/timeout)

        Args:
            command: Command dictionary to prepare for execution
            command_id: Optional unique identifier for tracking

        Returns:
            True if prepare was acknowledged, False otherwise

        Raises:
            RuntimeError: If not in IDLE state
        """
        if self._state != ExecutorState.IDLE:
            raise RuntimeError(
                f"Cannot prepare: executor is in {self._state.value} state, "
                f"expected IDLE"
            )

        # Transition to PREPARING
        self._state = ExecutorState.PREPARING
        self._pending_command = command
        self._pending_command_id = command_id

        logger.debug(
            f"BrowserExecutor[{self.conversation_id}]: Preparing command "
            f"(id={command_id})"
        )

        try:
            # Send prepare request via command queue
            prepare_msg = BrowserCommandMessage(
                conversation_id=self.conversation_id,
                browser_id=self.browser_id,
                command=command,
                command_id=command_id,
            )
            self.command_queue.put(prepare_msg.to_dict())

            # Wait for acknowledgment with timeout
            response_data = self.response_queue.get(timeout=self.timeout)
            response = cast(
                BrowserResponseMessage, BrowserResponseMessage.from_dict(response_data)
            )

            if response.success:
                # Transition to PREPARED
                self._state = ExecutorState.PREPARED
                logger.debug(
                    f"BrowserExecutor[{self.conversation_id}]: Prepare acknowledged"
                )
                return True
            else:
                # Transition to ABORTED
                self._state = ExecutorState.ABORTED
                error_msg = response.error or "Unknown error during prepare"
                logger.warning(
                    f"BrowserExecutor[{self.conversation_id}]: Prepare failed: "
                    f"{error_msg}"
                )
                return False

        except Exception as e:
            # Transition to ABORTED on timeout or error
            self._state = ExecutorState.ABORTED
            logger.error(f"BrowserExecutor[{self.conversation_id}]: Prepare error: {e}")
            return False

    def commit(self) -> bool:
        """Send a commit request and wait for completion.

        Transitions: PREPARED → COMMITTING → COMMITTED (on success)
                    PREPARED → COMMITTING → ABORTED (on failure/timeout)

        Returns:
            True if commit was successful, False otherwise

        Raises:
            RuntimeError: If not in PREPARED state
        """
        if self._state != ExecutorState.PREPARED:
            raise RuntimeError(
                f"Cannot commit: executor is in {self._state.value} state, "
                f"expected PREPARED"
            )

        # Transition to COMMITTING
        self._state = ExecutorState.COMMITTING

        logger.debug(
            f"BrowserExecutor[{self.conversation_id}]: Committing command "
            f"(id={self._pending_command_id})"
        )

        try:
            # Send commit request via command queue
            commit_msg = BrowserCommandMessage(
                conversation_id=self.conversation_id,
                browser_id=self.browser_id,
                command={"type": "commit"},
                command_id=self._pending_command_id,
            )
            self.command_queue.put(commit_msg.to_dict())

            # Wait for completion with timeout
            response_data = self.response_queue.get(timeout=self.timeout)
            response = cast(
                BrowserResponseMessage, BrowserResponseMessage.from_dict(response_data)
            )

            if response.success:
                # Transition to COMMITTED
                self._state = ExecutorState.COMMITTED
                logger.debug(
                    f"BrowserExecutor[{self.conversation_id}]: Commit successful"
                )
                return True
            else:
                # Transition to ABORTED
                self._state = ExecutorState.ABORTED
                error_msg = response.error or "Unknown error during commit"
                logger.warning(
                    f"BrowserExecutor[{self.conversation_id}]: Commit failed: "
                    f"{error_msg}"
                )
                return False

        except Exception as e:
            # Transition to ABORTED on timeout or error
            self._state = ExecutorState.ABORTED
            logger.error(f"BrowserExecutor[{self.conversation_id}]: Commit error: {e}")
            return False

    def abort(self, reason: str) -> bool:
        """Send an abort request and wait for acknowledgment.

        Transitions: PREPARED → ABORTING → ABORTED (on success)
                    PREPARED → ABORTING → ABORTED (on failure/timeout)

        Args:
            reason: Reason for aborting the command

        Returns:
            True if abort was acknowledged, False otherwise

        Raises:
            RuntimeError: If not in PREPARED state
        """
        if self._state != ExecutorState.PREPARED:
            raise RuntimeError(
                f"Cannot abort: executor is in {self._state.value} state, "
                f"expected PREPARED"
            )

        # Transition to ABORTING
        self._state = ExecutorState.ABORTING

        logger.debug(
            f"BrowserExecutor[{self.conversation_id}]: Aborting command "
            f"(id={self._pending_command_id}): {reason}"
        )

        try:
            # Send abort request via command queue
            abort_msg = BrowserCommandMessage(
                conversation_id=self.conversation_id,
                browser_id=self.browser_id,
                command={"type": "abort", "reason": reason},
                command_id=self._pending_command_id,
            )
            self.command_queue.put(abort_msg.to_dict())

            # Wait for acknowledgment with timeout
            response_data = self.response_queue.get(timeout=self.timeout)
            response = cast(
                BrowserResponseMessage, BrowserResponseMessage.from_dict(response_data)
            )

            # Always transition to ABORTED after abort attempt
            self._state = ExecutorState.ABORTED

            if response.success:
                logger.debug(
                    f"BrowserExecutor[{self.conversation_id}]: Abort acknowledged"
                )
                return True
            else:
                error_msg = response.error or "Unknown error during abort"
                logger.warning(
                    f"BrowserExecutor[{self.conversation_id}]: Abort failed: "
                    f"{error_msg}"
                )
                return False

        except Exception as e:
            # Already in ABORTED state
            logger.error(f"BrowserExecutor[{self.conversation_id}]: Abort error: {e}")
            return False

    def reset(self) -> None:
        """Reset the executor to IDLE state.

        Clears any pending command and resets the state machine.
        Can be called from any state.
        """
        logger.debug(
            f"BrowserExecutor[{self.conversation_id}]: Resetting from "
            f"{self._state.value} to IDLE"
        )
        self._state = ExecutorState.IDLE
        self._pending_command = None
        self._pending_command_id = None

    def get_pending_command(self) -> Optional[dict[str, Any]]:
        """Get the pending command if any.

        Returns:
            The pending command dictionary, or None if no command is pending
        """
        return self._pending_command

    def get_pending_command_id(self) -> Optional[str]:
        """Get the pending command ID if any.

        Returns:
            The pending command ID, or None if no command is pending
        """
        return self._pending_command_id
