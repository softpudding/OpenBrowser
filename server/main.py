#!/usr/bin/env python3
"""
Local Chrome Server - Main entry point
"""

import asyncio
import click
import logging
import sys
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('chrome_server.log')
    ]
)

logger = logging.getLogger(__name__)


@click.group()
def cli():
    """Local Chrome Server - Control Chrome browser via extension"""
    pass


@cli.command()
@click.option('--host', default='127.0.0.1', help='Host to bind to')
@click.option('--port', default=8765, type=int, help='HTTP port')
@click.option('--websocket-port', default=8766, type=int, help='WebSocket port')
@click.option('--log-level', default='INFO', 
              type=click.Choice(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']))
def serve(host, port, websocket_port, log_level):
    """Start the Local Chrome Server"""
    import uvicorn
    from server.api.main import app
    from server.websocket.manager import ws_manager
    from server.core.config import config
    
    # Update config with CLI options
    config.host = host
    config.port = port
    config.websocket_port = websocket_port
    config.log_level = log_level
    
    # Set logging level
    logging.getLogger().setLevel(getattr(logging, log_level))
    
    click.echo(f"🚀 Starting Local Chrome Server...")
    click.echo(f"   HTTP API: http://{host}:{port}")
    click.echo(f"   WebSocket: ws://{host}:{websocket_port}")
    click.echo(f"   Preset Resolution: {config.preset_resolution[0]}x{config.preset_resolution[1]}")
    click.echo(f"   Log Level: {log_level}")
    click.echo("")
    click.echo("📚 Endpoints:")
    click.echo("   GET  /              - Server info")
    click.echo("   GET  /health        - Health check")
    click.echo("   POST /command       - Execute browser command")
    click.echo("   POST /mouse/*       - Mouse control shortcuts")
    click.echo("   POST /keyboard/*    - Keyboard control shortcuts")
    click.echo("   POST /screenshot    - Capture screenshot")
    click.echo("   POST /tabs          - Tab management")
    click.echo("   GET  /tabs          - List all tabs")
    click.echo("   WS   /ws            - WebSocket for real-time commands")
    click.echo("")
    click.echo("🔧 Use the CLI tool: chrome-cli --help")
    click.echo("")
    
    # Start server
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level=log_level.lower()
    )


@cli.command()
def check():
    """Check if Chrome extension is connected"""
    from server.websocket.manager import ws_manager
    
    if ws_manager.is_connected():
        click.echo("✅ Chrome extension is connected")
        click.echo(f"   Active connections: {ws_manager.get_connection_count()}")
    else:
        click.echo("❌ Chrome extension is not connected")
        click.echo("   Make sure the Chrome extension is installed and running")


@cli.command()
@click.argument('command', type=click.File('r'))
def execute(command):
    """Execute a single command from JSON file"""
    import json
    from server.core.processor import command_processor
    from server.models.commands import parse_command
    
    try:
        # Load command from file
        command_data = json.load(command)
        cmd = parse_command(command_data)
        
        # Execute command
        click.echo(f"Executing command: {cmd.type}")
        result = asyncio.run(command_processor.execute(cmd))
        
        # Print result
        if result.success:
            click.echo("✅ Command executed successfully")
            if result.message:
                click.echo(f"   Message: {result.message}")
        else:
            click.echo("❌ Command failed")
            if result.error:
                click.echo(f"   Error: {result.error}")
                
    except json.JSONDecodeError as e:
        click.echo(f"❌ Invalid JSON: {e}")
        sys.exit(1)
    except Exception as e:
        click.echo(f"❌ Error: {e}")
        sys.exit(1)


@cli.command()
@click.option('--interval', default=1.0, help='Interval between screenshots in seconds')
@click.option('--count', default=10, help='Number of screenshots to capture')
@click.option('--output-dir', default='./screenshots', help='Output directory')
def demo(interval, count, output_dir):
    """Run a demo sequence of commands"""
    import time
    from server.core.processor import command_processor
    from server.models.commands import (
        MouseMoveCommand, MouseClickCommand, KeyboardTypeCommand,
        ScreenshotCommand, GetTabsCommand
    )
    
    click.echo("🎬 Running demo sequence...")
    
    # Create output directory
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    async def run_demo():
        # Get tabs
        click.echo("1. Getting tabs...")
        tabs_result = await command_processor.execute(GetTabsCommand())
        if tabs_result.success and tabs_result.data and 'tabs' in tabs_result.data:
            tabs = tabs_result.data['tabs']
            click.echo(f"   Found {len(tabs)} tabs")
        else:
            click.echo("   No tabs found or failed to get tabs")
            return
            
        # Take screenshots
        click.echo(f"2. Taking {count} screenshots...")
        for i in range(count):
            screenshot_result = await command_processor.execute(
                ScreenshotCommand(include_cursor=True, quality=85)
            )
            
            if screenshot_result.success:
                # Save screenshot
                filename = Path(output_dir) / f"screenshot_{i+1:03d}.png"
                # TODO: Save image data
                click.echo(f"   📸 Screenshot {i+1}/{count} captured")
            else:
                click.echo(f"   ❌ Failed to capture screenshot {i+1}")
                
            if i < count - 1:
                await asyncio.sleep(interval)
                
        # Mouse movement demo
        click.echo("3. Mouse movement demo...")
        for dx, dy in [(100, 0), (0, 100), (-100, 0), (0, -100)]:
            move_result = await command_processor.execute(
                MouseMoveCommand(dx=dx, dy=dy, duration=0.2)
            )
            if move_result.success:
                click.echo(f"   Mouse moved: ({dx}, {dy})")
            else:
                click.echo(f"   Failed to move mouse: ({dx}, {dy})")
            await asyncio.sleep(0.3)
            
        click.echo("✅ Demo completed!")
        
    asyncio.run(run_demo())


if __name__ == '__main__':
    cli()