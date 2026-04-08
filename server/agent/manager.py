"""
OpenBrowser Agent Manager

Manages agent instances and conversations with optional multi-process support.
"""

import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Any, Optional, AsyncGenerator
from pathlib import Path

from pydantic import SecretStr
from openhands.sdk import (
    LLM,
    Agent,
    AgentContext,
    Conversation,
    Event,
    get_logger,
)
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.preset.default import get_default_condenser
from openhands.sdk.tool import Tool

from server.api.sse import SSEEvent
from server.agent.browser_condenser import configure_browser_condenser
from server.agent.visualizer import QueueVisualizer
from server.agent.conversation import ConversationState
from server.agent.context_image_window import get_context_image_window
from server.agent.user_help import PLEASE_HELP_ME_TOOL_NAME
import server.agent.tools.help_tool  # noqa: F401
from server.agent.tools.browser_executor import remove_browser_executor
from server.core.ipc_router import IPCRouter
from server.core.ipc_types import BrowserCommandMessage
from server.core.llm_config import llm_config_manager
from server.core.model_profiles import get_model_profile, is_small_model
from server.core.process_manager import ProcessManager
from server.core.session_manager import session_manager, SessionStatus

logger = get_logger(__name__)


def _multi_process_mode_from_env() -> bool:
    """Read multi-process mode from environment.

    This is evaluated when the module-level ``agent_manager`` is created so the
    server can opt into process isolation before FastAPI imports the routes.
    """
    raw_value = os.getenv("CHROME_SERVER_MULTI_PROCESS_MODE") or os.getenv(
        "OPENBROWSER_MULTI_PROCESS"
    )
    if raw_value is None:
        return False

    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


class OpenBrowserAgentManager:
    """Manages agent instances and conversations with optional multi-process support.

    In multi-process mode, each conversation runs in its own process for isolation.
    In single-process mode (default), all conversations run in the main process.

    Attributes:
        multi_process_mode: If True, spawn processes for each conversation
        process_manager: ProcessManager instance for process lifecycle
        ipc_router: IPCRouter instance for command routing
    """

    def __init__(self, multi_process_mode: bool = False):
        """Initialize the agent manager.

        Args:
            multi_process_mode: If True, spawn processes for each conversation.
                               Default is False for backward compatibility.
        """
        self.conversations: Dict[str, ConversationState] = {}
        self.multi_process_mode = multi_process_mode

        # Multi-process infrastructure
        self._process_manager: Optional[ProcessManager] = None
        self._ipc_router: Optional[IPCRouter] = None

        if multi_process_mode:
            self._process_manager = ProcessManager()
            self._ipc_router = IPCRouter()
            logger.info("AgentManager initialized in multi-process mode")
        else:
            logger.info("AgentManager initialized in single-process mode")

        self.browser_tools = [
            Tool(name="tab"),  # Tab management
            Tool(name="highlight"),  # Element discovery with visual overlays
            Tool(name="element_interaction"),  # Click/input with 2PC, others direct
            Tool(name="dialog"),  # Browser dialog handling
        ]
        self.general_tools = [
            Tool(name=PLEASE_HELP_ME_TOOL_NAME),
            Tool(name=TerminalTool.name),  # Terminal access
            Tool(name=FileEditorTool.name),  # File editing
            Tool(name=TaskTrackerTool.name),  # Task tracking
        ]

    def _build_agent_context(self) -> AgentContext:
        """Create the shared AgentContext used for OpenBrowser conversations."""
        help_suffix = (
            "When you need a human to complete a manual step, do not only say it in "
            "assistant text. Call `please_help_me` with a concise, actionable "
            "message, then stop and wait for the user's next message. Use this for "
            "CAPTCHA, MFA, approvals, account-specific choices, or any step that "
            "requires the real human user."
        )
        return AgentContext(
            current_datetime=datetime.now(),
            system_message_suffix=help_suffix,
        )

    def _resolve_llm_settings(
        self,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        model_alias: Optional[str] = None,
    ) -> tuple[str, Optional[str], Any]:
        """Resolve effective LLM settings using overrides and persisted config."""
        llm_config = llm_config_manager.reload_config()
        selected_llm = llm_config_manager.get_llm_config(model_alias)
        model_to_use = model if model is not None else selected_llm.model
        base_url_to_use = base_url if base_url is not None else selected_llm.base_url
        return model_to_use, base_url_to_use, selected_llm

    def _get_tools_for_model(
        self, model: Optional[str] = None, model_alias: Optional[str] = None
    ) -> list[Tool]:
        """Return the tool list for a model tier."""
        self._resolve_llm_settings(model=model, model_alias=model_alias)
        return list(self.browser_tools) + list(self.general_tools)

    def _create_llm_from_config(
        self,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        model_alias: Optional[str] = None,
    ) -> LLM:
        """Create LLM configuration from config file with optional overrides."""
        model_to_use, base_url_to_use, llm_config = self._resolve_llm_settings(
            model=model, base_url=base_url, model_alias=model_alias
        )

        # Check if API key is configured
        if not llm_config.api_key:
            raise ValueError(
                "LLM API key is not configured. "
                "Please configure it through the web interface at http://localhost:8000/ "
                "Or use the API: POST /api/config/llm with {'api_key': 'your-key'}"
            )

        logger.info(
            f"Loading LLM configuration: model={model_to_use}, base_url={base_url_to_use}"
        )

        return LLM(
            usage_id="openbrowser-agent",
            model=model_to_use,
            base_url=base_url_to_use,
            api_key=SecretStr(llm_config.api_key),
        )

    def _get_system_prompt_kwargs(
        self,
        model: Optional[str] = None,
        model_alias: Optional[str] = None,
        routine_replay_mode: bool = False,
    ) -> dict[str, object]:
        """Build model-aware kwargs for the SDK system prompt template.

        ``routine_replay_mode`` is a fixed mode flag set at conversation
        creation time — not something the LLM judges from message content.
        When True, the Jinja template renders the <ROUTINE_REPLAY> block
        with the Routine keyword-unlock rules.
        """
        resolved_model, _, _ = self._resolve_llm_settings(
            model=model, model_alias=model_alias
        )
        small_model = is_small_model(resolved_model)

        return {
            "model_profile": get_model_profile(resolved_model),
            "small_model": small_model,
            "routine_replay_mode": routine_replay_mode,
        }

    def _build_session_metadata(
        self,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        browser_id: Optional[str] = None,
        model_alias: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> dict[str, Any]:
        """Build session metadata with resolved model settings.

        ``mode`` is an opaque conversation-mode tag stored verbatim in
        session metadata so every process that reads the session can see
        it. Today the only recognized value is ``"routine_replay"``.
        """
        resolved_model, resolved_base_url, _ = self._resolve_llm_settings(
            model=model, base_url=base_url, model_alias=model_alias
        )

        metadata: dict[str, Any] = {
            "model": resolved_model,
        }

        if resolved_base_url:
            metadata["base_url"] = resolved_base_url
        if model_alias:
            metadata["model_alias"] = model_alias
        if browser_id:
            metadata["browser_id"] = browser_id
        if mode:
            metadata["mode"] = mode

        return metadata

    @staticmethod
    def _is_routine_replay_mode(mode: Optional[str]) -> bool:
        """Map the opaque mode string to the routine-replay flag."""
        return mode == "routine_replay"

    def create_conversation(
        self,
        conversation_id: Optional[str] = None,
        cwd: str = ".",
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        browser_id: Optional[str] = None,
        model_alias: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> str:
        """Create a new conversation with session management

        Args:
            conversation_id: Optional conversation ID (auto-generated if None)
            cwd: Working directory for the conversation (default: current directory)
            model: Optional model name override (e.g., "dashscope/qwen3.5-plus")
            base_url: Optional base URL override
            mode: Optional conversation-mode tag. ``"routine_replay"``
                enables the routine-replay system prompt block and its
                keyword-unlock rules.

        Returns:
            The conversation ID

        Raises:
            ValueError: If conversation already exists
        """
        import uuid

        if conversation_id is None:
            conversation_id = str(uuid.uuid4())

        if conversation_id in self.conversations:
            raise ValueError(f"Conversation {conversation_id} already exists")

        # Create session in session manager with model metadata
        metadata = self._build_session_metadata(
            model=model,
            base_url=base_url,
            browser_id=browser_id,
            model_alias=model_alias,
            mode=mode,
        )

        session_manager.create_session(
            conversation_id=conversation_id,
            working_directory=cwd,
            metadata=metadata,
        )

        # In multi-process mode, spawn a process for this conversation
        if self.multi_process_mode:
            return self._create_conversation_process(
                conversation_id, cwd, model, base_url, browser_id, model_alias,
                mode=mode,
            )

        # Single-process mode: create conversation in main process
        return self._create_conversation_in_process(
            conversation_id, cwd, model, base_url, browser_id, model_alias,
            mode=mode,
        )

    def _create_conversation_in_process(
        self,
        conversation_id: str,
        cwd: str,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        browser_id: Optional[str] = None,
        model_alias: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> str:
        """Create a conversation in the current process (single-process mode).

        Args:
            conversation_id: Conversation ID
            cwd: Working directory
            mode: Conversation-mode tag (e.g. ``"routine_replay"``).

        Returns:
            The conversation ID
        """
        # Create agent with tools
        agent_context = self._build_agent_context()
        llm_instance = self._create_llm_from_config(model, base_url, model_alias)
        tools = self._get_tools_for_model(model, model_alias)
        tool_image_window = get_context_image_window()
        condenser_llm = llm_instance.model_copy(update={"usage_id": "condenser"})
        agent = Agent(
            llm=llm_instance,
            tools=tools,
            condenser=configure_browser_condenser(
                get_default_condenser(
                    llm=condenser_llm,
                ),
                llm_instance,
            ),
            agent_context=agent_context,
            system_prompt_kwargs=self._get_system_prompt_kwargs(
                model=model,
                model_alias=model_alias,
                routine_replay_mode=self._is_routine_replay_mode(mode),
            ),
            tool_image_window=tool_image_window,
        )

        # Create visualizer (queue will be set when processing messages)
        visualizer = QueueVisualizer()

        # Create conversation with specified workspace and conversation_id
        # Note: SDK expects UUID object, not string
        conv_uuid = (
            uuid.UUID(conversation_id)
            if isinstance(conversation_id, str)
            else conversation_id
        )
        conversation = Conversation(
            agent=agent,
            visualizer=visualizer,
            workspace=cwd,
            persistence_dir=str(Path.home() / ".openbrowser" / "conversations"),
            conversation_id=conv_uuid,
        )

        # Store conversation state
        self.conversations[conversation_id] = ConversationState(
            conversation_id=conversation_id,
            conversation=conversation,
            visualizer=visualizer,
        )

        # Set conversation_id on visualizer for event persistence
        visualizer.set_conversation_id(conversation_id)

        logger.info(f"Created conversation in main process: {conversation_id}")
        return conversation_id

    def _create_conversation_process(
        self,
        conversation_id: str,
        cwd: str,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        browser_id: Optional[str] = None,
        model_alias: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> str:
        """Create a conversation in a separate process (multi-process mode).

        This method spawns a new process for the conversation using ProcessManager
        and registers the IPC queues with IPCRouter.

        Args:
            conversation_id: Conversation ID
            cwd: Working directory
            mode: Conversation-mode tag. Worker reads it from session
                metadata (shared SQLite) when it spins up its own
                AgentManager, so no IPC plumbing is needed here — this
                param is retained for signature consistency.

        Returns:
            The conversation ID

        Raises:
            RuntimeError: If ProcessManager or IPCRouter not initialized
        """
        if self._process_manager is None or self._ipc_router is None:
            raise RuntimeError(
                "ProcessManager or IPCRouter not initialized. "
                "Ensure multi_process_mode is enabled."
            )

        # Use the bound browser ID if provided; otherwise fall back for compatibility.
        browser_id = browser_id or str(uuid.uuid4())

        # Get LLM config for the worker process
        model_to_use, base_url_to_use, llm_config = self._resolve_llm_settings(
            model=model, base_url=base_url, model_alias=model_alias
        )
        llm_config_dict = {
            "model": model_to_use,
            "api_key": llm_config.api_key,
            "base_url": base_url_to_use,
        }

        # Spawn process with configuration
        self._process_manager.spawn_with_config(
            conv_id=conversation_id,
            browser_id=browser_id,
            llm_config=llm_config_dict,
            working_directory=cwd,
        )

        # Get process info for IPC queues
        process_info = self._process_manager.get_process_info(conversation_id)
        if process_info is None:
            raise RuntimeError(
                f"Failed to get process info for conversation {conversation_id}"
            )

        # Check that queues are available
        if process_info.command_queue is None or process_info.response_queue is None:
            raise RuntimeError(
                f"IPC queues not available for conversation {conversation_id}"
            )

        # Register with IPC router
        self._ipc_router.register_conversation(
            conv_id=conversation_id,
            command_queue=process_info.command_queue,
            response_queue=process_info.response_queue,
        )

        # Store minimal conversation state (no Conversation object in main process)
        self.conversations[conversation_id] = ConversationState(
            conversation_id=conversation_id,
            conversation=None,  # No Conversation object in main process
            visualizer=None,  # No visualizer in main process
        )

        logger.info(
            f"Created conversation process: {conversation_id}, browser_id={browser_id}"
        )
        return conversation_id

    def get_conversation(self, conversation_id: str) -> Optional[ConversationState]:
        """Get conversation by ID"""
        return self.conversations.get(conversation_id)

    def get_or_create_conversation(
        self,
        conversation_id: str,
        cwd: str = ".",
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        model_alias: Optional[str] = None,
    ) -> ConversationState:
        """Get existing conversation or create a new one with the given ID

        Args:
            conversation_id: Conversation ID to get or create
            cwd: Working directory for the conversation (default: current directory)
            model: Optional model name override (e.g., "dashscope/qwen3.5-plus")
            base_url: Optional base URL override

        Returns:
            ConversationState
        """
        conv_state = self.get_conversation(conversation_id)
        if conv_state:
            return conv_state

        # Conversation doesn't exist, create it
        if conversation_id in self.conversations:
            # Race condition: conversation was just created by another thread
            return self.conversations[conversation_id]

        browser_id: Optional[str] = None
        mode: Optional[str] = None

        # Check if session exists and has model metadata
        existing_session = session_manager.get_session(conversation_id)
        if existing_session:
            # Use model from existing session metadata if available
            session_model = existing_session.metadata.get("model")
            session_base_url = existing_session.metadata.get("base_url")
            session_model_alias = existing_session.metadata.get("model_alias")
            session_browser_id = existing_session.metadata.get("browser_id")
            session_mode = existing_session.metadata.get("mode")

            # If model was not provided as parameter, use session model
            if model is None and session_model:
                model = session_model
            if base_url is None and session_base_url:
                base_url = session_base_url
            if model_alias is None and session_model_alias:
                model_alias = session_model_alias
            if isinstance(session_browser_id, str) and session_browser_id:
                browser_id = session_browser_id
            if isinstance(session_mode, str) and session_mode:
                mode = session_mode

            metadata = existing_session.metadata.copy()
            resolved_metadata = self._build_session_metadata(
                model=model,
                base_url=base_url,
                browser_id=browser_id,
                model_alias=model_alias,
                mode=mode,
            )
            for key, value in resolved_metadata.items():
                metadata.setdefault(key, value)

            if metadata != existing_session.metadata:
                session_manager.update_session_metadata(conversation_id, metadata)

            model = metadata.get("model", model)
            base_url = metadata.get("base_url", base_url)
            model_alias = metadata.get("model_alias", model_alias)
            mode = metadata.get("mode", mode)
        else:
            # Create new session with model metadata
            metadata = self._build_session_metadata(
                model=model,
                base_url=base_url,
                browser_id=browser_id,
                model_alias=model_alias,
                mode=mode,
            )

            session_manager.create_session(
                conversation_id=conversation_id,
                working_directory=cwd,
                metadata=metadata,
            )

        if self.multi_process_mode:
            self._create_conversation_process(
                conversation_id,
                cwd,
                model=model,
                base_url=base_url,
                browser_id=browser_id,
                model_alias=model_alias,
                mode=mode,
            )
            return self.conversations[conversation_id]

        # Create new conversation with the given ID
        # Create agent with tools
        agent_context = self._build_agent_context()
        llm_instance = self._create_llm_from_config(model, base_url, model_alias)
        tools = self._get_tools_for_model(model, model_alias)
        tool_image_window = get_context_image_window()
        condenser_llm = llm_instance.model_copy(update={"usage_id": "condenser"})
        agent = Agent(
            llm=llm_instance,
            tools=tools,
            condenser=configure_browser_condenser(
                get_default_condenser(
                    llm=condenser_llm,
                ),
                llm_instance,
            ),
            agent_context=agent_context,
            system_prompt_kwargs=self._get_system_prompt_kwargs(
                model=model,
                model_alias=model_alias,
                routine_replay_mode=self._is_routine_replay_mode(mode),
            ),
            tool_image_window=tool_image_window,
        )

        # Create visualizer (queue will be set when processing messages)
        visualizer = QueueVisualizer()

        # Create conversation with specified workspace and conversation_id
        # Note: SDK expects UUID object, not string
        conv_uuid = (
            uuid.UUID(conversation_id)
            if isinstance(conversation_id, str)
            else conversation_id
        )
        conversation = Conversation(
            agent=agent,
            visualizer=visualizer,
            workspace=cwd,
            persistence_dir=str(Path.home() / ".openbrowser" / "conversations"),
            conversation_id=conv_uuid,
        )

        # Store conversation state
        self.conversations[conversation_id] = ConversationState(
            conversation_id=conversation_id,
            conversation=conversation,
            visualizer=visualizer,
        )

        # Set conversation_id on visualizer for event persistence
        visualizer.set_conversation_id(conversation_id)

        logger.info(f"Created new conversation with ID: {conversation_id}")
        return self.conversations[conversation_id]

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation and cleanup resources.

        In multi-process mode, this will shutdown the conversation process.
        In single-process mode, this will close the conversation in the main process.

        Args:
            conversation_id: Conversation ID to delete

        Returns:
            True if conversation was deleted, False otherwise
        """
        if conversation_id not in self.conversations:
            # Also try to delete from session manager even if not in memory
            success = session_manager.delete_session(conversation_id)
            if success:
                logger.info(f"Deleted session from database: {conversation_id}")
            return success

        conv_state = self.conversations[conversation_id]

        # In multi-process mode, shutdown the process
        if self.multi_process_mode:
            self._delete_conversation_process(conversation_id)
        else:
            # Single-process mode: close conversation in main process
            try:
                if conv_state.conversation is not None:
                    conv_state.conversation.close()
            except Exception as e:
                logger.warning(f"Error closing conversation {conversation_id}: {e}")

            # Cleanup command processor state
            from server.core.processor import command_processor

            command_processor.cleanup_conversation(conversation_id)

        # Remove from memory
        del self.conversations[conversation_id]

        # Update session status to completed
        session_manager.update_session_status(conversation_id, SessionStatus.COMPLETED)

        # Cleanup shared browser executor for this conversation
        try:
            remove_browser_executor(conversation_id)
        except Exception as e:
            logger.warning(
                f"Failed to remove browser executor for {conversation_id}: {e}"
            )

        logger.info(f"Deleted conversation: {conversation_id}")
        return True

    def _delete_conversation_process(self, conversation_id: str) -> None:
        """Shutdown a conversation process (multi-process mode).

        This method shuts down the process via ProcessManager and unregisters
        the IPC queues from IPCRouter.

        Args:
            conversation_id: Conversation ID to delete
        """
        if self._process_manager is None or self._ipc_router is None:
            logger.warning(
                f"Cannot delete process for {conversation_id}: "
                "ProcessManager or IPCRouter not initialized"
            )
            return

        # Unregister from IPC router first
        self._ipc_router.unregister_conversation(conversation_id)

        # Shutdown the process
        try:
            self._process_manager.shutdown_process(conversation_id)
            logger.info(f"Shutdown process for conversation: {conversation_id}")
        except KeyError:
            logger.warning(
                f"Process not found for conversation {conversation_id}, "
                "may have already been terminated"
            )
        except Exception as e:
            logger.error(f"Error shutting down process for {conversation_id}: {e}")

    def list_conversations(self, status: SessionStatus = None) -> List[Dict[str, Any]]:
        """List all conversations with enhanced session info

        Args:
            status: Optional status filter (active, idle, error, completed)
        """
        # Get in-memory conversations
        memory_conversations = {}
        for conv in self.conversations.values():
            memory_conversations[conv.conversation_id] = {
                "id": conv.conversation_id,
                "created_at": conv.created_at,
                "agent_id": (
                    id(conv.conversation.agent)
                    if conv.conversation is not None
                    else None
                ),
                "in_memory": True,
            }

        # Get persisted sessions
        persisted_sessions = session_manager.list_sessions(status=status)

        # Merge information
        result = []
        for session in persisted_sessions:
            conv_id = session.conversation_id
            session_dict = session.to_dict()
            if conv_id in memory_conversations:
                # Merge in-memory and persisted data
                merged = memory_conversations[conv_id].copy()
                merged.update(
                    {
                        "status": session.status.value,
                        "message_count": session.message_count,
                        "last_message_at": (
                            session.last_message_at.isoformat()
                            if session.last_message_at
                            else None
                        ),
                        "working_directory": session.working_directory,
                        "tags": session.tags,
                        "first_user_message": session.first_user_message,
                    }
                )
                result.append(merged)
            else:
                # Only persisted data (conversation not in memory)
                result.append(
                    {
                        "id": session.conversation_id,
                        "status": session.status.value,
                        "created_at": session.created_at.timestamp(),
                        "updated_at": session.updated_at.isoformat(),
                        "message_count": session.message_count,
                        "last_message_at": (
                            session.last_message_at.isoformat()
                            if session.last_message_at
                            else None
                        ),
                        "working_directory": session.working_directory,
                        "tags": session.tags,
                        "first_user_message": session.first_user_message,
                        "in_memory": False,
                    }
                )

        return result

    async def process_message(
        self, conversation_id: str, message_text: str, event_callback: callable = None
    ) -> AsyncGenerator[SSEEvent, None]:
        """Process a user message and stream events with session tracking"""
        conv_state = self.get_conversation(conversation_id)
        if not conv_state:
            raise ValueError(f"Conversation {conversation_id} not found")

        # Update session status to active
        session_manager.update_session_status(
            conversation_id, SessionStatus.ACTIVE, increment_message_count=True
        )

        # Save user message for history
        try:
            session_manager.save_user_message(
                conversation_id=conversation_id, message_text=message_text
            )
        except Exception as e:
            logger.warning(f"Failed to save user message: {e}")

        # Set event callback on visualizer
        conv_state.visualizer.event_callback = event_callback

        try:
            # Send user message
            conv_state.conversation.send_message(message_text)

            # Run conversation (this will trigger visualizer callbacks)
            await conv_state.conversation.run_async()

            # Update session status to idle after successful completion
            session_manager.update_session_status(conversation_id, SessionStatus.IDLE)

            # Yield completion event
            yield SSEEvent("complete", {"conversation_id": conversation_id})

        except Exception as e:
            logger.error(f"Error processing message: {e}")

            # Update session status to error
            session_manager.update_session_status(conversation_id, SessionStatus.ERROR)

            yield SSEEvent(
                "error", {"conversation_id": conversation_id, "error": str(e)}
            )

        finally:
            # Clear callback
            if conv_state.visualizer is not None:
                conv_state.visualizer.event_callback = None

    # ==================== Multi-Process IPC Methods ====================

    def route_command(
        self,
        conversation_id: str,
        command: dict[str, Any],
        command_id: Optional[str] = None,
    ) -> bool:
        """Route a command to a conversation process via IPC.

        This method is used in multi-process mode to send commands to
        conversation worker processes.

        Args:
            conversation_id: Target conversation ID
            command: Command dictionary to route
            command_id: Optional command ID for tracking

        Returns:
            True if command was routed successfully, False otherwise

        Raises:
            RuntimeError: If not in multi-process mode
        """
        if not self.multi_process_mode or self._ipc_router is None:
            raise RuntimeError(
                "route_command() requires multi_process_mode to be enabled"
            )

        browser_id = self._get_browser_id(conversation_id)
        if browser_id is None:
            logger.warning(f"Cannot route command: no browser_id for {conversation_id}")
            return False

        message = BrowserCommandMessage(
            conversation_id=conversation_id,
            browser_id=browser_id,
            command=command,
            command_id=command_id,
        )

        return self._ipc_router.route_command(message)

    def request_pause(self, conversation_id: str) -> bool:
        """Request that a conversation pause without blocking the caller.

        In single-process mode the actual ``conversation.pause()`` call is moved
        to a background thread so the HTTP event loop never blocks waiting on
        OpenHands' internal conversation lock.

        In multi-process mode a pause control message is queued for the worker.
        The worker can only observe it after the current turn returns to its
        command loop, but the main process remains responsive.
        """
        if self.multi_process_mode:
            try:
                command_queue = self.get_command_queue(conversation_id)
            except RuntimeError:
                return False

            if command_queue is None:
                return False

            command_queue.put({"control": "pause"})
            logger.info("Queued pause request for conversation %s", conversation_id)
            return True

        conv_state = self.conversations.get(conversation_id)
        if conv_state is None or conv_state.conversation is None:
            return False

        pause_thread = threading.Thread(
            target=self._pause_conversation_blocking,
            args=(conv_state.conversation, conversation_id),
            name=f"pause-{conversation_id[:8]}",
            daemon=True,
        )
        pause_thread.start()
        logger.info(
            "Started background pause request for conversation %s", conversation_id
        )
        return True

    @staticmethod
    def _pause_conversation_blocking(
        conversation: Conversation, conversation_id: str
    ) -> None:
        """Run the blocking ``conversation.pause()`` call off the event loop."""
        try:
            conversation.pause()
            logger.info("Conversation %s paused successfully", conversation_id)
        except Exception as e:
            logger.warning(
                "Failed to pause conversation %s in background thread: %s",
                conversation_id,
                e,
            )

    def get_response_queue(self, conversation_id: str):
        """Get the response queue for a conversation.

        Args:
            conversation_id: Conversation ID

        Returns:
            Response queue if found, None otherwise

        Raises:
            RuntimeError: If not in multi-process mode
        """
        if not self.multi_process_mode or self._ipc_router is None:
            raise RuntimeError(
                "get_response_queue() requires multi_process_mode to be enabled"
            )

        return self._ipc_router.get_response_queue(conversation_id)

    def get_command_queue(self, conversation_id: str):
        """Get the command queue for a conversation.

        Args:
            conversation_id: Conversation ID

        Returns:
            Command queue if found, None otherwise

        Raises:
            RuntimeError: If not in multi-process mode
        """
        if not self.multi_process_mode or self._ipc_router is None:
            raise RuntimeError(
                "get_command_queue() requires multi_process_mode to be enabled"
            )

        return self._ipc_router.get_command_queue(conversation_id)

    def is_process_alive(self, conversation_id: str) -> bool:
        """Check if a conversation process is alive.

        Args:
            conversation_id: Conversation ID

        Returns:
            True if process is alive, False otherwise
        """
        if not self.multi_process_mode or self._process_manager is None:
            return False

        return self._process_manager.is_process_alive(conversation_id)

    def get_process_status(self, conversation_id: str) -> Optional[str]:
        """Get the status of a conversation process.

        Args:
            conversation_id: Conversation ID

        Returns:
            Status string if process exists, None otherwise
        """
        if not self.multi_process_mode or self._process_manager is None:
            return None

        return self._process_manager.get_process_status(conversation_id)

    def _get_browser_id(self, conversation_id: str) -> Optional[str]:
        """Get the browser ID for a conversation.

        Args:
            conversation_id: Conversation ID

        Returns:
            Browser ID if found, None otherwise
        """
        if self._process_manager is None:
            return None

        process_info = self._process_manager.get_process_info(conversation_id)
        if process_info is None:
            return None

        return process_info.browser_id


# Global agent manager instance
agent_manager = OpenBrowserAgentManager(
    multi_process_mode=_multi_process_mode_from_env()
)
