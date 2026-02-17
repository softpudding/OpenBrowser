#!/usr/bin/env python3
"""
Interactive CLI for Local Chrome Server
"""

import click
import json
import requests
import sys
import time
from typing import Optional, Dict, Any
import os

# Default server URL
DEFAULT_SERVER_URL = "http://127.0.0.1:8765"


class ChromeCLIClient:
    """Client for interacting with Local Chrome Server API"""
    
    def __init__(self, server_url: str = DEFAULT_SERVER_URL):
        self.server_url = server_url.rstrip('/')
        self.session = requests.Session()
        
    def health_check(self) -> bool:
        """Check if server is healthy"""
        try:
            response = self.session.get(f"{self.server_url}/health", timeout=2)
            return response.status_code == 200
        except requests.RequestException:
            return False
            
    def execute_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a command via API"""
        try:
            response = self.session.post(
                f"{self.server_url}/command",
                json=command,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            raise click.ClickException(f"API request failed: {e}")
            
    def mouse_move(self, dx: int, dy: int, duration: float = 0.1) -> Dict[str, Any]:
        """Move mouse relative to current position"""
        command = {
            "type": "mouse_move",
            "dx": dx,
            "dy": dy,
            "duration": duration
        }
        return self.execute_command(command)
        
    def mouse_click(self, button: str = "left", double: bool = False, count: int = 1) -> Dict[str, Any]:
        """Click at current mouse position"""
        command = {
            "type": "mouse_click",
            "button": button,
            "double": double,
            "count": count
        }
        return self.execute_command(command)
        
    def mouse_scroll(self, direction: str = "down", amount: int = 100) -> Dict[str, Any]:
        """Scroll at current mouse position"""
        command = {
            "type": "mouse_scroll",
            "direction": direction,
            "amount": amount
        }
        return self.execute_command(command)
        
    def mouse_reset(self) -> Dict[str, Any]:
        """Reset mouse position to screen center"""
        command = {
            "type": "reset_mouse"
        }
        return self.execute_command(command)
        
    def keyboard_type(self, text: str) -> Dict[str, Any]:
        """Type text at current focus"""
        command = {
            "type": "keyboard_type",
            "text": text
        }
        return self.execute_command(command)
        
    def keyboard_press(self, key: str, modifiers: list = None) -> Dict[str, Any]:
        """Press special key"""
        command = {
            "type": "keyboard_press",
            "key": key,
            "modifiers": modifiers or []
        }
        return self.execute_command(command)
        
    def screenshot(self, tab_id: Optional[int] = None, include_cursor: bool = True, quality: int = 90) -> Dict[str, Any]:
        """Capture screenshot"""
        command = {
            "type": "screenshot",
            "tab_id": tab_id,
            "include_cursor": include_cursor,
            "quality": quality
        }
        return self.execute_command(command)
        
    def tab_open(self, url: str) -> Dict[str, Any]:
        """Open new tab"""
        command = {
            "type": "tab",
            "action": "open",
            "url": url
        }
        return self.execute_command(command)
        
    def tab_close(self, tab_id: int) -> Dict[str, Any]:
        """Close tab"""
        command = {
            "type": "tab",
            "action": "close",
            "tab_id": tab_id
        }
        return self.execute_command(command)
        
    def tab_switch(self, tab_id: int) -> Dict[str, Any]:
        """Switch to tab"""
        command = {
            "type": "tab",
            "action": "switch",
            "tab_id": tab_id
        }
        return self.execute_command(command)
        
    def get_tabs(self) -> Dict[str, Any]:
        """Get list of all tabs"""
        command = {
            "type": "get_tabs"
        }
        return self.execute_command(command)


@click.group()
@click.option('--server', default=DEFAULT_SERVER_URL, help='Server URL')
@click.pass_context
def cli(ctx, server):
    """Local Chrome Server CLI - Control Chrome browser programmatically"""
    ctx.ensure_object(dict)
    ctx.obj['client'] = ChromeCLIClient(server)
    
    # Check server health
    if not ctx.obj['client'].health_check():
        click.echo(f"⚠️  Cannot connect to server at {server}", err=True)
        click.echo("Make sure the server is running with: local-chrome-server", err=True)
        sys.exit(1)


@cli.command()
def status():
    """Check server status"""
    client = ChromeCLIClient()
    if client.health_check():
        click.echo("✅ Server is healthy")
    else:
        click.echo("❌ Server is not responding")
        sys.exit(1)


@cli.group()
def mouse():
    """Mouse control commands"""


@mouse.command()
@click.argument('dx', type=int)
@click.argument('dy', type=int)
@click.option('--duration', default=0.1, help='Movement duration in seconds')
@click.pass_context
def move(ctx, dx, dy, duration):
    """Move mouse relative to current position"""
    result = ctx.obj['client'].mouse_move(dx, dy, duration)
    _print_result(result)


@mouse.command(name='click')
@click.option('--button', default='left', type=click.Choice(['left', 'right', 'middle']))
@click.option('--double', is_flag=True, help='Double click')
@click.option('--count', default=1, type=click.IntRange(1, 3), help='Number of clicks')
@click.pass_context
def click_cmd(ctx, button, double, count):
    """Click at current mouse position"""
    result = ctx.obj['client'].mouse_click(button, double, count)
    _print_result(result)


@mouse.command()
@click.option('--direction', default='down', type=click.Choice(['up', 'down', 'left', 'right']))
@click.option('--amount', default=100, type=int, help='Scroll amount in pixels')
@click.pass_context
def scroll(ctx, direction, amount):
    """Scroll at current mouse position"""
    result = ctx.obj['client'].mouse_scroll(direction, amount)
    _print_result(result)


@mouse.command()
@click.pass_context
def reset(ctx):
    """Reset mouse position to screen center"""
    result = ctx.obj['client'].mouse_reset()
    _print_result(result)


@cli.group()
def keyboard():
    """Keyboard control commands"""


@keyboard.command()
@click.argument('text')
@click.pass_context
def type(ctx, text):
    """Type text at current focus"""
    result = ctx.obj['client'].keyboard_type(text)
    _print_result(result)


@keyboard.command()
@click.argument('key')
@click.option('--modifier', '-m', multiple=True, help='Modifier key (Control, Shift, Alt, Meta)')
@click.pass_context
def press(ctx, key, modifier):
    """Press special key"""
    result = ctx.obj['client'].keyboard_press(key, list(modifier))
    _print_result(result)


@cli.group()
def screenshot():
    """Screenshot commands"""


@screenshot.command()
@click.option('--tab-id', type=int, help='Specific tab ID (default: current tab)')
@click.option('--no-cursor', is_flag=True, help='Exclude mouse cursor from screenshot')
@click.option('--quality', default=90, type=click.IntRange(1, 100), help='JPEG quality')
@click.option('--save', type=click.Path(), help='Save screenshot to file')
@click.pass_context
def capture(ctx, tab_id, no_cursor, quality, save):
    """Capture screenshot"""
    result = ctx.obj['client'].screenshot(tab_id, not no_cursor, quality)
    
    if result.get('success'):
        click.echo("✅ Screenshot captured successfully")
        
        # Save to file if requested
        if save and 'data' in result and 'image_data' in result['data']:
            import base64
            image_data = result['data']['image_data']
            
            # Remove data URL prefix if present
            if image_data.startswith('data:image/'):
                # Extract base64 data
                header, data = image_data.split(',', 1)
                image_data = data
                
            # Decode and save
            with open(save, 'wb') as f:
                f.write(base64.b64decode(image_data))
            click.echo(f"📸 Screenshot saved to {save}")
    else:
        _print_result(result)


@cli.group()
def tabs():
    """Tab management commands"""


@tabs.command()
@click.pass_context
def list(ctx):
    """List all tabs"""
    result = ctx.obj['client'].get_tabs()
    
    if result.get('success') and 'data' in result and 'tabs' in result['data']:
        tabs = result['data']['tabs']
        click.echo(f"Found {len(tabs)} tabs:")
        click.echo("")
        
        for i, tab in enumerate(tabs):
            active = "✓" if tab.get('active') else " "
            click.echo(f"  {active} [{tab['id']}] {tab.get('title', 'No title')}")
            click.echo(f"      {tab.get('url', 'No URL')}")
            if i < len(tabs) - 1:
                click.echo("")
    else:
        _print_result(result)


@tabs.command()
@click.argument('url')
@click.pass_context
def open(ctx, url):
    """Open new tab"""
    result = ctx.obj['client'].tab_open(url)
    _print_result(result)


@tabs.command()
@click.argument('tab_id', type=int)
@click.pass_context
def close(ctx, tab_id):
    """Close tab"""
    result = ctx.obj['client'].tab_close(tab_id)
    _print_result(result)


@tabs.command()
@click.argument('tab_id', type=int)
@click.pass_context
def switch(ctx, tab_id):
    """Switch to tab"""
    result = ctx.obj['client'].tab_switch(tab_id)
    _print_result(result)


@cli.command()
@click.pass_context
def interactive(ctx):
    """Interactive REPL for browser control"""
    click.echo("🔧 Local Chrome Server Interactive Mode")
    click.echo("Type 'help' for commands, 'exit' to quit")
    click.echo("")
    
    # Try to enable readline for better input editing
    try:
        import readline
        # Enable arrow key navigation and basic editing
        readline.parse_and_bind("tab: complete")
        readline.parse_and_bind("set editing-mode emacs")
    except ImportError:
        click.echo("⚠️  Readline not available, using basic input (arrow keys may not work)")
    
    while True:
        try:
            # Use input() instead of click.prompt for better readline integration
            try:
                cmd = input("chrome> ").strip()
            except EOFError:
                click.echo("\n👋 Goodbye!")
                break
            except KeyboardInterrupt:
                click.echo("\n👋 Goodbye!")
                break
            
            if not cmd:
                continue
            elif cmd.lower() in ['exit', 'quit', 'q']:
                break
            elif cmd.lower() == 'help':
                _print_interactive_help()
            elif cmd.lower() == 'reset':
                # Reset mouse shortcut
                result = ctx.obj['client'].mouse_reset()
                _print_result(result)
            elif cmd.lower().startswith('click'):
                # Click shortcut: click [left|right|middle]
                parts = cmd.lower().split()
                button = parts[1] if len(parts) > 1 else 'left'
                if button not in ['left', 'right', 'middle']:
                    click.echo("❌ Invalid button. Use: click [left|right|middle]")
                    continue
                result = ctx.obj['client'].mouse_click(button)
                _print_result(result)
            elif cmd.lower().startswith('move'):
                # Move shortcut: move <dx> <dy>
                parts = cmd.split()
                if len(parts) != 3:
                    click.echo("❌ Invalid move command. Use: move <dx> <dy>")
                    continue
                try:
                    dx = int(parts[1])
                    dy = int(parts[2])
                    result = ctx.obj['client'].mouse_move(dx, dy)
                    _print_result(result)
                except ValueError:
                    click.echo("❌ Invalid coordinates. Use integers.")
            elif cmd.lower().startswith('scroll'):
                # Scroll shortcut: scroll <direction> [amount]
                parts = cmd.split()
                if len(parts) < 2:
                    click.echo("❌ Invalid scroll command. Use: scroll <up|down|left|right> [amount]")
                    continue
                direction = parts[1].lower()
                if direction not in ['up', 'down', 'left', 'right']:
                    click.echo("❌ Invalid direction. Use: up, down, left, right")
                    continue
                amount = int(parts[2]) if len(parts) > 2 else 100
                result = ctx.obj['client'].mouse_scroll(direction, amount)
                _print_result(result)
            elif cmd.lower().startswith('type '):
                # Type shortcut: type <text>
                text = cmd[5:]  # Remove "type " prefix
                result = ctx.obj['client'].keyboard_type(text)
                _print_result(result)
            elif cmd.lower().startswith('press '):
                # Press shortcut: press <key> [modifiers...]
                parts = cmd.split()
                if len(parts) < 2:
                    click.echo("❌ Invalid press command. Use: press <key> [modifier1 modifier2...]")
                    continue
                key = parts[1]
                modifiers = parts[2:] if len(parts) > 2 else []
                result = ctx.obj['client'].keyboard_press(key, modifiers)
                _print_result(result)
            elif cmd.lower() == 'screenshot':
                # Screenshot shortcut
                result = ctx.obj['client'].screenshot()
                _print_result(result)
            elif cmd.lower().startswith('tabs '):
                # Tabs shortcuts: tabs list, tabs open <url>, tabs close <id>, tabs switch <id>
                parts = cmd.split()
                if len(parts) < 2:
                    click.echo("❌ Invalid tabs command. Use: tabs list|open|close|switch")
                    continue
                
                action = parts[1].lower()
                if action == 'list':
                    result = ctx.obj['client'].get_tabs()
                    _print_tabs_result(result)
                elif action == 'open':
                    if len(parts) < 3:
                        click.echo("❌ Missing URL. Use: tabs open <url>")
                        continue
                    url = parts[2]
                    result = ctx.obj['client'].tab_open(url)
                    _print_result(result)
                elif action == 'close':
                    if len(parts) < 3:
                        click.echo("❌ Missing tab ID. Use: tabs close <tab_id>")
                        continue
                    try:
                        tab_id = int(parts[2])
                        result = ctx.obj['client'].tab_close(tab_id)
                        _print_result(result)
                    except ValueError:
                        click.echo("❌ Invalid tab ID. Use integer.")
                elif action == 'switch':
                    if len(parts) < 3:
                        click.echo("❌ Missing tab ID. Use: tabs switch <tab_id>")
                        continue
                    try:
                        tab_id = int(parts[2])
                        result = ctx.obj['client'].tab_switch(tab_id)
                        _print_result(result)
                    except ValueError:
                        click.echo("❌ Invalid tab ID. Use integer.")
                else:
                    click.echo("❌ Unknown tabs action. Use: list, open, close, switch")
            else:
                # Try to parse as JSON command
                try:
                    command = json.loads(cmd)
                    result = ctx.obj['client'].execute_command(command)
                    _print_result(result)
                except json.JSONDecodeError:
                    click.echo("❌ Invalid command. Use shortcut format or type 'help'")
                    
        except KeyboardInterrupt:
            click.echo("\n👋 Goodbye!")
            break
        except Exception as e:
            click.echo(f"❌ Error: {e}")


def _print_result(result: Dict[str, Any]):
    """Print command result"""
    if result.get('success'):
        click.echo("✅ Command executed successfully")
        if result.get('message'):
            click.echo(f"   {result['message']}")
    else:
        click.echo("❌ Command failed")
        if result.get('error'):
            click.echo(f"   Error: {result['error']}")


def _print_tabs_result(result: Dict[str, Any]):
    """Print tabs result in a formatted way"""
    if result.get('success') and 'data' in result and 'tabs' in result['data']:
        tabs = result['data']['tabs']
        click.echo(f"Found {len(tabs)} tabs:")
        click.echo("")
        
        for i, tab in enumerate(tabs):
            active = "✓" if tab.get('active') else " "
            click.echo(f"  {active} [{tab['id']}] {tab.get('title', 'No title')}")
            click.echo(f"      {tab.get('url', 'No URL')}")
            if i < len(tabs) - 1:
                click.echo("")
    else:
        _print_result(result)


def _print_interactive_help():
    """Print interactive mode help"""
    click.echo("")
    click.echo("Available commands:")
    click.echo("")
    click.echo("  Shortcut Commands:")
    click.echo("    reset                    - Reset mouse to center")
    click.echo("    click [left|right|middle] - Click mouse button (default: left)")
    click.echo("    move <dx> <dy>          - Move mouse relative")
    click.echo("    scroll <up|down|left|right> [amount] - Scroll (default: down, 100)")
    click.echo("    type <text>             - Type text")
    click.echo("    press <key> [modifiers] - Press special key")
    click.echo("    screenshot              - Capture screenshot")
    click.echo("    tabs list               - List all tabs")
    click.echo("    tabs open <url>         - Open new tab")
    click.echo("    tabs close <tab_id>     - Close tab")
    click.echo("    tabs switch <tab_id>    - Switch to tab")
    click.echo("")
    click.echo("  JSON Commands (send directly to API):")
    click.echo("    {\"type\": \"mouse_move\", \"dx\": 100, \"dy\": 50}")
    click.echo("    {\"type\": \"mouse_click\", \"button\": \"left\"}")
    click.echo("    {\"type\": \"reset_mouse\"}")
    click.echo("    {\"type\": \"keyboard_type\", \"text\": \"Hello World\"}")
    click.echo("    {\"type\": \"screenshot\"}")
    click.echo("    {\"type\": \"tab\", \"action\": \"open\", \"url\": \"https://example.com\"}")
    click.echo("    {\"type\": \"get_tabs\"}")
    click.echo("")
    click.echo("  Special Commands:")
    click.echo("    help     - Show this help")
    click.echo("    exit/quit - Exit interactive mode")
    click.echo("")


@cli.command()
@click.argument('command_file', type=click.File('r'))
@click.pass_context
def script(ctx, command_file):
    """Execute commands from a JSON file"""
    try:
        commands = json.load(command_file)
        
        # If it's a single command, wrap in list
        if isinstance(commands, dict):
            commands = [commands]
            
        for i, cmd in enumerate(commands):
            click.echo(f"Executing command {i+1}/{len(commands)}...")
            result = ctx.obj['client'].execute_command(cmd)
            _print_result(result)
            
            # Small delay between commands
            if i < len(commands) - 1:
                time.sleep(0.1)
                
    except json.JSONDecodeError as e:
        raise click.ClickException(f"Invalid JSON in command file: {e}")
    except Exception as e:
        raise click.ClickException(f"Error executing script: {e}")


# Export main function for entry point
main = cli

if __name__ == '__main__':
    cli()