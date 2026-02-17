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
        # For relative movement, we need to handle coordinate mapping
        # The extension will handle the actual movement based on relative coordinates
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_mouse_click(self, command: MouseClickCommand) -> CommandResponse:
        """Execute mouse click command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_mouse_scroll(self, command: MouseScrollCommand) -> CommandResponse:
        """Execute mouse scroll command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_keyboard_type(self, command: KeyboardTypeCommand) -> CommandResponse:
        """Execute keyboard type command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_keyboard_press(self, command: KeyboardPressCommand) -> CommandResponse:
        """Execute keyboard press command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_screenshot(self, command: ScreenshotCommand) -> CommandResponse:
        """Execute screenshot command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_tab_command(self, command: TabCommand) -> CommandResponse:
        """Execute tab management command"""
        response = await ws_manager.send_command(command)
        
        # Update current tab if we switched to a new one
        if command.action == "switch" and command.tab_id and response.success:
            self._current_tab_id = command.tab_id
            
        return response
        
    async def _execute_get_tabs(self, command: GetTabsCommand) -> CommandResponse:
        """Execute get tabs command"""
        response = await ws_manager.send_command(command)
        return response
        
    async def _execute_reset_mouse(self, command: ResetMouseCommand) -> CommandResponse:
        """Execute reset mouse command"""
        response = await ws_manager.send_command(command)
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