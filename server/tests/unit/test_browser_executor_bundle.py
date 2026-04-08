"""
Unit tests for BrowserExecutorBundle.
"""

import pickle
import queue
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from server.api.sse import SSEEvent
from server.core.browser_executor_bundle import (
    BrowserExecutorBundle,
    BundleState,
)
from server.models.commands import CommandResponse


class TestBundleState:
    """Tests for BundleState dataclass."""

    def test_default_state(self):
        """BundleState has correct defaults."""
        state = BundleState()

        assert state.initialized is False
        assert state.conversation_created is False
        assert state.error is None

    def test_state_with_values(self):
        """BundleState can be created with values."""
        state = BundleState(
            initialized=True,
            conversation_created=True,
            error="test error",
        )

        assert state.initialized is True
        assert state.conversation_created is True
        assert state.error == "test error"


class TestBrowserExecutorBundleInstantiation:
    """Tests for BrowserExecutorBundle instantiation."""

    def test_basic_instantiation(self):
        """Bundle can be instantiated with required parameters."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-1",
            browser_id="test-browser-1",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        assert bundle.conversation_id == "test-conv-1"
        assert bundle.browser_id == "test-browser-1"
        assert bundle.llm_config == {"model": "test-model", "api_key": "test-key"}
        assert bundle.working_directory == "."
        assert bundle.state.initialized is False
        assert bundle.is_initialized() is False

    def test_instantiation_with_working_directory(self):
        """Bundle can be instantiated with custom working directory."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-2",
            browser_id="test-browser-2",
            llm_config={"model": "test-model", "api_key": "test-key"},
            working_directory="/custom/path",
        )

        assert bundle.working_directory == "/custom/path"

    def test_get_state_dict(self):
        """get_state_dict returns correct state information."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-3",
            browser_id="test-browser-3",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        state_dict = bundle.get_state_dict()

        assert state_dict["conversation_id"] == "test-conv-3"
        assert state_dict["browser_id"] == "test-browser-3"
        assert state_dict["initialized"] is False
        assert state_dict["conversation_created"] is False
        assert state_dict["error"] is None


class TestBrowserExecutorBundlePickling:
    """Tests for pickle serialization."""

    def test_pickle_roundtrip(self):
        """Bundle can be pickled and unpickled."""
        original = BrowserExecutorBundle(
            conv_id="test-conv-4",
            browser_id="test-browser-4",
            llm_config={"model": "test-model", "api_key": "test-key"},
            working_directory="/test/path",
        )

        # Pickle and unpickle
        pickled = pickle.dumps(original)
        restored = pickle.loads(pickled)

        assert restored.conversation_id == original.conversation_id
        assert restored.browser_id == original.browser_id
        assert restored.llm_config == original.llm_config
        assert restored.working_directory == original.working_directory
        assert restored.state.initialized == original.state.initialized

    def test_pickle_excludes_internal_objects(self):
        """Pickle excludes _agent_manager and _command_processor."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-5",
            browser_id="test-browser-5",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        # Set internal objects (simulating initialized state)
        bundle._agent_manager = MagicMock()
        bundle._command_processor = MagicMock()
        bundle.state.initialized = True

        # Pickle and unpickle
        pickled = pickle.dumps(bundle)
        restored = pickle.loads(pickled)

        # Internal objects should be None after unpickling
        assert restored._agent_manager is None
        assert restored._command_processor is None
        # State should be preserved
        assert restored.state.initialized is True


class TestBrowserExecutorBundleInitialize:
    """Tests for initialize() method."""

    @pytest.mark.asyncio
    async def test_initialize_success(self):
        """initialize() creates AgentManager and CommandProcessor."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-6",
            browser_id="test-browser-6",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
        ):
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor_class.return_value = mock_processor

            result = await bundle.initialize()

            assert result is True
            assert bundle.is_initialized() is True
            assert bundle.state.conversation_created is True
            mock_agent_mgr.create_conversation.assert_called_once_with(
                conversation_id="test-conv-6",
                cwd=".",
                model="test-model",
                base_url=None,
                browser_id="test-browser-6",
            )

    @pytest.mark.asyncio
    async def test_initialize_idempotent(self):
        """initialize() is idempotent - returns True if already initialized."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-7",
            browser_id="test-browser-7",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
        ):
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor_class.return_value = mock_processor

            # First initialize
            result1 = await bundle.initialize()
            assert result1 is True

            # Second initialize should return True without re-creating
            result2 = await bundle.initialize()
            assert result2 is True

            # create_conversation should only be called once
            assert mock_agent_mgr.create_conversation.call_count == 1

    @pytest.mark.asyncio
    async def test_initialize_handles_exception(self):
        """initialize() handles exceptions gracefully."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-8",
            browser_id="test-browser-8",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with patch(
            "server.core.browser_executor_bundle.OpenBrowserAgentManager"
        ) as mock_agent_mgr_class:
            mock_agent_mgr_class.side_effect = Exception("Test error")

            result = await bundle.initialize()

            assert result is False
            assert bundle.state.error == "Test error"
            assert bundle.is_initialized() is False


class TestBrowserExecutorBundleExecuteCommand:
    """Tests for execute_command() method."""

    @pytest.mark.asyncio
    async def test_execute_command_raises_when_not_initialized(self):
        """execute_command() raises RuntimeError if not initialized."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-9",
            browser_id="test-browser-9",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with pytest.raises(RuntimeError) as exc_info:
            await bundle.execute_command({"type": "screenshot"})

        assert "not initialized" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_execute_command_success(self):
        """execute_command() routes command through CommandProcessor."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-10",
            browser_id="test-browser-10",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
            patch("server.core.browser_executor_bundle.parse_command") as mock_parse,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor.execute = AsyncMock(
                return_value=CommandResponse(
                    success=True,
                    command_id="cmd-123",
                    data={"image": "base64data"},
                )
            )
            mock_processor_class.return_value = mock_processor

            mock_command = MagicMock()
            mock_parse.return_value = mock_command

            # Initialize and execute
            await bundle.initialize()
            result = await bundle.execute_command({"type": "screenshot"})

            assert result["success"] is True
            assert result["command_id"] == "cmd-123"
            assert result["data"]["image"] == "base64data"

    @pytest.mark.asyncio
    async def test_execute_command_adds_conversation_id(self):
        """execute_command() adds conversation_id if not present."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-11",
            browser_id="test-browser-11",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        captured_command = {}

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
            patch("server.core.browser_executor_bundle.parse_command") as mock_parse,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor.execute = AsyncMock(
                return_value=CommandResponse(success=True)
            )
            mock_processor_class.return_value = mock_processor

            def capture_command(cmd):
                captured_command.update(cmd)
                return MagicMock()

            mock_parse.side_effect = capture_command

            # Initialize and execute
            await bundle.initialize()
            await bundle.execute_command({"type": "screenshot"})

            # Verify conversation_id was added
            assert captured_command["conversation_id"] == "test-conv-11"
            assert captured_command["browser_id"] == "test-browser-11"

    @pytest.mark.asyncio
    async def test_execute_command_handles_exception(self):
        """execute_command() handles exceptions gracefully."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-12",
            browser_id="test-browser-12",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
            patch("server.core.browser_executor_bundle.parse_command") as mock_parse,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor_class.return_value = mock_processor

            mock_parse.side_effect = Exception("Parse error")

            # Initialize and execute
            await bundle.initialize()
            result = await bundle.execute_command({"type": "invalid"})

            assert result["success"] is False
            assert "Parse error" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_agent_message_streams_events(self):
        """execute_agent_message() should run the worker-local conversation."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-12b",
            browser_id="test-browser-12b",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
            patch(
                "server.core.browser_executor_bundle.session_manager"
            ) as mock_session_manager,
        ):
            mock_visualizer = MagicMock()
            mock_conversation = MagicMock()
            mock_conversation.run = MagicMock()
            mock_conversation.conversation_stats = MagicMock()
            mock_combined_metrics = MagicMock()
            mock_combined_metrics.get.return_value = {"accumulated_cost": 0.5}
            mock_combined_metrics.model_name = "test-model"
            mock_conversation.conversation_stats.get_combined_metrics.return_value = (
                mock_combined_metrics
            )
            mock_conv_state = MagicMock(
                conversation=mock_conversation,
                visualizer=mock_visualizer,
            )

            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr.get_conversation.return_value = mock_conv_state
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor_class.return_value = MagicMock()

            await bundle.initialize()

            event_queue: queue.Queue[SSEEvent] = queue.Queue()
            result = await bundle.execute_agent_message("hello", event_queue)

            assert result["success"] is True
            mock_visualizer.set_event_queue.assert_called_once_with(event_queue)
            mock_conversation.send_message.assert_called_once_with("hello")
            mock_conversation.run.assert_called_once_with()

            # usage_metrics must be emitted *before* complete so the SSE
            # streamer doesn't race-drop it after yielding complete.
            usage_event = event_queue.get_nowait()
            complete_event = event_queue.get_nowait()
            assert usage_event.event_type == "usage_metrics"
            assert complete_event.event_type == "complete"
            assert usage_event.data["metrics"]["model_name"] == "test-model"
            mock_session_manager.save_event.assert_called_once_with(
                conversation_id="test-conv-12b",
                event_type="usage_metrics",
                event_data={
                    "conversation_id": "test-conv-12b",
                    "metrics": {
                        "accumulated_cost": 0.5,
                        "model_name": "test-model",
                    },
                },
            )

    @pytest.mark.asyncio
    async def test_pause_conversation_requests_pause_on_worker_conversation(self):
        """pause_conversation() should delegate to the worker-local conversation."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-12c",
            browser_id="test-browser-12c",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
        ):
            mock_conversation = MagicMock()
            mock_conv_state = MagicMock(
                conversation=mock_conversation,
                visualizer=MagicMock(),
            )

            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr.get_conversation.return_value = mock_conv_state
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor_class.return_value = MagicMock()

            await bundle.initialize()
            result = await bundle.pause_conversation()

            assert result is True
            mock_conversation.pause.assert_called_once_with()


class TestBrowserExecutorBundleShutdown:
    """Tests for shutdown() method."""

    @pytest.mark.asyncio
    async def test_shutdown_success(self):
        """shutdown() cleans up resources."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-13",
            browser_id="test-browser-13",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr.delete_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor.cleanup_conversation = MagicMock()
            mock_processor_class.return_value = mock_processor

            # Initialize and shutdown
            await bundle.initialize()
            result = await bundle.shutdown()

            assert result is True
            assert bundle.is_initialized() is False
            mock_agent_mgr.delete_conversation.assert_called_once_with("test-conv-13")
            mock_processor.cleanup_conversation.assert_called_once_with("test-conv-13")

    @pytest.mark.asyncio
    async def test_shutdown_idempotent(self):
        """shutdown() is idempotent - returns True if not initialized."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-14",
            browser_id="test-browser-14",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        # Shutdown without initialize
        result = await bundle.shutdown()

        assert result is True

    @pytest.mark.asyncio
    async def test_shutdown_handles_exception(self):
        """shutdown() handles exceptions gracefully."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-15",
            browser_id="test-browser-15",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr.delete_conversation = MagicMock(
                side_effect=Exception("Delete error")
            )
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor_class.return_value = mock_processor

            # Initialize and shutdown
            await bundle.initialize()
            result = await bundle.shutdown()

            assert result is False
            assert bundle.state.error == "Delete error"


class TestBrowserExecutorBundleLifecycle:
    """Tests for complete lifecycle."""

    @pytest.mark.asyncio
    async def test_full_lifecycle(self):
        """Complete lifecycle: initialize → execute → shutdown."""
        bundle = BrowserExecutorBundle(
            conv_id="test-conv-16",
            browser_id="test-browser-16",
            llm_config={"model": "test-model", "api_key": "test-key"},
        )

        with (
            patch(
                "server.core.browser_executor_bundle.OpenBrowserAgentManager"
            ) as mock_agent_mgr_class,
            patch(
                "server.core.browser_executor_bundle.CommandProcessor"
            ) as mock_processor_class,
            patch("server.core.browser_executor_bundle.parse_command") as mock_parse,
        ):
            # Setup mocks
            mock_agent_mgr = MagicMock()
            mock_agent_mgr.create_conversation = MagicMock()
            mock_agent_mgr.delete_conversation = MagicMock()
            mock_agent_mgr_class.return_value = mock_agent_mgr

            mock_processor = MagicMock()
            mock_processor.execute = AsyncMock(
                return_value=CommandResponse(success=True, data={"status": "ok"})
            )
            mock_processor.cleanup_conversation = MagicMock()
            mock_processor_class.return_value = mock_processor

            mock_parse.return_value = MagicMock()

            # Initialize
            init_result = await bundle.initialize()
            assert init_result is True
            assert bundle.is_initialized() is True

            # Execute command
            exec_result = await bundle.execute_command({"type": "screenshot"})
            assert exec_result["success"] is True

            # Shutdown
            shutdown_result = await bundle.shutdown()
            assert shutdown_result is True
            assert bundle.is_initialized() is False
