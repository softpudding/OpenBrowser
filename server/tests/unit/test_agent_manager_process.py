"""Unit tests for AgentManager ProcessManager integration."""

import uuid
import sys
import types
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from openhands.sdk import LLM
from openhands.sdk.context.condenser import LLMSummarizingCondenser


# Mock openhands.tools imports used by server.agent.manager in test environments
class MockTerminalTool:
    name = "terminal"


class MockFileEditorTool:
    name = "file_editor"


class MockTaskTrackerTool:
    name = "task_tracker"


terminal_module = types.ModuleType("openhands.tools.terminal")
terminal_module.TerminalTool = MockTerminalTool
sys.modules["openhands.tools.terminal"] = terminal_module

file_editor_module = types.ModuleType("openhands.tools.file_editor")
file_editor_module.FileEditorTool = MockFileEditorTool
sys.modules["openhands.tools.file_editor"] = file_editor_module

task_tracker_module = types.ModuleType("openhands.tools.task_tracker")
task_tracker_module.TaskTrackerTool = MockTaskTrackerTool
sys.modules["openhands.tools.task_tracker"] = task_tracker_module

preset_default_module = types.ModuleType("openhands.tools.preset.default")
preset_default_module.get_default_condenser = MagicMock(return_value=None)
sys.modules["openhands.tools.preset.default"] = preset_default_module
sys.modules["openhands.tools"] = types.ModuleType("openhands.tools")
sys.modules["openhands.tools.preset"] = types.ModuleType("openhands.tools.preset")

from server.agent.conversation import ConversationState
from server.agent.manager import OpenBrowserAgentManager
from server.core.ipc_types import BrowserCommandMessage


class TestAgentManagerMultiProcessMode:
    """Tests for multi-process mode initialization."""

    def test_single_process_mode_by_default(self) -> None:
        """Test that single-process mode is the default."""
        manager = OpenBrowserAgentManager()

        assert manager.multi_process_mode is False
        assert manager._process_manager is None
        assert manager._ipc_router is None

    def test_multi_process_mode_initializes_infrastructure(self) -> None:
        """Test that multi-process mode initializes ProcessManager and IPCRouter."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        assert manager.multi_process_mode is True
        assert manager._process_manager is not None
        assert manager._ipc_router is not None

    def test_large_models_keep_core_browser_toolset(self) -> None:
        """Large models expose the pixel-paradigm browser tools plus general tools."""
        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            manager = OpenBrowserAgentManager()
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )

            tool_names = [
                tool.name
                for tool in manager._get_tools_for_model("dashscope/qwen3.5-plus")
            ]

        assert tool_names == [
            "tab",
            "mouse",
            "keyboard",
            "dialog",
            "select_option",
            "upload_file",
            "please_help_me",
            "terminal",
            "file_editor",
            "task_tracker",
        ]

    def test_small_models_keep_the_same_browser_toolset(self) -> None:
        """Small models use the same pixel-paradigm browser tools as large models."""
        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            manager = OpenBrowserAgentManager()
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-flash",
                api_key="test-key",
                base_url="http://test.url",
            )

            tool_names = [
                tool.name
                for tool in manager._get_tools_for_model("dashscope/qwen3.5-flash")
            ]

        assert tool_names == [
            "tab",
            "mouse",
            "keyboard",
            "dialog",
            "select_option",
            "upload_file",
            "please_help_me",
            "terminal",
            "file_editor",
            "task_tracker",
        ]

    def test_unknown_models_default_to_large_profile(self) -> None:
        """Unconfigured models should keep the standard browser toolset."""
        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            manager = OpenBrowserAgentManager()
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )

            tool_names = [
                tool.name for tool in manager._get_tools_for_model("some/new-model")
            ]

        assert "dialog" in tool_names
        assert "please_help_me" in tool_names

    def test_system_prompt_kwargs_follow_large_model_profile(self) -> None:
        """Large models should get the large-profile system prompt kwargs."""
        manager = OpenBrowserAgentManager()

        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )

            kwargs = manager._get_system_prompt_kwargs("dashscope/qwen3.5-plus")

        assert kwargs == {
            "model_profile": "large",
            "small_model": False,
            "routine_replay_mode": False,
        }

    def test_system_prompt_kwargs_follow_small_model_profile(self) -> None:
        """Small models should get the small-profile system prompt kwargs."""
        manager = OpenBrowserAgentManager()

        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-flash",
                api_key="test-key",
                base_url="http://test.url",
            )

            kwargs = manager._get_system_prompt_kwargs("dashscope/qwen3.5-flash")

        assert kwargs == {
            "model_profile": "small",
            "small_model": True,
            "routine_replay_mode": False,
        }

    def test_system_prompt_kwargs_enable_routine_replay_mode(self) -> None:
        """When routine_replay_mode=True is passed, the flag must land in kwargs."""
        manager = OpenBrowserAgentManager()

        with patch("server.agent.manager.llm_config_manager") as mock_llm_config:
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )

            kwargs = manager._get_system_prompt_kwargs(
                "dashscope/qwen3.5-plus", routine_replay_mode=True
            )

        assert kwargs["routine_replay_mode"] is True
        assert kwargs["small_model"] is False

    def test_single_process_agent_receives_tool_image_window(self) -> None:
        """Single-process conversations should pass tool_image_window to Agent."""
        manager = OpenBrowserAgentManager()

        with (
            patch("server.agent.manager.Agent") as mock_agent,
            patch("server.agent.manager.Conversation"),
            patch("server.agent.manager.QueueVisualizer"),
            patch("server.agent.manager.get_context_image_window", return_value=2),
            patch.object(manager, "_build_agent_context", return_value=MagicMock()),
            patch.object(manager, "_create_llm_from_config", return_value=MagicMock()),
            patch.object(manager, "_get_tools_for_model", return_value=[]),
            patch.object(
                manager,
                "_get_system_prompt_kwargs",
                return_value={"model_profile": "large", "small_model": False},
            ),
            patch("server.agent.manager.get_default_condenser", return_value=None),
        ):
            manager._create_conversation_in_process(str(uuid.uuid4()), cwd="/tmp/demo")

        assert mock_agent.call_args is not None
        assert mock_agent.call_args.kwargs["tool_image_window"] == 2

    def test_single_process_routine_replay_mode_reaches_system_prompt(self) -> None:
        """mode='routine_replay' must flow from create_conversation through
        to the Agent's system_prompt_kwargs as routine_replay_mode=True.
        """
        manager = OpenBrowserAgentManager()

        with (
            patch("server.agent.manager.Agent") as mock_agent,
            patch("server.agent.manager.Conversation"),
            patch("server.agent.manager.QueueVisualizer"),
            patch("server.agent.manager.session_manager") as mock_session_manager,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
            patch("server.agent.manager.get_context_image_window", return_value=2),
            patch.object(manager, "_build_agent_context", return_value=MagicMock()),
            patch.object(manager, "_create_llm_from_config", return_value=MagicMock()),
            patch.object(manager, "_get_tools_for_model", return_value=[]),
            patch("server.agent.manager.get_default_condenser", return_value=None),
        ):
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )

            conv_id = manager.create_conversation(
                cwd="/tmp/demo", mode="routine_replay"
            )

        # Session metadata must record the mode so other processes see it.
        create_call = mock_session_manager.create_session.call_args
        assert create_call.kwargs["metadata"]["mode"] == "routine_replay"

        # Agent must be constructed with routine_replay_mode=True in its
        # system_prompt_kwargs.
        agent_kwargs = mock_agent.call_args.kwargs
        assert agent_kwargs["system_prompt_kwargs"]["routine_replay_mode"] is True

        # Sanity: default (no mode) should NOT set the flag.
        mock_agent.reset_mock()
        manager2 = OpenBrowserAgentManager()
        with (
            patch("server.agent.manager.Agent") as mock_agent2,
            patch("server.agent.manager.Conversation"),
            patch("server.agent.manager.QueueVisualizer"),
            patch("server.agent.manager.session_manager"),
            patch("server.agent.manager.llm_config_manager") as mock_llm_config2,
            patch("server.agent.manager.get_context_image_window", return_value=2),
            patch.object(manager2, "_build_agent_context", return_value=MagicMock()),
            patch.object(manager2, "_create_llm_from_config", return_value=MagicMock()),
            patch.object(manager2, "_get_tools_for_model", return_value=[]),
            patch("server.agent.manager.get_default_condenser", return_value=None),
        ):
            mock_llm_config2.reload_config.return_value = MagicMock()
            mock_llm_config2.get_llm_config.return_value = MagicMock(
                model="dashscope/qwen3.5-plus",
                api_key="test-key",
                base_url="http://test.url",
            )
            manager2.create_conversation(cwd="/tmp/demo")

        free_form_kwargs = mock_agent2.call_args.kwargs
        assert free_form_kwargs["system_prompt_kwargs"]["routine_replay_mode"] is False

    def test_single_process_agent_receives_browser_tuned_condenser(self) -> None:
        """Single-process conversations should tune condenser for browser workflows."""
        manager = OpenBrowserAgentManager()
        llm = LLM.model_construct(model="test-model", max_input_tokens=100_000)
        default_condenser = LLMSummarizingCondenser(
            llm=llm.model_copy(update={"usage_id": "condenser"}),
            max_size=80,
            keep_first=4,
        )

        with (
            patch("server.agent.manager.Agent") as mock_agent,
            patch("server.agent.manager.Conversation"),
            patch("server.agent.manager.QueueVisualizer"),
            patch("server.agent.manager.get_context_image_window", return_value=1),
            patch.object(manager, "_build_agent_context", return_value=MagicMock()),
            patch.object(manager, "_create_llm_from_config", return_value=llm),
            patch.object(manager, "_get_tools_for_model", return_value=[]),
            patch.object(
                manager,
                "_get_system_prompt_kwargs",
                return_value={"model_profile": "large", "small_model": False},
            ),
            patch(
                "server.agent.manager.get_default_condenser",
                return_value=default_condenser,
            ),
        ):
            manager._create_conversation_in_process(str(uuid.uuid4()), cwd="/tmp/demo")

        assert mock_agent.call_args is not None
        condenser = mock_agent.call_args.kwargs["condenser"]
        assert isinstance(condenser, LLMSummarizingCondenser)
        assert condenser.max_size == 1000
        assert condenser.max_tokens == 70_000


class TestConversationCreationMultiProcess:
    """Tests for conversation creation in multi-process mode."""

    def test_create_conversation_spawns_process(self) -> None:
        """Test that create_conversation spawns a process in multi-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config") as mock_spawn,
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation") as mock_register,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_process_info = MagicMock()
            mock_process_info.command_queue = MagicMock()
            mock_process_info.response_queue = MagicMock()
            mock_process_info.browser_id = "browser-123"
            mock_get_info.return_value = mock_process_info

            conv_id = manager.create_conversation()

            mock_spawn.assert_called_once()
            mock_register.assert_called_once()

    def test_create_conversation_generates_browser_id(self) -> None:
        """Test that create_conversation generates a browser ID."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config") as mock_spawn,
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation") as mock_register,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_process_info = MagicMock()
            mock_process_info.command_queue = MagicMock()
            mock_process_info.response_queue = MagicMock()
            mock_process_info.browser_id = "browser-456"
            mock_get_info.return_value = mock_process_info

            conv_id = manager.create_conversation()

            call_args = mock_spawn.call_args
            assert call_args is not None
            assert "browser_id" in call_args.kwargs or len(call_args.args) >= 2

    def test_create_conversation_registers_with_ipc_router(self) -> None:
        """Test that create_conversation registers queues with IPCRouter."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config"),
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation") as mock_register,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_command_queue = MagicMock()
            mock_response_queue = MagicMock()
            mock_process_info = MagicMock()
            mock_process_info.command_queue = mock_command_queue
            mock_process_info.response_queue = mock_response_queue
            mock_process_info.browser_id = "browser-789"
            mock_get_info.return_value = mock_process_info

            conv_id = manager.create_conversation()

            mock_register.assert_called_once_with(
                conv_id=conv_id,
                command_queue=mock_command_queue,
                response_queue=mock_response_queue,
            )

    def test_get_or_create_conversation_uses_process_mode(self) -> None:
        """get_or_create_conversation should keep using worker processes."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)
        conv_id = str(uuid.uuid4())

        with (
            patch("server.agent.manager.session_manager") as mock_session_manager,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
            patch.object(
                manager, "_create_conversation_process"
            ) as mock_create_process,
        ):
            mock_llm_config.reload_config.return_value = MagicMock()
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_session_manager.get_session.return_value = MagicMock(
                metadata={
                    "model": "test-model",
                    "base_url": "http://test.url",
                    "model_alias": "default",
                    "browser_id": "browser-123",
                }
            )

            def _store_process_state(*args, **kwargs):
                manager.conversations[conv_id] = ConversationState(
                    conversation_id=conv_id,
                    conversation=None,
                    visualizer=None,
                )
                return conv_id

            mock_create_process.side_effect = _store_process_state

            conv_state = manager.get_or_create_conversation(conv_id, cwd="/tmp/demo")

            assert conv_state.conversation_id == conv_id
            mock_create_process.assert_called_once_with(
                conv_id,
                "/tmp/demo",
                model="test-model",
                base_url="http://test.url",
                browser_id="browser-123",
                model_alias="default",
                mode=None,
            )


class TestConversationDeletionMultiProcess:
    """Tests for conversation deletion in multi-process mode."""

    def test_delete_conversation_shuts_down_process(self) -> None:
        """Test that delete_conversation shuts down the process in multi-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config"),
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation"),
            patch.object(manager._process_manager, "shutdown_process") as mock_shutdown,
            patch.object(
                manager._ipc_router, "unregister_conversation"
            ) as mock_unregister,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
            patch("server.agent.manager.session_manager") as mock_session,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_process_info = MagicMock()
            mock_process_info.command_queue = MagicMock()
            mock_process_info.response_queue = MagicMock()
            mock_process_info.browser_id = "browser-001"
            mock_get_info.return_value = mock_process_info

            conv_id = manager.create_conversation()

            result = manager.delete_conversation(conv_id)

            assert result is True
            mock_unregister.assert_called_once_with(conv_id)
            mock_shutdown.assert_called_once_with(conv_id)

    def test_delete_conversation_unregisters_from_ipc_router(self) -> None:
        """Test that delete_conversation unregisters from IPCRouter."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config"),
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation"),
            patch.object(manager._process_manager, "shutdown_process"),
            patch.object(
                manager._ipc_router, "unregister_conversation"
            ) as mock_unregister,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
            patch("server.agent.manager.session_manager") as mock_session,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_process_info = MagicMock()
            mock_process_info.command_queue = MagicMock()
            mock_process_info.response_queue = MagicMock()
            mock_process_info.browser_id = "browser-002"
            mock_get_info.return_value = mock_process_info

            conv_id = manager.create_conversation()

            manager.delete_conversation(conv_id)

            mock_unregister.assert_called_once_with(conv_id)


class TestCommandRouting:
    """Tests for command routing through IPCRouter."""

    def test_route_command_sends_message(self) -> None:
        """Test that route_command sends BrowserCommandMessage via IPCRouter."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with (
            patch.object(manager._process_manager, "spawn_with_config"),
            patch.object(manager._process_manager, "get_process_info") as mock_get_info,
            patch.object(manager._ipc_router, "register_conversation"),
            patch.object(manager._ipc_router, "route_command") as mock_route,
            patch("server.agent.manager.llm_config_manager") as mock_llm_config,
        ):
            mock_llm_config.get_llm_config.return_value = MagicMock(
                model="test-model",
                api_key="test-key",
                base_url="http://test.url",
            )
            mock_process_info = MagicMock()
            mock_process_info.command_queue = MagicMock()
            mock_process_info.response_queue = MagicMock()
            mock_process_info.browser_id = "browser-003"
            mock_get_info.return_value = mock_process_info
            mock_route.return_value = True

            conv_id = manager.create_conversation()
            command = {"type": "screenshot"}
            result = manager.route_command(conv_id, command)

            assert result is True
            mock_route.assert_called_once()
            call_arg = mock_route.call_args[0][0]
            assert isinstance(call_arg, BrowserCommandMessage)
            assert call_arg.command == command

    def test_route_command_raises_error_in_single_process_mode(self) -> None:
        """Test that route_command raises RuntimeError in single-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=False)

        with pytest.raises(RuntimeError) as exc_info:
            manager.route_command("conv-123", {"type": "screenshot"})

        assert "multi_process_mode" in str(exc_info.value)

    def test_get_response_queue_returns_queue(self) -> None:
        """Test that get_response_queue returns the queue from IPCRouter."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        mock_queue = MagicMock()
        with patch.object(
            manager._ipc_router, "get_response_queue", return_value=mock_queue
        ):
            result = manager.get_response_queue("conv-123")

            assert result == mock_queue

    def test_get_response_queue_raises_error_in_single_process_mode(self) -> None:
        """Test that get_response_queue raises RuntimeError in single-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=False)

        with pytest.raises(RuntimeError) as exc_info:
            manager.get_response_queue("conv-123")

        assert "multi_process_mode" in str(exc_info.value)


class TestProcessStatusMethods:
    """Tests for process status methods."""

    def test_is_process_alive_returns_true_for_running_process(self) -> None:
        """Test that is_process_alive returns True for running process."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with patch.object(
            manager._process_manager, "is_process_alive", return_value=True
        ):
            result = manager.is_process_alive("conv-123")

            assert result is True

    def test_is_process_alive_returns_false_in_single_process_mode(self) -> None:
        """Test that is_process_alive returns False in single-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=False)

        result = manager.is_process_alive("conv-123")

        assert result is False

    def test_get_process_status_returns_status(self) -> None:
        """Test that get_process_status returns the status from ProcessManager."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)

        with patch.object(
            manager._process_manager, "get_process_status", return_value="running"
        ):
            result = manager.get_process_status("conv-123")

            assert result == "running"

    def test_get_process_status_returns_none_in_single_process_mode(self) -> None:
        """Test that get_process_status returns None in single-process mode."""
        manager = OpenBrowserAgentManager(multi_process_mode=False)

        result = manager.get_process_status("conv-123")

        assert result is None


class TestPauseRequests:
    """Tests for non-blocking pause requests."""

    def test_request_pause_spawns_background_thread_in_single_process(self) -> None:
        """Single-process pause requests should never block the caller."""
        manager = OpenBrowserAgentManager(multi_process_mode=False)
        conversation = MagicMock()
        manager.conversations["conv-123"] = ConversationState(
            conversation_id="conv-123",
            conversation=conversation,
            visualizer=None,
        )
        captured: dict[str, object] = {}

        class FakeThread:
            def __init__(
                self,
                target,
                args=(),
                kwargs=None,
                name=None,
                daemon=None,
                group=None,
            ) -> None:
                captured["target"] = target
                captured["args"] = args
                captured["name"] = name
                captured["daemon"] = daemon

            def start(self) -> None:
                captured["started"] = True

        with patch("server.agent.manager.threading.Thread", FakeThread):
            result = manager.request_pause("conv-123")

        assert result is True
        assert captured["started"] is True
        assert captured["name"] == "pause-conv-123"
        assert captured["daemon"] is True
        conversation.pause.assert_not_called()

        target = captured["target"]
        args = captured["args"]
        assert callable(target)
        target(*args)
        conversation.pause.assert_called_once_with()

    def test_request_pause_queues_control_message_in_multi_process_mode(self) -> None:
        """Multi-process pause requests should be sent via the worker queue."""
        manager = OpenBrowserAgentManager(multi_process_mode=True)
        command_queue = MagicMock()

        with patch.object(
            manager, "get_command_queue", return_value=command_queue
        ) as mock_get_queue:
            result = manager.request_pause("conv-456")

        assert result is True
        mock_get_queue.assert_called_once_with("conv-456")
        command_queue.put.assert_called_once_with({"control": "pause"})
