"""Process Manager for multi-process browser automation.

This module provides process lifecycle management for per-conversation
browser process isolation in the multi-process architecture.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from multiprocessing import Process, Queue
from typing import Optional, Any

from server.core.ipc_types import (
    BrowserCommandMessage,
    BrowserResponseMessage,
    ProcessShutdownMessage,
    serialize_message,
)

logger = logging.getLogger(__name__)

# Default memory limit: 4GB per process
DEFAULT_MEMORY_LIMIT_MB = 4096

# Try to import psutil for memory monitoring
try:
    import psutil

    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False


def _placeholder_worker(
    conv_id: str,
    browser_id: str,
    command_queue: "Queue[Any]",
    response_queue: "Queue[Any]",
) -> None:
    """Placeholder worker function for testing process lifecycle.

    This is a minimal worker that reads from command_queue and responds
    to shutdown messages. It does NOT perform actual browser automation.

    Args:
        conv_id: Conversation ID for logging
        browser_id: Browser ID for logging
        command_queue: Queue to receive commands from main process
        response_queue: Queue to send responses to main process
    """
    logger.info(f"Worker started for conversation {conv_id}, browser {browser_id}")

    while True:
        try:
            message = command_queue.get()

            if isinstance(message, dict) and message.get("reason") is not None:
                logger.info(f"Worker {conv_id} received shutdown message")
                break

            logger.debug(f"Worker {conv_id} received message: {message}")

        except Exception as e:
            logger.error(f"Worker {conv_id} error: {e}")
            break

    logger.info(f"Worker {conv_id} exiting")


def _conversation_worker(
    conv_id: str,
    browser_id: str,
    command_queue: "Queue[Any]",
    response_queue: "Queue[Any]",
    llm_config: dict[str, Any],
    working_directory: str = ".",
) -> None:
    """Real worker function for conversation processes.

    This worker initializes a BrowserExecutorBundle and processes
    browser commands from the command queue until shutdown.

    Args:
        conv_id: Conversation ID for the worker
        browser_id: Browser ID for the worker
        command_queue: Queue to receive commands from main process
        response_queue: Queue to send responses to main process
        llm_config: LLM configuration dictionary with model, api_key, base_url
        working_directory: Working directory for the conversation
    """
    logger.info(f"Conversation worker started for {conv_id}, browser {browser_id}")

    bundle = None

    try:
        from server.core.browser_executor_bundle import BrowserExecutorBundle

        bundle = BrowserExecutorBundle(
            conv_id=conv_id,
            browser_id=browser_id,
            llm_config=llm_config,
            working_directory=working_directory,
        )

        init_success = asyncio.run(bundle.initialize())

        if not init_success:
            logger.error(f"Worker {conv_id}: Bundle initialization failed")
            return

        logger.info(f"Worker {conv_id}: Bundle initialized successfully")

        while True:
            try:
                message = command_queue.get()

                if isinstance(message, dict):
                    if "reason" in message and message.get("reason") is not None:
                        logger.info(f"Worker {conv_id}: Received shutdown message")
                        break

                if isinstance(message, dict) and "command" in message:
                    result = asyncio.run(bundle.execute_command(message["command"]))

                    response = BrowserResponseMessage(
                        conversation_id=conv_id,
                        browser_id=browser_id,
                        success=result.get("success", False),
                        result=result.get("data"),
                        error=result.get("error"),
                        command_id=message.get("command_id"),
                    )
                    response_queue.put(response.to_dict())
                else:
                    response = BrowserResponseMessage(
                        conversation_id=conv_id,
                        browser_id=browser_id,
                        success=False,
                        error=f"Unknown message format: {type(message)}",
                    )
                    response_queue.put(response.to_dict())

            except Exception as e:
                logger.error(f"Worker {conv_id}: Error processing message: {e}")
                response = BrowserResponseMessage(
                    conversation_id=conv_id,
                    browser_id=browser_id,
                    success=False,
                    error=str(e),
                )
                response_queue.put(response.to_dict())

    except Exception as e:
        logger.error(f"Worker {conv_id}: Fatal error: {e}")

    finally:
        if bundle is not None:
            try:
                asyncio.run(bundle.shutdown())
                logger.info(f"Worker {conv_id}: Bundle shutdown complete")
            except Exception as e:
                logger.warning(f"Worker {conv_id}: Error during shutdown: {e}")

        logger.info(f"Worker {conv_id}: Exiting")


@dataclass
class ProcessInfo:
    """Information about a managed browser process.

    Attributes:
        conversation_id: Unique identifier for the conversation
        browser_id: UUID of the browser instance
        process: The multiprocessing.Process instance (None until spawned)
        status: Current process status (starting, running, stopping, stopped, crashed)
        started_at: Unix timestamp when the process was started
        command_queue: Queue for sending commands to the process
        response_queue: Queue for receiving responses from the process
        memory_limit_mb: Memory limit in MB (default: 4GB)
        crash_history: List of crash records with timestamps and reasons
        restart_count: Number of times this process has been restarted
    """

    conversation_id: str
    browser_id: str
    process: Optional[Process] = None
    status: str = "starting"
    started_at: float = field(default_factory=time.time)
    command_queue: Optional[Queue[Any]] = None
    response_queue: Optional[Queue[Any]] = None
    memory_limit_mb: int = DEFAULT_MEMORY_LIMIT_MB
    crash_history: list[dict[str, Any]] = field(default_factory=list)
    restart_count: int = 0


class ProcessManager:
    """Manages browser process lifecycle for multi-process architecture.

    This class provides process spawning, tracking, and shutdown capabilities
    for per-conversation browser isolation.

    Example:
        >>> manager = ProcessManager()
        >>> manager.spawn_conversation_process("conv-123", "browser-uuid")
        >>> process_info = manager.get_process("conv-123")
        >>> manager.shutdown_process("conv-123")
    """

    def __init__(self) -> None:
        """Initialize the process manager with empty process registry."""
        self._processes: dict[str, ProcessInfo] = {}
        self._max_restarts: dict[str, int] = {}  # Default: 3

    def spawn_conversation_process(self, conv_id: str, browser_id: str) -> None:
        """Spawn a new browser process for a conversation.

        Creates command and response queues, spawns a worker process,
        and registers it with status "running".

        Args:
            conv_id: Unique conversation identifier
            browser_id: UUID of the browser instance

        Raises:
            RuntimeError: If a process already exists for this conversation
        """
        if conv_id in self._processes:
            raise RuntimeError(f"Process already exists for conversation {conv_id}")

        command_queue: Queue[Any] = Queue()
        response_queue: Queue[Any] = Queue()

        process = Process(
            target=_placeholder_worker,
            args=(conv_id, browser_id, command_queue, response_queue),
            name=f"browser-{conv_id[:8]}",
        )
        process.start()

        process_info = ProcessInfo(
            conversation_id=conv_id,
            browser_id=browser_id,
            process=process,
            status="running",
            command_queue=command_queue,
            response_queue=response_queue,
        )
        self._processes[conv_id] = process_info

        logger.info(f"Spawned process for conversation {conv_id}, pid={process.pid}")

    def spawn_with_config(
        self,
        conv_id: str,
        browser_id: str,
        llm_config: dict[str, Any],
        working_directory: str = ".",
    ) -> None:
        """Spawn a new browser process with LLM configuration.

        This method spawns a real conversation worker process with the
        BrowserExecutorBundle, enabling full browser automation.

        Args:
            conv_id: Unique conversation identifier
            browser_id: UUID of the browser instance
            llm_config: LLM configuration dictionary with:
                - model: Model name (e.g., "qwen3.5-plus")
                - api_key: API key for the model
                - base_url: Optional base URL for the API
            working_directory: Working directory for the conversation

        Raises:
            RuntimeError: If a process already exists for this conversation
        """
        if conv_id in self._processes:
            raise RuntimeError(f"Process already exists for conversation {conv_id}")

        command_queue: Queue[Any] = Queue()
        response_queue: Queue[Any] = Queue()

        process = Process(
            target=_conversation_worker,
            args=(
                conv_id,
                browser_id,
                command_queue,
                response_queue,
                llm_config,
                working_directory,
            ),
            name=f"browser-{conv_id[:8]}",
        )
        process.start()

        process_info = ProcessInfo(
            conversation_id=conv_id,
            browser_id=browser_id,
            process=process,
            status="running",
            command_queue=command_queue,
            response_queue=response_queue,
        )
        self._processes[conv_id] = process_info

        logger.info(
            f"Spawned process with config for conversation {conv_id}, "
            f"pid={process.pid}, model={llm_config.get('model', 'unknown')}"
        )

    def get_process(self, conv_id: str) -> Optional[Process]:
        """Get the Process object for a conversation.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            Process object if found and running, None otherwise
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            return None
        return process_info.process

    def get_process_info(self, conv_id: str) -> Optional[ProcessInfo]:
        """Get the ProcessInfo for a conversation.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            ProcessInfo if found, None otherwise
        """
        return self._processes.get(conv_id)

    def get_conversation_by_browser(self, browser_id: str) -> Optional[str]:
        """Find conversation_id by browser_id.

        Args:
            browser_id: UUID of the browser instance

        Returns:
            conversation_id if found, None otherwise
        """
        for conv_id, info in self._processes.items():
            if info.browser_id == browser_id:
                return conv_id
        return None

    def shutdown_process(self, conv_id: str, force: bool = False) -> None:
        """Shutdown a browser process for a conversation.

        For graceful shutdown (force=False), sends a shutdown message via
        the command queue and waits for the process to exit. If the process
        doesn't exit within the timeout, it will be force terminated.

        For force shutdown (force=True), immediately terminates the process.

        Args:
            conv_id: Unique conversation identifier
            force: If True, force terminate without graceful shutdown

        Raises:
            KeyError: If no process exists for this conversation
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            raise KeyError(f"No process found for conversation {conv_id}")

        process = process_info.process
        if process is None:
            self._unregister_process(conv_id)
            return

        process_info.status = "stopping"

        if not force and process_info.command_queue is not None:
            shutdown_msg = ProcessShutdownMessage(
                conversation_id=conv_id,
                browser_id=process_info.browser_id,
                reason="user_request",
                force=False,
            )
            try:
                process_info.command_queue.put(shutdown_msg.to_dict())
                process.join(timeout=5.0)
            except Exception as e:
                logger.warning(f"Error during graceful shutdown for {conv_id}: {e}")

        if process.is_alive():
            logger.warning(f"Force terminating process for {conv_id}")
            process.terminate()
            process.join(timeout=2.0)

            if process.is_alive():
                logger.error(f"Process {conv_id} did not terminate, killing")
                process.kill()
                process.join(timeout=1.0)

        process_info.status = "stopped"
        self._unregister_process(conv_id)
        logger.info(f"Shutdown complete for conversation {conv_id}")

    def list_processes(self) -> list[str]:
        """List all tracked conversation IDs.

        Returns:
            List of conversation IDs with registered processes
        """
        return list(self._processes.keys())

    def get_process_count(self) -> int:
        """Get the total number of tracked processes.

        Returns:
            Number of processes in the registry
        """
        return len(self._processes)

    def is_process_alive(self, conv_id: str) -> bool:
        """Check if a process is alive.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if process exists and is alive, False otherwise
        """
        process_info = self._processes.get(conv_id)
        if process_info is None or process_info.process is None:
            return False
        return process_info.process.is_alive()

    def get_process_status(self, conv_id: str) -> Optional[str]:
        """Get the status of a process.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            Status string if process exists, None otherwise
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            return None
        return process_info.status

    def _register_process(self, conv_id: str, browser_id: str) -> ProcessInfo:
        """Register a new process entry (internal use).

        Args:
            conv_id: Unique conversation identifier
            browser_id: UUID of the browser instance

        Returns:
            The newly created ProcessInfo
        """
        process_info = ProcessInfo(
            conversation_id=conv_id,
            browser_id=browser_id,
            status="starting",
        )
        self._processes[conv_id] = process_info
        return process_info

    def _unregister_process(self, conv_id: str) -> bool:
        """Unregister a process entry (internal use).

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if process was unregistered, False if not found
        """
        if conv_id in self._processes:
            del self._processes[conv_id]
            return True
        return False

    # ==================== Crash Recovery Methods ====================

    def detect_crashes(self) -> list[str]:
        """Detect processes that have crashed.

        A process is considered crashed if it is registered with status "running"
        but the underlying Process object is no longer alive.

        Returns:
            List of conversation IDs for crashed processes
        """
        crashed = []
        for conv_id, info in self._processes.items():
            if (
                info.process is not None
                and not info.process.is_alive()
                and info.status == "running"
            ):
                crashed.append(conv_id)
                info.status = "crashed"
                crash_record = {
                    "timestamp": time.time(),
                    "exit_code": info.process.exitcode,
                    "restart_count": info.restart_count,
                }
                info.crash_history.append(crash_record)
                logger.warning(
                    f"Detected crash for conversation {conv_id}: "
                    f"exit_code={info.process.exitcode}"
                )
        return crashed

    def recover_process(self, conv_id: str) -> bool:
        """Restart a crashed process.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if recovery was successful, False otherwise
        """
        info = self._processes.get(conv_id)
        if info is None or info.status != "crashed":
            logger.warning(
                f"Cannot recover process {conv_id}: status={info.status if info else 'not found'}"
            )
            return False

        max_restarts = self._max_restarts.get(conv_id, 3)
        if info.restart_count >= max_restarts:
            logger.error(
                f"Cannot recover process {conv_id}: restart limit reached "
                f"({info.restart_count}/{max_restarts})"
            )
            return False

        old_process = info.process
        if old_process is not None:
            try:
                if old_process.is_alive():
                    old_process.terminate()
                    old_process.join(timeout=1.0)
            except Exception as e:
                logger.warning(f"Error cleaning up old process for {conv_id}: {e}")

        command_queue: Queue[Any] = Queue()
        response_queue: Queue[Any] = Queue()

        new_process = Process(
            target=_placeholder_worker,
            args=(conv_id, info.browser_id, command_queue, response_queue),
            name=f"browser-{conv_id[:8]}",
        )
        new_process.start()

        info.process = new_process
        info.command_queue = command_queue
        info.response_queue = response_queue
        info.status = "running"
        info.started_at = time.time()
        info.restart_count += 1

        logger.info(
            f"Recovered process for conversation {conv_id}, "
            f"new pid={new_process.pid}, restart_count={info.restart_count}"
        )
        return True

    def recover_all_crashed(self) -> dict[str, bool]:
        """Recover all crashed processes.

        Returns:
            Dictionary mapping conversation IDs to recovery success status
        """
        crashed = self.detect_crashes()
        results: dict[str, bool] = {}
        for conv_id in crashed:
            results[conv_id] = self.recover_process(conv_id)
        return results

    def get_crash_history(self, conv_id: str) -> list[dict[str, Any]]:
        """Get crash history for a conversation.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            List of crash records, each containing timestamp, exit_code, restart_count
        """
        info = self._processes.get(conv_id)
        if info is None:
            return []
        return list(info.crash_history)

    def clear_crash_history(self, conv_id: str) -> bool:
        """Clear crash history for a conversation.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if history was cleared, False if conversation not found
        """
        info = self._processes.get(conv_id)
        if info is None:
            return False
        info.crash_history = []
        return True

    def set_max_restarts(self, conv_id: str, max_restarts: int) -> None:
        """Set the maximum number of restarts for a conversation.

        Args:
            conv_id: Unique conversation identifier
            max_restarts: Maximum number of restarts allowed
        """
        self._max_restarts[conv_id] = max_restarts

    def get_restart_count(self, conv_id: str) -> int:
        """Get the current restart count for a conversation.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            Number of times the process has been restarted, 0 if not found
        """
        info = self._processes.get(conv_id)
        if info is None:
            return 0
        return info.restart_count

    # ==================== Health Monitoring Methods ====================

    def check_health(self, conv_id: str) -> dict:
        """Check the health of a process.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            Dict with health info: alive, status, memory_bytes, memory_mb,
            memory_limit_mb, memory_exceeded
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            return {
                "alive": False,
                "status": "not_found",
                "memory_bytes": None,
                "memory_mb": None,
                "memory_limit_mb": None,
                "memory_exceeded": False,
            }

        alive = process_info.process is not None and process_info.process.is_alive()
        memory_bytes = self.get_memory_usage(conv_id)
        memory_mb = memory_bytes / (1024 * 1024) if memory_bytes else None
        memory_exceeded = self.is_memory_exceeded(conv_id)

        return {
            "alive": alive,
            "status": process_info.status,
            "memory_bytes": memory_bytes,
            "memory_mb": memory_mb,
            "memory_limit_mb": process_info.memory_limit_mb,
            "memory_exceeded": memory_exceeded,
        }

    def get_memory_usage(self, conv_id: str) -> Optional[int]:
        """Get the memory usage of a process in bytes.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            Memory usage in bytes, or None if process not found or psutil unavailable
        """
        if not PSUTIL_AVAILABLE:
            return None

        process_info = self._processes.get(conv_id)
        if process_info is None or process_info.process is None:
            return None

        try:
            import psutil as _psutil

            return _psutil.Process(process_info.process.pid).memory_info().rss
        except Exception:
            return None

    def check_all_health(self) -> dict[str, dict]:
        """Check the health of all processes.

        Returns:
            Dict mapping conversation_id to health info dict
        """
        return {conv_id: self.check_health(conv_id) for conv_id in self._processes}

    def set_memory_limit(self, conv_id: str, limit_mb: int) -> None:
        """Set the memory limit for a process.

        Args:
            conv_id: Unique conversation identifier
            limit_mb: Memory limit in megabytes

        Raises:
            KeyError: If no process exists for this conversation
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            raise KeyError(f"No process found for conversation {conv_id}")
        process_info.memory_limit_mb = limit_mb

    def is_memory_exceeded(self, conv_id: str) -> bool:
        """Check if a process has exceeded its memory limit.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if memory exceeds limit, False otherwise
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            return False

        memory_bytes = self.get_memory_usage(conv_id)
        if memory_bytes is None:
            return False

        memory_mb = memory_bytes / (1024 * 1024)
        return memory_mb > process_info.memory_limit_mb

    def restart_if_needed(self, conv_id: str) -> bool:
        """Restart a process if it has exceeded its memory limit.

        Args:
            conv_id: Unique conversation identifier

        Returns:
            True if process was restarted, False otherwise

        Raises:
            KeyError: If no process exists for this conversation
        """
        process_info = self._processes.get(conv_id)
        if process_info is None:
            raise KeyError(f"No process found for conversation {conv_id}")

        if not self.is_memory_exceeded(conv_id):
            return False

        browser_id = process_info.browser_id
        memory_limit_mb = process_info.memory_limit_mb

        logger.warning(f"Process {conv_id} exceeded memory limit, restarting")

        self.shutdown_process(conv_id, force=True)

        self.spawn_conversation_process(conv_id, browser_id)

        self.set_memory_limit(conv_id, memory_limit_mb)

        return True
