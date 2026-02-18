import asyncio
import logging
import json
from typing import Dict, Optional, Any, List
from datetime import datetime

from server.models.commands import (
    Command, CommandResponse, parse_command,
    MouseMoveCommand, MouseClickCommand, MouseScrollCommand,
    ResetMouseCommand,
    KeyboardTypeCommand, KeyboardPressCommand, ScreenshotCommand,
    TabCommand, GetTabsCommand
)
from server.websocket.manager import ws_manager
from server.core.coordinates import coord_manager
from server.core.config import config


logger = logging.getLogger(__name__)


class CommandProcessor:
    """Processes and executes commands"""
    
    def __init__(self):
        self._current_tab_id: Optional[int] = None
    
    def _prepare_command_dict(self, command: Command) -> dict:
        """
        Prepare command dictionary for sending to extension.
        Adds tab_id if not specified and current tab is set.
        """
        command_dict = command.dict()
        
        # Import command types for type checking
        from server.models.commands import (
            TabCommand, GetTabsCommand, ScreenshotCommand,
            MouseMoveCommand, MouseClickCommand, MouseScrollCommand,
            ResetMouseCommand, KeyboardTypeCommand, KeyboardPressCommand
        )
        
        # Check if we should auto-fill tab_id
        should_fill_tab_id = False
        
        if hasattr(command, 'tab_id') and command.tab_id is None and self._current_tab_id is not None:
            # Check command type to decide if we should fill tab_id
            if isinstance(command, TabCommand):
                # For tab commands, only fill tab_id for certain actions
                # init and open create new tabs - don't fill
                # close and switch need specific tab_id - don't fill if not specified
                # list gets all tabs - don't fill
                # So generally don't auto-fill for TabCommand
                should_fill_tab_id = False
            elif isinstance(command, GetTabsCommand):
                # GetTabsCommand gets all tabs, doesn't need tab_id
                should_fill_tab_id = False
            else:
                # For other commands (mouse, keyboard, screenshot, reset_mouse)
                # auto-fill tab_id to target current managed tab
                should_fill_tab_id = True
        
        if should_fill_tab_id:
            command_dict['tab_id'] = self._current_tab_id
            logger.debug(f"Auto-filled tab_id {self._current_tab_id} for {command.type} command")
            
        return command_dict
    
    async def _send_prepared_command(self, command: Command) -> CommandResponse:
        """
        Send a command to extension after preparing it with current tab ID.
        """
        prepared_dict = self._prepare_command_dict(command)
        # Parse back to Command to ensure validation
        from server.models.commands import parse_command
        prepared_command = parse_command(prepared_dict)
        return await ws_manager.send_command(prepared_command)
        
    async def execute(self, command: Command) -> CommandResponse:
        """
        Execute a command
        
        Args:
            command: The command to execute
            
        Returns:
            CommandResponse with execution result
        """
        logger.info(f"Executing command: {command.type}")
        
        try:
            # Route to appropriate handler based on command type
            if isinstance(command, MouseMoveCommand):
                return await self._execute_mouse_move(command)
            elif isinstance(command, MouseClickCommand):
                return await self._execute_mouse_click(command)
            elif isinstance(command, MouseScrollCommand):
                return await self._execute_mouse_scroll(command)
            elif isinstance(command, KeyboardTypeCommand):
                return await self._execute_keyboard_type(command)
            elif isinstance(command, KeyboardPressCommand):
                return await self._execute_keyboard_press(command)
            elif isinstance(command, ScreenshotCommand):
                return await self._execute_screenshot(command)
            elif isinstance(command, TabCommand):
                return await self._execute_tab_command(command)
            elif isinstance(command, GetTabsCommand):
                return await self._execute_get_tabs(command)
            elif isinstance(command, ResetMouseCommand):
                return await self._execute_reset_mouse(command)
            else:
                raise ValueError(f"Unknown command type: {command.type}")
                
        except Exception as e:
            logger.error(f"Error executing command {command.type}: {e}")
            return CommandResponse(
                success=False,
                command_id=getattr(command, 'command_id', None),
                error=str(e)
            )
            
    async def _execute_mouse_move(self, command: MouseMoveCommand) -> CommandResponse:
        """Execute mouse move command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_mouse_click(self, command: MouseClickCommand) -> CommandResponse:
        """Execute mouse click command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_mouse_scroll(self, command: MouseScrollCommand) -> CommandResponse:
        """Execute mouse scroll command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_keyboard_type(self, command: KeyboardTypeCommand) -> CommandResponse:
        """Execute keyboard type command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_keyboard_press(self, command: KeyboardPressCommand) -> CommandResponse:
        """Execute keyboard press command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_screenshot(self, command: ScreenshotCommand) -> CommandResponse:
        """Execute screenshot command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_tab_command(self, command: TabCommand) -> CommandResponse:
        """Execute tab management command"""
        response = await self._send_prepared_command(command)
        
        # Update current tab based on action
        if response.success:
            if command.action == "switch" and command.tab_id:
                self._current_tab_id = command.tab_id
            elif command.action == "init":
                # For init action, update current tab to the newly created tab
                if response.data and 'tabId' in response.data:
                    self._current_tab_id = response.data['tabId']
                elif response.data and 'tab_id' in response.data:
                    self._current_tab_id = response.data['tab_id']
            elif command.action == "open":
                # For open action, update current tab to the newly opened tab
                if response.data and 'tabId' in response.data:
                    self._current_tab_id = response.data['tabId']
                elif response.data and 'tab_id' in response.data:
                    self._current_tab_id = response.data['tab_id']
            
        return response
        
    async def _execute_get_tabs(self, command: GetTabsCommand) -> CommandResponse:
        """Execute get tabs command"""
        response = await self._send_prepared_command(command)
        return response
        
    async def _execute_reset_mouse(self, command: ResetMouseCommand) -> CommandResponse:
        """Execute reset mouse command"""
        response = await self._send_prepared_command(command)
        return response
        
    def set_current_tab(self, tab_id: int):
        """Set current active tab ID"""
        self._current_tab_id = tab_id
        
    def get_current_tab(self) -> Optional[int]:
        """Get current active tab ID"""
        return self._current_tab_id
        
    async def health_check(self) -> bool:
        """Check if command processor is healthy"""
        try:
            # First check if any WebSocket connection exists
            if ws_manager.is_connected():
                # If independent WebSocket server has connections, test with a command
                command = GetTabsCommand()
                response = await self.execute(command)
                return response.success
            else:
                # No WebSocket connections via independent server
                # This could mean extension is connecting via FastAPI WebSocket endpoint
                # or no extension is connected yet
                # Return True to allow server to keep running
                # The /health endpoint will return 200 but with websocket_connected: false
                # This allows the server to be accessible even if extension isn't connected yet
                return True
                
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False


# Global command processor instance
command_processor = CommandProcessor()