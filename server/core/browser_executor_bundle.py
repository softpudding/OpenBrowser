"""
BrowserExecutorBundle - Encapsulates AgentManager and CommandProcessor for worker processes.

This module provides a unified interface for browser automation in conversation
worker processes. The bundle encapsulates:
- AgentManager: LLM interaction and conversation state
- CommandProcessor: Browser command routing

The bundle is designed to be picklable for multiprocessing, storing configuration
and recreating objects during initialization.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from server.agent.manager import OpenBrowserAgentManager
from server.core.processor import CommandProcessor
from server.models.commands import parse_command, CommandResponse

logger = logging.getLogger(__name__)


@dataclass
class BundleState:
    """State tracking for BrowserExecutorBundle.

    Attributes:
        initialized: Whether the bundle has been initialized
        conversation_created: Whether a conversation has been created
        error: Last error message if any
    """

    initialized: bool = False
    conversation_created: bool = False
    error: Optional[str] = None


class BrowserExecutorBundle:
    """Encapsulates AgentManager and CommandProcessor for worker processes.

    This bundle provides a unified interface for browser automation in
    conversation worker processes. It is designed to be picklable for
    multiprocessing by storing configuration and recreating objects
    during initialization.

    Usage:
        bundle = BrowserExecutorBundle(
            conv_id="conv-123",
            browser_id="browser-456",
            llm_config={"model": "qwen3.5-plus", "api_key": "..."}
        )
        await bundle.initialize()
        result = await bundle.execute_command({"type": "screenshot"})
        await bundle.shutdown()

    Attributes:
        conversation_id: UUID identifying the conversation session
        browser_id: UUID identifying the browser instance
        llm_config: LLM configuration dictionary
        working_directory: Working directory for the conversation
        state: Current bundle state
    """

    def __init__(
        self,
        conv_id: str,
        browser_id: str,
        llm_config: dict[str, Any],
        working_directory: str = ".",
    ):
        """Initialize the BrowserExecutorBundle.

        Args:
            conv_id: UUID identifying the conversation session
            browser_id: UUID identifying the browser instance
            llm_config: LLM configuration dictionary with keys:
                - model: Model name (e.g., "qwen3.5-plus")
                - api_key: API key for the model
                - base_url: Optional base URL for the API
            working_directory: Working directory for the conversation
        """
        self.conversation_id = conv_id
        self.browser_id = browser_id
        self.llm_config = llm_config
        self.working_directory = working_directory
        self.state = BundleState()

        # These are created during initialize() and are NOT pickled
        self._agent_manager: Optional[OpenBrowserAgentManager] = None
        self._command_processor: Optional[CommandProcessor] = None

    def __getstate__(self) -> dict[str, Any]:
        """Custom pickle serialization - exclude non-picklable objects.

        Returns:
            State dictionary with only picklable attributes
        """
        return {
            "conversation_id": self.conversation_id,
            "browser_id": self.browser_id,
            "llm_config": self.llm_config,
            "working_directory": self.working_directory,
            "state": self.state,
        }

    def __setstate__(self, state: dict[str, Any]) -> None:
        """Custom pickle deserialization - restore picklable attributes.

        Args:
            state: State dictionary from __getstate__
        """
        self.conversation_id = state["conversation_id"]
        self.browser_id = state["browser_id"]
        self.llm_config = state["llm_config"]
        self.working_directory = state["working_directory"]
        self.state = state["state"]

        # Reset non-pickled attributes
        self._agent_manager = None
        self._command_processor = None

    async def initialize(self) -> bool:
        """Initialize the bundle by creating AgentManager and CommandProcessor.

        This method creates fresh instances of AgentManager and CommandProcessor
        for use in the worker process. It also creates a conversation in the
        AgentManager.

        Returns:
            True if initialization was successful, False otherwise
        """
        if self.state.initialized:
            logger.warning(
                f"BrowserExecutorBundle[{self.conversation_id}]: Already initialized"
            )
            return True

        try:
            # Create fresh instances
            self._agent_manager = OpenBrowserAgentManager()
            self._command_processor = CommandProcessor()

            # Create conversation in agent manager
            self._agent_manager.create_conversation(
                conversation_id=self.conversation_id,
                cwd=self.working_directory,
                browser_id=self.browser_id,
            )

            self.state.initialized = True
            self.state.conversation_created = True
            self.state.error = None

            logger.info(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                "Initialized successfully"
            )
            return True

        except Exception as e:
            self.state.error = str(e)
            logger.error(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                f"Initialization failed: {e}"
            )
            return False

    async def execute_command(self, command: dict[str, Any]) -> dict[str, Any]:
        """Execute a browser command.

        This method routes the command through CommandProcessor for execution.
        The command must have a 'type' field indicating the command type.

        Args:
            command: Command dictionary with at minimum a 'type' field.
                Example: {"type": "screenshot", "conversation_id": "conv-123"}

        Returns:
            Response dictionary with:
                - success: bool indicating if command succeeded
                - data: Optional result data
                - error: Optional error message

        Raises:
            RuntimeError: If bundle is not initialized
        """
        if not self.state.initialized:
            raise RuntimeError(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                "Cannot execute command - bundle not initialized"
            )

        if self._command_processor is None:
            raise RuntimeError(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                "CommandProcessor not available"
            )

        try:
            # Ensure conversation_id is set in command
            if "conversation_id" not in command:
                command["conversation_id"] = self.conversation_id
            if "browser_id" not in command:
                command["browser_id"] = self.browser_id

            # Parse command to validate and create proper type
            parsed_command = parse_command(command)

            # Execute through command processor
            response: CommandResponse = await self._command_processor.execute(
                parsed_command
            )

            # Convert response to dict
            return {
                "success": response.success,
                "data": response.data,
                "error": response.error,
                "command_id": response.command_id,
                "message": response.message,
            }

        except Exception as e:
            logger.error(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                f"Command execution failed: {e}"
            )
            return {
                "success": False,
                "error": str(e),
                "data": None,
            }

    async def shutdown(self) -> bool:
        """Shutdown the bundle and cleanup resources.

        This method cleans up the conversation in AgentManager and
        resets the bundle state.

        Returns:
            True if shutdown was successful, False otherwise
        """
        if not self.state.initialized:
            logger.debug(
                f"BrowserExecutorBundle[{self.conversation_id}]: "
                "Not initialized, nothing to shutdown"
            )
            return True

        try:
            # Cleanup conversation in agent manager
            if self._agent_manager is not None and self.state.conversation_created:
                self._agent_manager.delete_conversation(self.conversation_id)

            # Cleanup command processor state
            if self._command_processor is not None:
                self._command_processor.cleanup_conversation(self.conversation_id)

            # Reset state
            self.state.initialized = False
            self.state.conversation_created = False
            self.state.error = None

            # Clear references
            self._agent_manager = None
            self._command_processor = None

            logger.info(
                f"BrowserExecutorBundle[{self.conversation_id}]: Shutdown completed"
            )
            return True

        except Exception as e:
            self.state.error = str(e)
            logger.error(
                f"BrowserExecutorBundle[{self.conversation_id}]: Shutdown failed: {e}"
            )
            return False

    def is_initialized(self) -> bool:
        """Check if the bundle is initialized.

        Returns:
            True if initialized, False otherwise
        """
        return self.state.initialized

    def get_state_dict(self) -> dict[str, Any]:
        """Get the current state as a dictionary.

        Returns:
            Dictionary with current state information
        """
        return {
            "conversation_id": self.conversation_id,
            "browser_id": self.browser_id,
            "initialized": self.state.initialized,
            "conversation_created": self.state.conversation_created,
            "error": self.state.error,
        }
