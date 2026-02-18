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
            
    def mouse_move(self, x: int, y: int, duration: float = 0.1) -> Dict[str, Any]:
        """Move mouse to absolute position in preset coordinate system (0-1280, 0-720)"""
        command = {
            "type": "mouse_move",
            "x": x,
            "y": y,
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
        
    def tab_init(self, url: str) -> Dict[str, Any]:
        """Initialize a new managed session with starting URL"""
        command = {
            "type": "tab",
            "action": "init",
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
        
    def tab_refresh(self, tab_id: int) -> Dict[str, Any]:
        """Refresh tab"""
        command = {
            "type": "tab",
            "action": "refresh",
            "tab_id": tab_id
        }
        return self.execute_command(command)
        
    def get_tabs(self, managed_only: bool = True) -> Dict[str, Any]:
        """Get list of tabs
        Args:
            managed_only: If True, only returns managed tabs (default).
                          If False, returns all tabs.
        """
        command = {
            "type": "get_tabs",
            "managed_only": managed_only
        }
        return self.execute_command(command)

    def javascript_execute(self, script: str, tab_id: Optional[int] = None, 
                          return_by_value: bool = True, await_promise: bool = False,
                          timeout: int = 30000) -> Dict[str, Any]:
        """Execute JavaScript code in browser tab
        Args:
            script: JavaScript code to execute
            tab_id: Target tab ID (None = current managed tab)
            return_by_value: If True, returns result as serializable JSON value
            await_promise: If True, waits for Promise resolution
            timeout: Execution timeout in milliseconds
        """
        command = {
            "type": "javascript_execute",
            "script": script,
            "tab_id": tab_id,
            "return_by_value": return_by_value,
            "await_promise": await_promise,
            "timeout": timeout
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
    import sys
    client = ChromeCLIClient()
    if client.health_check():
        sys.stdout.write("Server is healthy\n")
    else:
        sys.stderr.write("Server is not responding\n")
        sys.exit(1)


@cli.group()
def mouse():
    """Mouse control commands"""


@mouse.command()
@click.argument('x', type=int)
@click.argument('y', type=int)
@click.option('--duration', default=0.1, help='Movement duration in seconds')
@click.pass_context
def move(ctx, x, y, duration):
    """Move mouse to absolute position in preset coordinate system (0-1280, 0-720)"""
    result = ctx.obj['client'].mouse_move(x, y, duration)
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
@click.option('--no-auto-save', is_flag=True, help='Disable automatic saving to screenshots directory')
@click.pass_context
def capture(ctx, tab_id, no_cursor, quality, save, no_auto_save):
    """Capture screenshot"""
    result = ctx.obj['client'].screenshot(tab_id, not no_cursor, quality)
    
    if result.get('success'):
        import sys
        sys.stdout.write("Screen capture completed\n")
        
        # Save screenshot using helper function
        saved_path = _save_screenshot_result(result, save, not no_auto_save)
        
        if saved_path:
            if save:
                # 对于自定义保存路径，只显示成功消息，不显示路径
                sys.stdout.write("Image saved to specified location\n")
            else:
                # 自动保存时，只显示保存在screenshots目录，不显示完整路径
                sys.stdout.write("Image automatically saved to screenshots/ directory\n")
                sys.stdout.write("  Use --save <path> to specify custom location\n")
                sys.stdout.write("  Use --no-auto-save to disable auto-saving\n")
        
        # Print metadata if available
        if 'data' in result and 'metadata' in result['data']:
            metadata = result['data']['metadata']
            sys.stdout.write(f"  Size: {metadata.get('width', 'unknown')}x{metadata.get('height', 'unknown')}\n")
            sys.stdout.write(f"  Viewport: {metadata.get('viewportWidth', 'unknown')}x{metadata.get('viewportHeight', 'unknown')}\n")
            if metadata.get('resizedToPreset', False):
                sys.stdout.write(f"  Resized to preset coordinate system (1280x720)\n")
    else:
        _print_result(result)


@cli.group()
def tabs():
    """Tab management commands"""


@tabs.command()
@click.option('--all', 'show_all', is_flag=True, help='Show all tabs (not just managed)')
@click.pass_context
def list(ctx, show_all):
    """List tabs (managed tabs by default, use --all for all tabs)"""
    result = ctx.obj['client'].get_tabs(managed_only=not show_all)
    
    if result.get('success') and 'data' in result and 'tabs' in result['data']:
        tabs = result['data']['tabs']
        managed_only = result['data'].get('managedOnly', True)
        
        if len(tabs) == 0:
            if managed_only:
                click.echo("📭 No managed tabs found.")
                click.echo("   Use 'tabs init <url>' to start a managed session, or 'tabs list --all' to see all tabs.")
            else:
                click.echo("📭 No tabs found.")
        else:
            if managed_only:
                click.echo(f"📋 Found {len(tabs)} managed tab(s):")
            else:
                click.echo(f"📋 Found {len(tabs)} tab(s) ({result['data'].get('managedCount', 0)} managed):")
            click.echo("")
            
            for i, tab in enumerate(tabs):
                active = "✓" if tab.get('active') else " "
                managed_indicator = "🔒 " if tab.get('isManaged') else "   "
                click.echo(f"  {active} {managed_indicator}[{tab['id']}] {tab.get('title', 'No title')}")
                click.echo(f"      {tab.get('url', 'No URL')}")
                if i < len(tabs) - 1:
                    click.echo("")
    else:
        _print_result(result)


@tabs.command()
@click.argument('url')
@click.pass_context
def init(ctx, url):
    """Initialize a new managed session with starting URL"""
    result = ctx.obj['client'].tab_init(url)
    _print_result(result)


@tabs.command(name='open')
@click.argument('url')
@click.pass_context
def open_tab(ctx, url):
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


@tabs.command()
@click.argument('tab_id', type=int)
@click.pass_context
def refresh(ctx, tab_id):
    """Refresh tab"""
    result = ctx.obj['client'].tab_refresh(tab_id)
    _print_result(result)


@cli.group()
def javascript():
    """JavaScript execution commands"""


@javascript.command()
@click.argument('script')
@click.option('--tab-id', type=int, help='Target tab ID (default: current managed tab)')
@click.option('--no-return-value', is_flag=True, help='Do not return serializable value (raw result object)')
@click.option('--await-promise', is_flag=True, help='Wait for Promise resolution')
@click.option('--timeout', default=30000, type=int, help='Execution timeout in milliseconds')
@click.pass_context
def execute(ctx, script, tab_id, no_return_value, await_promise, timeout):
    """Execute JavaScript code in browser tab"""
    result = ctx.obj['client'].javascript_execute(
        script=script,
        tab_id=tab_id,
        return_by_value=not no_return_value,
        await_promise=await_promise,
        timeout=timeout
    )
    _print_result(result)
    # If successful and has result data, print it nicely
    if result.get('success') and result.get('data') and result['data'].get('result'):
        import json
        result_data = result['data']['result']
        if result_data.get('value') is not None:
            click.echo("\nResult value:")
            try:
                # Try to pretty print JSON if it's JSON serializable
                if isinstance(result_data['value'], (dict, list)):
                    click.echo(json.dumps(result_data['value'], indent=2))
                else:
                    click.echo(str(result_data['value']))
            except:
                click.echo(str(result_data['value']))
        elif result_data.get('type') == 'undefined':
            click.echo("\nResult: undefined")
        else:
            click.echo(f"\nResult type: {result_data.get('type')}")
            if result_data.get('description'):
                click.echo(f"Description: {result_data.get('description')}")


@cli.command()
@click.pass_context
def interactive(ctx):
    """Interactive REPL for browser control"""
    import sys
    sys.stdout.write("Local Chrome Server Interactive Mode\n")
    sys.stdout.write("Type 'help' for commands, 'exit' to quit\n")
    sys.stdout.write("\n")
    
    # Try to enable readline for better input editing
    try:
        import readline
        # Enable arrow key navigation and basic editing
        readline.parse_and_bind("tab: complete")
        readline.parse_and_bind("set editing-mode emacs")
    except ImportError:
        sys.stderr.write("Readline not available, using basic input (arrow keys may not work)\n")
    
    while True:
        try:
            # Use input() instead of click.prompt for better readline integration
            try:
                cmd = input("chrome> ").strip()
            except EOFError:
                sys.stdout.write("\nGoodbye!\n")
                break
            except KeyboardInterrupt:
                sys.stdout.write("\nGoodbye!\n")
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
                    sys.stderr.write("Invalid button. Use: click [left|right|middle]\n")
                    continue
                result = ctx.obj['client'].mouse_click(button)
                _print_result(result)
            elif cmd.lower().startswith('move'):
                # Move shortcut: move <x> <y>
                parts = cmd.split()
                if len(parts) != 3:
                    click.echo("❌ Invalid move command. Use: move <x> <y>")
                    continue
                try:
                    x = int(parts[1])
                    y = int(parts[2])
                    result = ctx.obj['client'].mouse_move(x, y)
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
                
                if result.get('success'):
                    import sys
                    sys.stdout.write("Screen capture completed\n")
                    
                    # Save screenshot automatically in interactive mode
                    saved_path = _save_screenshot_result(result, None, True)
                    
                    if saved_path:
                        # 只显示保存在screenshots目录，不显示完整路径
                        sys.stdout.write("Image saved to screenshots/ directory\n")
                    
                    # Print metadata if available
                    if 'data' in result and 'metadata' in result['data']:
                        metadata = result['data']['metadata']
                        sys.stdout.write(f"  Size: {metadata.get('width', 'unknown')}x{metadata.get('height', 'unknown')}\n")
                        if metadata.get('resizedToPreset', False):
                            sys.stdout.write(f"  Resized to preset coordinate system (1280x720)\n")
                else:
                    _print_result(result)
            elif cmd.lower().startswith('javascript '):
                # JavaScript execution shortcut: javascript <script>
                script = cmd[11:]  # Remove "javascript " prefix
                if not script:
                    click.echo("❌ Missing JavaScript code. Use: javascript <script>")
                    continue
                
                try:
                    result = ctx.obj['client'].javascript_execute(script=script)
                    _print_result(result)
                    
                    # Print result value if available
                    if result.get('success') and result.get('data') and result['data'].get('result'):
                        result_data = result['data']['result']
                        if result_data.get('value') is not None:
                            import json
                            try:
                                if isinstance(result_data['value'], (dict, list)):
                                    click.echo(f"Result: {json.dumps(result_data['value'], indent=2)}")
                                else:
                                    click.echo(f"Result: {result_data['value']}")
                            except:
                                click.echo(f"Result: {result_data['value']}")
                        elif result_data.get('type') == 'undefined':
                            click.echo("Result: undefined")
                        else:
                            click.echo(f"Result type: {result_data.get('type')}")
                except Exception as e:
                    click.echo(f"❌ JavaScript execution failed: {e}")
            elif cmd.lower().startswith('tabs '):
                # Tabs shortcuts: tabs list, tabs init <url>, tabs open <url>, tabs close <id>, tabs switch <id>
                parts = cmd.split()
                if len(parts) < 2:
                    click.echo("❌ Invalid tabs command. Use: tabs list|init|open|close|switch")
                    continue
                
                action = parts[1].lower()
                if action == 'list':
                    result = ctx.obj['client'].get_tabs()
                    _print_tabs_result(result)
                elif action == 'init':
                    if len(parts) < 3:
                        click.echo("❌ Missing URL. Use: tabs init <url>")
                        continue
                    url = parts[2]
                    result = ctx.obj['client'].tab_init(url)
                    _print_result(result)
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
                    click.echo("❌ Unknown tabs action. Use: list, init, open, close, switch")
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


def _save_screenshot_result(result: Dict[str, Any], save_path: Optional[str] = None, 
                           auto_save: bool = True) -> Optional[str]:
    """Save screenshot from result and return saved file path"""
    try:
        # Check both 'imageData' (camelCase from TypeScript) and 'image_data' (snake_case fallback)
        has_image_data = False
        image_data_key = None
        
        if 'data' in result:
            if 'imageData' in result['data']:
                image_data_key = 'imageData'
                has_image_data = True
            elif 'image_data' in result['data']:
                image_data_key = 'image_data'
                has_image_data = True
        
        if not result.get('success') or 'data' not in result or not has_image_data:
            return None
        
        import base64
        import builtins
        import os
        from datetime import datetime
        
        image_data = result['data'][image_data_key]
        
        if not image_data or len(image_data) < 100:
            return None
        
        # Remove data URL prefix if present
        if image_data.startswith('data:image/'):
            header, data = image_data.split(',', 1)
            image_data = data
        
        saved_path = None
        
        # Save to file if requested via save_path
        if save_path:
            try:
                with builtins.open(save_path, 'wb') as f:
                    f.write(base64.b64decode(image_data))
                saved_path = save_path
            except Exception as e:
                return None
        
        # Auto-save to screenshots directory if not disabled and no custom save path
        elif auto_save:
            # Create screenshots directory if it doesn't exist
            screenshot_dir = "./screenshots"
            screenshot_dir_abs = os.path.abspath(screenshot_dir)
            os.makedirs(screenshot_dir_abs, exist_ok=True)
            
            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(screenshot_dir_abs, f"screenshot_{timestamp}.png")
            
            try:
                # Save the file
                with builtins.open(filename, 'wb') as f:
                    f.write(base64.b64decode(image_data))
                saved_path = filename
            except Exception as e:
                return None
        
        return saved_path
    
    except Exception as e:
        return None


def _print_result(result: Dict[str, Any]):
    """Print command result"""
    import sys
    if result.get('success'):
        # 使用更简单的消息，避免可能触发命令
        sys.stdout.write("Command executed\n")
        if result.get('message'):
            # 移除可能的问题词汇
            msg = result['message']
            # 替换"screenshot"为更安全的词汇
            msg = msg.replace("Screenshot", "Screen capture")
            msg = msg.replace("screenshot", "screen capture")
            sys.stdout.write(f"   {msg}\n")
    else:
        sys.stdout.write("Command failed\n")
        if result.get('error'):
            sys.stdout.write(f"   Error: {result['error']}\n")


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
    click.echo("    move <x> <y>          - Move mouse to absolute position (0-1280, 0-720)")
    click.echo("    scroll <up|down|left|right> [amount] - Scroll (default: down, 100)")
    click.echo("    type <text>             - Type text")
    click.echo("    press <key> [modifiers] - Press special key")
    click.echo("    screenshot              - Capture screenshot")
    click.echo("    javascript <script>     - Execute JavaScript code")
    click.echo("    tabs list               - List all tabs")
    click.echo("    tabs init <url>         - Initialize new managed session")
    click.echo("    tabs open <url>         - Open new tab")
    click.echo("    tabs close <tab_id>     - Close tab")
    click.echo("    tabs switch <tab_id>    - Switch to tab")
    click.echo("")
    click.echo("  JSON Commands (send directly to API):")
    click.echo("    {\"type\": \"mouse_move\", \"x\": 640, \"y\": 360}")
    click.echo("    {\"type\": \"mouse_click\", \"button\": \"left\"}")
    click.echo("    {\"type\": \"reset_mouse\"}")
    click.echo("    {\"type\": \"keyboard_type\", \"text\": \"Hello World\"}")
    click.echo("    {\"type\": \"screenshot\"}")
    click.echo("    {\"type\": \"javascript_execute\", \"script\": \"document.title\"}")
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