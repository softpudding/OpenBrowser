"""
OpenBrowserToolSet - Aggregates all 4 OpenBrowser tools into a unified toolset.

This module provides the OpenBrowserToolSet class that creates and manages
all 4 focused OpenBrowser tools with a shared executor for state consistency.

Following the OpenHands SDK ToolSet pattern from browser_use.definition.BrowserToolSet.
"""

from collections.abc import Sequence
from typing import Optional

from openhands.sdk.tool import ToolDefinition

from server.agent.tools.browser_executor import BrowserExecutor
from server.agent.tools.dialog_tool import DialogTool
from server.agent.tools.element_interaction_tool import ElementInteractionTool
from server.agent.tools.highlight_tool import HighlightTool
from server.agent.tools.tab_tool import TabTool


class OpenBrowserToolSet(ToolDefinition):
    """Aggregates all 4 OpenBrowser tools with shared executor.

    This toolset provides a unified interface for registering all OpenBrowser
    tools while ensuring they share the same executor instance. This is critical
    for selective 2PC flows where ElementInteractionTool needs shared
    pending_confirmations state.

    Tools included:
        - TabTool: Browser tab management (init, open, close, switch, list, refresh, view)
        - HighlightTool: Element discovery with collision-free visual overlays
        - ElementInteractionTool: Click/input with 2PC, hover/scroll/swipe/select direct
        - DialogTool: Browser dialog (alert/confirm/prompt/beforeunload) handling

    Example:
        >>> tools = OpenBrowserToolSet.create(None)
        >>> len(tools)
        4
        >>> [tool.name for tool in tools]
        ['tab', 'highlight', 'element_interaction', 'dialog']
    """

    @classmethod
    def create(
        cls,
        conv_state,
        executor: Optional[BrowserExecutor] = None,
    ) -> Sequence[ToolDefinition]:
        """Create all 4 OpenBrowser tools with shared executor.

        Args:
            executor: Optional BrowserExecutor instance for handling commands.
                     If None, each tool will have None as executor (set during
                     registration in production use).

        Returns:
            List of 4 ToolDefinition instances (TabTool, HighlightTool,
            ElementInteractionTool, DialogTool), all sharing the same executor
            instance.

        Note:
            The executor must be shared across all tools to enable:
            - Shared pending confirmation state for 2PC actions
            - Conversation isolation (conversation_id → tab_id mapping)
            - Consistent state management across all operations
        """
        # Each tool.create() returns a Sequence[Self], so we flatten the results
        tools: list[ToolDefinition] = []

        # Create shared executor if not provided
        if executor is None:
            executor = BrowserExecutor()

        # Create tools in a consistent order with shared executor
        for tool_class in [
            TabTool,
            HighlightTool,
            ElementInteractionTool,
            DialogTool,
        ]:
            tools.extend(tool_class.create(conv_state, executor))

        return tools
