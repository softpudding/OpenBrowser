"""Unit tests for IPCRouter."""

import pytest
from multiprocessing import Queue
from server.core.ipc_router import IPCRouter
from server.core.ipc_types import BrowserCommandMessage


class TestIPCRouter:
    """Tests for IPCRouter class."""

    def test_init(self):
        """Test IPCRouter initialization."""
        router = IPCRouter()
        assert router.list_conversations() == []
        assert router.has_conversation("nonexistent") is False

    def test_register_conversation(self):
        """Test registering a conversation."""
        router = IPCRouter()
        conv_id = "test-conv-1"
        command_queue = Queue()
        response_queue = Queue()

        router.register_conversation(conv_id, command_queue, response_queue)

        assert router.has_conversation(conv_id) is True
        assert conv_id in router.list_conversations()
        assert router.get_command_queue(conv_id) is command_queue
        assert router.get_response_queue(conv_id) is response_queue

    def test_register_multiple_conversations(self):
        """Test registering multiple conversations."""
        router = IPCRouter()

        # Register first conversation
        conv_id_1 = "conv-1"
        command_queue_1 = Queue()
        response_queue_1 = Queue()
        router.register_conversation(conv_id_1, command_queue_1, response_queue_1)

        # Register second conversation
        conv_id_2 = "conv-2"
        command_queue_2 = Queue()
        response_queue_2 = Queue()
        router.register_conversation(conv_id_2, command_queue_2, response_queue_2)

        conversations = router.list_conversations()
        assert len(conversations) == 2
        assert conv_id_1 in conversations
        assert conv_id_2 in conversations
        assert router.get_command_queue(conv_id_1) is command_queue_1
        assert router.get_command_queue(conv_id_2) is command_queue_2

    def test_unregister_conversation(self):
        """Test unregistering a conversation."""
        router = IPCRouter()
        conv_id = "test-conv"
        command_queue = Queue()
        response_queue = Queue()

        router.register_conversation(conv_id, command_queue, response_queue)
        assert router.has_conversation(conv_id) is True

        result = router.unregister_conversation(conv_id)
        assert result is True
        assert router.has_conversation(conv_id) is False
        assert router.get_command_queue(conv_id) is None
        assert router.get_response_queue(conv_id) is None

    def test_unregister_nonexistent_conversation(self):
        """Test unregistering a conversation that doesn't exist."""
        router = IPCRouter()
        result = router.unregister_conversation("nonexistent")
        assert result is False

    def test_route_command_success(self):
        """Test routing a command to a registered conversation."""
        router = IPCRouter()
        conv_id = "test-conv"
        command_queue = Queue()
        response_queue = Queue()
        router.register_conversation(conv_id, command_queue, response_queue)

        message = BrowserCommandMessage(
            conversation_id=conv_id,
            browser_id="browser-1",
            command={"type": "screenshot"},
            command_id="cmd-1",
        )

        result = router.route_command(message)
        assert result is True

        # Verify message was put in queue
        received = command_queue.get(timeout=1)
        assert received.conversation_id == conv_id
        assert received.command == {"type": "screenshot"}
        assert received.command_id == "cmd-1"
        assert received.browser_id == "browser-1"

    def test_route_command_nonexistent_conversation(self):
        """Test routing a command to a nonexistent conversation."""
        router = IPCRouter()

        message = BrowserCommandMessage(
            conversation_id="nonexistent",
            browser_id="browser-1",
            command={"type": "screenshot"},
        )

        result = router.route_command(message)
        assert result is False

    def test_get_response_queue(self):
        """Test getting response queue for a conversation."""
        router = IPCRouter()
        conv_id = "test-conv"
        command_queue = Queue()
        response_queue = Queue()
        router.register_conversation(conv_id, command_queue, response_queue)

        result = router.get_response_queue(conv_id)
        assert result is response_queue

    def test_get_response_queue_nonexistent(self):
        """Test getting response queue for nonexistent conversation."""
        router = IPCRouter()
        result = router.get_response_queue("nonexistent")
        assert result is None

    def test_get_command_queue(self):
        """Test getting command queue for a conversation."""
        router = IPCRouter()
        conv_id = "test-conv"
        command_queue = Queue()
        response_queue = Queue()
        router.register_conversation(conv_id, command_queue, response_queue)

        result = router.get_command_queue(conv_id)
        assert result is command_queue

    def test_get_command_queue_nonexistent(self):
        """Test getting command queue for nonexistent conversation."""
        router = IPCRouter()
        result = router.get_command_queue("nonexistent")
        assert result is None

    def test_list_conversations(self):
        """Test listing all registered conversations."""
        router = IPCRouter()

        # Empty router
        assert router.list_conversations() == []

        # Add conversations
        for i in range(3):
            conv_id = f"conv-{i}"
            router.register_conversation(conv_id, Queue(), Queue())

        conversations = router.list_conversations()
        assert len(conversations) == 3
        assert "conv-0" in conversations
        assert "conv-1" in conversations
        assert "conv-2" in conversations

    def test_has_conversation(self):
        """Test checking if a conversation is registered."""
        router = IPCRouter()
        conv_id = "test-conv"
        command_queue = Queue()
        response_queue = Queue()

        assert router.has_conversation(conv_id) is False
        router.register_conversation(conv_id, command_queue, response_queue)
        assert router.has_conversation(conv_id) is True

    def test_clear(self):
        """Test clearing all conversations."""
        router = IPCRouter()

        # Register multiple conversations
        for i in range(3):
            conv_id = f"conv-{i}"
            router.register_conversation(conv_id, Queue(), Queue())

        assert len(router.list_conversations()) == 3

        router.clear()

        assert router.list_conversations() == []
        assert router.has_conversation("conv-0") is False
        assert router.has_conversation("conv-1") is False
        assert router.has_conversation("conv-2") is False

    def test_reregister_conversation(self):
        """Test re-registering a conversation with new queues."""
        router = IPCRouter()
        conv_id = "test-conv"

        # First registration
        command_queue_1 = Queue()
        response_queue_1 = Queue()
        router.register_conversation(conv_id, command_queue_1, response_queue_1)
        assert router.get_command_queue(conv_id) is command_queue_1

        # Re-register with new queues
        command_queue_2 = Queue()
        response_queue_2 = Queue()
        router.register_conversation(conv_id, command_queue_2, response_queue_2)
        assert router.get_command_queue(conv_id) is command_queue_2
        assert router.get_response_queue(conv_id) is response_queue_2

        # Should still only have one conversation
        assert len(router.list_conversations()) == 1
