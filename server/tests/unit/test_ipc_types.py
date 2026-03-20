"""
Unit tests for IPC message types.

Tests cover:
- Message creation
- Serialization to dict
- Deserialization from dict
- Round-trip preservation
"""

import pytest
import time
from server.core.ipc_types import (
    IPCMessage,
    BrowserCommandMessage,
    BrowserResponseMessage,
    ProcessSpawnMessage,
    ProcessShutdownMessage,
    serialize_message,
    deserialize_message,
)


class TestIPCMessage:
    """Tests for base IPCMessage class."""

    def test_ipc_message_creation(self):
        """Test creating a base IPC message."""
        msg = IPCMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
        )

        assert msg.conversation_id == "conv-123"
        assert msg.browser_id == "browser-456"
        assert isinstance(msg.timestamp, float)

    def test_ipc_message_to_dict(self):
        """Test serializing IPC message to dict."""
        msg = IPCMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            timestamp=1234567890.0,
        )

        result = msg.to_dict()

        assert result == {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
        }

    def test_ipc_message_from_dict(self):
        """Test deserializing IPC message from dict."""
        data = {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
        }

        msg = IPCMessage.from_dict(data)

        assert msg.conversation_id == "conv-123"
        assert msg.browser_id == "browser-456"
        assert msg.timestamp == 1234567890.0

    def test_ipc_message_round_trip(self):
        """Test round-trip serialization preserves data."""
        original = IPCMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            timestamp=1234567890.0,
        )

        data = original.to_dict()
        restored = IPCMessage.from_dict(data)

        assert restored.conversation_id == original.conversation_id
        assert restored.browser_id == original.browser_id
        assert restored.timestamp == original.timestamp


class TestBrowserCommandMessage:
    """Tests for BrowserCommandMessage."""

    def test_browser_command_message_creation(self):
        """Test creating a browser command message."""
        msg = BrowserCommandMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            command={"type": "screenshot"},
            command_id="cmd-789",
        )

        assert msg.conversation_id == "conv-123"
        assert msg.browser_id == "browser-456"
        assert msg.command == {"type": "screenshot"}
        assert msg.command_id == "cmd-789"

    def test_browser_command_message_to_dict(self):
        """Test serializing browser command message to dict."""
        msg = BrowserCommandMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            command={"type": "click", "x": 100, "y": 200},
            command_id="cmd-789",
            timestamp=1234567890.0,
        )

        result = msg.to_dict()

        assert result == {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
            "command": {"type": "click", "x": 100, "y": 200},
            "command_id": "cmd-789",
        }

    def test_browser_command_message_from_dict(self):
        """Test deserializing browser command message from dict."""
        data = {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
            "command": {"type": "screenshot"},
            "command_id": "cmd-789",
        }

        msg = BrowserCommandMessage.from_dict(data)

        assert msg.conversation_id == "conv-123"
        assert msg.browser_id == "browser-456"
        assert msg.timestamp == 1234567890.0
        assert msg.command == {"type": "screenshot"}
        assert msg.command_id == "cmd-789"

    def test_browser_command_message_round_trip(self):
        """Test round-trip serialization preserves data."""
        original = BrowserCommandMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            command={"type": "navigate", "url": "https://example.com"},
            command_id="cmd-789",
        )

        data = original.to_dict()
        restored = BrowserCommandMessage.from_dict(data)

        assert restored.conversation_id == original.conversation_id
        assert restored.browser_id == original.browser_id
        assert restored.command == original.command
        assert restored.command_id == original.command_id


class TestBrowserResponseMessage:
    """Tests for BrowserResponseMessage."""

    def test_browser_response_message_success(self):
        """Test creating a successful browser response message."""
        msg = BrowserResponseMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            success=True,
            result={"screenshot": "base64data"},
            command_id="cmd-789",
        )

        assert msg.success is True
        assert msg.result == {"screenshot": "base64data"}
        assert msg.error is None

    def test_browser_response_message_error(self):
        """Test creating an error browser response message."""
        msg = BrowserResponseMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            success=False,
            error="Tab not found",
            command_id="cmd-789",
        )

        assert msg.success is False
        assert msg.result is None
        assert msg.error == "Tab not found"

    def test_browser_response_message_to_dict(self):
        """Test serializing browser response message to dict."""
        msg = BrowserResponseMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            success=True,
            result={"status": "ok"},
            error=None,
            command_id="cmd-789",
            timestamp=1234567890.0,
        )

        result = msg.to_dict()

        assert result == {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
            "success": True,
            "result": {"status": "ok"},
            "error": None,
            "command_id": "cmd-789",
        }

    def test_browser_response_message_round_trip(self):
        """Test round-trip serialization preserves data."""
        original = BrowserResponseMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            success=False,
            error="Connection timeout",
            command_id="cmd-789",
        )

        data = original.to_dict()
        restored = BrowserResponseMessage.from_dict(data)

        assert restored.success == original.success
        assert restored.error == original.error
        assert restored.command_id == original.command_id


class TestProcessSpawnMessage:
    """Tests for ProcessSpawnMessage."""

    def test_process_spawn_message_creation(self):
        """Test creating a process spawn message."""
        msg = ProcessSpawnMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            initial_url="https://example.com",
            config={"timeout": 30},
        )

        assert msg.initial_url == "https://example.com"
        assert msg.config == {"timeout": 30}

    def test_process_spawn_message_to_dict(self):
        """Test serializing process spawn message to dict."""
        msg = ProcessSpawnMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            initial_url="https://example.com",
            config={"timeout": 30},
            timestamp=1234567890.0,
        )

        result = msg.to_dict()

        assert result == {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
            "initial_url": "https://example.com",
            "config": {"timeout": 30},
        }

    def test_process_spawn_message_round_trip(self):
        """Test round-trip serialization preserves data."""
        original = ProcessSpawnMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            initial_url="https://example.com",
            config={"timeout": 30, "retries": 3},
        )

        data = original.to_dict()
        restored = ProcessSpawnMessage.from_dict(data)

        assert restored.initial_url == original.initial_url
        assert restored.config == original.config


class TestProcessShutdownMessage:
    """Tests for ProcessShutdownMessage."""

    def test_process_shutdown_message_creation(self):
        """Test creating a process shutdown message."""
        msg = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            reason="user_request",
            force=False,
        )

        assert msg.reason == "user_request"
        assert msg.force is False

    def test_process_shutdown_message_to_dict(self):
        """Test serializing process shutdown message to dict."""
        msg = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            reason="timeout",
            force=True,
            timestamp=1234567890.0,
        )

        result = msg.to_dict()

        assert result == {
            "conversation_id": "conv-123",
            "browser_id": "browser-456",
            "timestamp": 1234567890.0,
            "reason": "timeout",
            "force": True,
        }

    def test_process_shutdown_message_round_trip(self):
        """Test round-trip serialization preserves data."""
        original = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            reason="error",
            force=True,
        )

        data = original.to_dict()
        restored = ProcessShutdownMessage.from_dict(data)

        assert restored.reason == original.reason
        assert restored.force == original.force


class TestSerializeDeserialize:
    """Tests for serialize_message and deserialize_message functions."""

    def test_serialize_browser_command_message(self):
        """Test serializing browser command message to JSON."""
        msg = BrowserCommandMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            command={"type": "screenshot"},
            command_id="cmd-789",
        )

        json_str = serialize_message(msg)

        assert isinstance(json_str, str)
        assert "conv-123" in json_str
        assert "browser-456" in json_str
        assert "screenshot" in json_str

    def test_deserialize_browser_command_message(self):
        """Test deserializing browser command message from JSON."""
        msg = BrowserCommandMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            command={"type": "screenshot"},
            command_id="cmd-789",
        )

        json_str = serialize_message(msg)
        restored = deserialize_message(json_str)

        assert isinstance(restored, BrowserCommandMessage)
        assert restored.conversation_id == "conv-123"
        assert restored.command == {"type": "screenshot"}

    def test_deserialize_browser_response_message(self):
        """Test deserializing browser response message from JSON."""
        msg = BrowserResponseMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            success=True,
            result={"status": "ok"},
            command_id="cmd-789",
        )

        json_str = serialize_message(msg)
        restored = deserialize_message(json_str)

        assert isinstance(restored, BrowserResponseMessage)
        assert restored.success is True
        assert restored.result == {"status": "ok"}

    def test_deserialize_process_spawn_message(self):
        """Test deserializing process spawn message from JSON."""
        msg = ProcessSpawnMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            initial_url="https://example.com",
        )

        json_str = serialize_message(msg)
        restored = deserialize_message(json_str)

        assert isinstance(restored, ProcessSpawnMessage)
        assert restored.initial_url == "https://example.com"

    def test_deserialize_process_shutdown_message(self):
        """Test deserializing process shutdown message from JSON."""
        msg = ProcessShutdownMessage(
            conversation_id="conv-123",
            browser_id="browser-456",
            reason="timeout",
            force=True,
        )

        json_str = serialize_message(msg)
        restored = deserialize_message(json_str)

        assert isinstance(restored, ProcessShutdownMessage)
        assert restored.reason == "timeout"
        assert restored.force is True

    def test_round_trip_all_message_types(self):
        """Test round-trip serialization for all message types."""
        messages = [
            BrowserCommandMessage(
                conversation_id="conv-1",
                browser_id="browser-1",
                command={"type": "test"},
            ),
            BrowserResponseMessage(
                conversation_id="conv-2",
                browser_id="browser-2",
                success=True,
                result={"data": "value"},
            ),
            ProcessSpawnMessage(
                conversation_id="conv-3",
                browser_id="browser-3",
                initial_url="https://test.com",
            ),
            ProcessShutdownMessage(
                conversation_id="conv-4",
                browser_id="browser-4",
                reason="test",
            ),
        ]

        for original in messages:
            json_str = serialize_message(original)
            restored = deserialize_message(json_str)

            assert type(restored) == type(original)
            assert restored.conversation_id == original.conversation_id
            assert restored.browser_id == original.browser_id
