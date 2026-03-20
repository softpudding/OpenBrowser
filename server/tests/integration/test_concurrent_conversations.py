"""Integration tests for concurrent conversation processing.

Tests the multi-process architecture with real multiprocessing:
- Multiple conversations can be created simultaneously
- Commands can be sent to multiple conversations concurrently
- Each conversation has isolated process
- Processes don't interfere with each other
- All conversations can be shut down cleanly

Uses real multiprocessing (not mocks) for integration testing.
"""

import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import Queue

import pytest

from server.core.process_manager import ProcessManager
from server.core.ipc_router import IPCRouter
from server.core.ipc_types import (
    BrowserCommandMessage,
    BrowserResponseMessage,
    ProcessShutdownMessage,
)


@pytest.fixture
def process_manager() -> ProcessManager:
    """Create a fresh ProcessManager for each test."""
    return ProcessManager()


@pytest.fixture
def ipc_router() -> IPCRouter:
    """Create a fresh IPCRouter for each test."""
    return IPCRouter()


def generate_conv_id() -> str:
    """Generate a unique conversation ID."""
    return str(uuid.uuid4())


def generate_browser_id() -> str:
    """Generate a unique browser ID."""
    return str(uuid.uuid4())


@pytest.mark.integration
class TestConcurrentConversationCreation:
    """Tests for creating multiple conversations simultaneously."""

    def test_create_multiple_conversations_simultaneously(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that multiple conversations can be created simultaneously.

        Creates 5 conversations and verifies all are registered and running.
        """
        num_conversations = 5
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create all conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

        # Verify all are registered
        assert process_manager.get_process_count() == num_conversations

        # Verify all are running
        for conv_id in conv_ids:
            assert process_manager.is_process_alive(conv_id)
            assert process_manager.get_process_status(conv_id) == "running"

        # Cleanup
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id)

    def test_create_conversations_with_thread_pool(
        self, process_manager: ProcessManager
    ) -> None:
        """Test creating conversations from multiple threads simultaneously.

        Uses ThreadPoolExecutor to create conversations concurrently.
        """
        num_conversations = 5
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        def create_conversation(conv_id: str) -> str:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)
            return conv_id

        # Create conversations concurrently
        with ThreadPoolExecutor(max_workers=num_conversations) as executor:
            futures = [executor.submit(create_conversation, cid) for cid in conv_ids]
            created_ids = [f.result() for f in as_completed(futures)]

        # Verify all were created
        assert len(created_ids) == num_conversations
        assert process_manager.get_process_count() == num_conversations

        # Verify all are running
        for conv_id in conv_ids:
            assert process_manager.is_process_alive(conv_id)

        # Cleanup
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id)


@pytest.mark.integration
class TestConcurrentCommandRouting:
    """Tests for sending commands to multiple conversations concurrently."""

    def test_route_commands_to_multiple_conversations(
        self, process_manager: ProcessManager, ipc_router: IPCRouter
    ) -> None:
        """Test that commands can be routed to multiple conversations.

        Creates 3 conversations, registers them with IPCRouter, and sends
        commands to each via the router.
        """
        num_conversations = 3
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create and register conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

            # Get queues from process info
            process_info = process_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.command_queue is not None
            assert process_info.response_queue is not None

            # Register with IPCRouter
            ipc_router.register_conversation(
                conv_id,
                process_info.command_queue,
                process_info.response_queue,
            )

        # Verify all registered with router
        assert len(ipc_router.list_conversations()) == num_conversations

        # Send shutdown commands directly to command queues
        # (ProcessShutdownMessage is not a BrowserCommandMessage, so don't use route_command)
        for conv_id in conv_ids:
            shutdown_msg = ProcessShutdownMessage(
                conversation_id=conv_id,
                browser_id=process_manager.get_process_info(conv_id).browser_id,
                reason="test_complete",
                force=False,
            )
            command_queue = ipc_router.get_command_queue(conv_id)
            assert command_queue is not None
            command_queue.put(shutdown_msg.to_dict())

        # Wait for processes to exit
        time.sleep(2.0)

        # Verify all processes have exited
        for conv_id in conv_ids:
            assert not process_manager.is_process_alive(conv_id)

        # Cleanup
        for conv_id in conv_ids:
            try:
                process_manager.shutdown_process(conv_id, force=True)
            except KeyError:
                pass  # Already shut down

    def test_concurrent_command_sending(
        self, process_manager: ProcessManager, ipc_router: IPCRouter
    ) -> None:
        """Test sending commands to multiple conversations concurrently.

        Uses ThreadPoolExecutor to send commands to all conversations
        at the same time.
        """
        num_conversations = 4
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create and register conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

            process_info = process_manager.get_process_info(conv_id)
            ipc_router.register_conversation(
                conv_id,
                process_info.command_queue,
                process_info.response_queue,
            )

        def send_shutdown(conv_id: str) -> bool:
            shutdown_msg = ProcessShutdownMessage(
                conversation_id=conv_id,
                browser_id=process_manager.get_process_info(conv_id).browser_id,
                reason="test_complete",
                force=False,
            )
            command_queue = ipc_router.get_command_queue(conv_id)
            if command_queue is None:
                return False
            command_queue.put(shutdown_msg.to_dict())
            return True

        # Send shutdown commands concurrently
        with ThreadPoolExecutor(max_workers=num_conversations) as executor:
            futures = [executor.submit(send_shutdown, cid) for cid in conv_ids]
            results = [f.result() for f in as_completed(futures)]

        # All commands should have been sent successfully
        assert all(results)

        # Wait for processes to exit
        time.sleep(2.0)

        # Cleanup
        for conv_id in conv_ids:
            try:
                process_manager.shutdown_process(conv_id, force=True)
            except KeyError:
                pass


@pytest.mark.integration
class TestProcessIsolation:
    """Tests for verifying process isolation between conversations."""

    def test_each_conversation_has_unique_process(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that each conversation has its own unique process.

        Creates 3 conversations and verifies each has a different PID.
        """
        num_conversations = 3
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

        # Get all PIDs
        pids = set()
        for conv_id in conv_ids:
            process = process_manager.get_process(conv_id)
            assert process is not None
            assert process.pid is not None
            pids.add(process.pid)

        # All PIDs should be unique
        assert (
            len(pids) == num_conversations
        ), "Each conversation should have unique PID"

        # Cleanup
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id)

    def test_each_conversation_has_unique_queues(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that each conversation has its own command/response queues.

        Creates 3 conversations and verifies each has unique queues.
        """
        num_conversations = 3
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

        # Get all queues
        command_queues = set()
        response_queues = set()

        for conv_id in conv_ids:
            process_info = process_manager.get_process_info(conv_id)
            assert process_info is not None
            assert process_info.command_queue is not None
            assert process_info.response_queue is not None

            # Use id() to check queue identity
            command_queues.add(id(process_info.command_queue))
            response_queues.add(id(process_info.response_queue))

        # All queues should be unique
        assert len(command_queues) == num_conversations
        assert len(response_queues) == num_conversations

        # Cleanup
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id)

    def test_processes_dont_interfere(
        self, process_manager: ProcessManager, ipc_router: IPCRouter
    ) -> None:
        """Test that processes don't interfere with each other.

        Creates 3 conversations, sends shutdown to one, and verifies
        the others are still running.
        """
        num_conversations = 3
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create and register conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

            process_info = process_manager.get_process_info(conv_id)
            ipc_router.register_conversation(
                conv_id,
                process_info.command_queue,
                process_info.response_queue,
            )

        # All should be running
        for conv_id in conv_ids:
            assert process_manager.is_process_alive(conv_id)

        # Shutdown only the first conversation
        first_conv = conv_ids[0]
        shutdown_msg = ProcessShutdownMessage(
            conversation_id=first_conv,
            browser_id=process_manager.get_process_info(first_conv).browser_id,
            reason="test_shutdown",
            force=False,
        )
        command_queue = ipc_router.get_command_queue(first_conv)
        assert command_queue is not None
        command_queue.put(shutdown_msg.to_dict())

        # Wait for shutdown
        time.sleep(2.0)

        # First should be stopped, others still running
        assert not process_manager.is_process_alive(first_conv)
        for conv_id in conv_ids[1:]:
            assert process_manager.is_process_alive(
                conv_id
            ), f"Conversation {conv_id} should still be running"

        # Cleanup remaining
        for conv_id in conv_ids[1:]:
            process_manager.shutdown_process(conv_id)


@pytest.mark.integration
class TestCleanShutdown:
    """Tests for clean shutdown of all conversations."""

    def test_shutdown_all_conversations_cleanly(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that all conversations can be shut down cleanly.

        Creates 5 conversations and shuts them all down gracefully.
        """
        num_conversations = 5
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create all conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

        # Verify all running
        for conv_id in conv_ids:
            assert process_manager.is_process_alive(conv_id)

        # Shutdown all gracefully
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id, force=False)

        # Verify all stopped
        for conv_id in conv_ids:
            assert not process_manager.is_process_alive(conv_id)

        # Verify process manager is empty
        assert process_manager.get_process_count() == 0

    def test_force_shutdown_all_conversations(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that all conversations can be force-shut down.

        Creates 5 conversations and force-shuts them all down.
        """
        num_conversations = 5
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create all conversations
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

        # Force shutdown all
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id, force=True)

        # Verify all stopped
        for conv_id in conv_ids:
            assert not process_manager.is_process_alive(conv_id)

        # Verify process manager is empty
        assert process_manager.get_process_count() == 0

    def test_shutdown_with_ipcrouter_cleanup(
        self, process_manager: ProcessManager, ipc_router: IPCRouter
    ) -> None:
        """Test that IPCRouter is cleaned up when conversations are shut down.

        Creates conversations, registers with router, shuts down, and
        verifies router is cleaned up.
        """
        num_conversations = 3
        conv_ids = [generate_conv_id() for _ in range(num_conversations)]

        # Create and register
        for conv_id in conv_ids:
            browser_id = generate_browser_id()
            process_manager.spawn_conversation_process(conv_id, browser_id)

            process_info = process_manager.get_process_info(conv_id)
            ipc_router.register_conversation(
                conv_id,
                process_info.command_queue,
                process_info.response_queue,
            )

        # Verify registered
        assert len(ipc_router.list_conversations()) == num_conversations

        # Shutdown and unregister
        for conv_id in conv_ids:
            process_manager.shutdown_process(conv_id)
            ipc_router.unregister_conversation(conv_id)

        # Verify router is empty
        assert len(ipc_router.list_conversations()) == 0

    def test_shutdown_nonexistent_conversation_raises_error(
        self, process_manager: ProcessManager
    ) -> None:
        """Test that shutting down a non-existent conversation raises KeyError."""
        fake_conv_id = generate_conv_id()

        with pytest.raises(KeyError) as exc_info:
            process_manager.shutdown_process(fake_conv_id)

        assert fake_conv_id in str(exc_info.value)
