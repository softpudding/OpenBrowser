#!/usr/bin/env python3
"""
Demo script for Local Chrome Server
Shows basic usage of the API
"""

import asyncio
import json
import time
from pathlib import Path

# Import server components for direct testing
from server.models.commands import (
    MouseMoveCommand, MouseClickCommand, KeyboardTypeCommand,
    ScreenshotCommand, TabCommand, GetTabsCommand
)
from server.core.processor import command_processor
from server.websocket.manager import ws_manager


async def demo_basic_commands():
    """Demonstrate basic command execution"""
    print("🚀 Local Chrome Server Demo")
    print("=" * 50)
    
    # Note: This demo assumes the Chrome extension is connected via WebSocket
    # In a real scenario, you would start the server and extension first
    
    print("\n1. Checking WebSocket connection...")
    if not ws_manager.is_connected():
        print("   ⚠️  No WebSocket connection. Make sure:")
        print("   - Chrome extension is installed and running")
        print("   - Extension is loaded from extension/dist directory")
        print("   - Server is running: local-chrome-server serve")
        return False
    
    print(f"   ✅ Connected ({ws_manager.get_connection_count()} connection(s))")
    
    print("\n2. Getting current tabs...")
    try:
        tabs_command = GetTabsCommand()
        tabs_response = await command_processor.execute(tabs_command)
        
        if tabs_response.success and tabs_response.data and 'tabs' in tabs_response.data:
            tabs = tabs_response.data['tabs']
            print(f"   ✅ Found {len(tabs)} tabs")
            for tab in tabs[:3]:  # Show first 3 tabs
                print(f"      - [{tab['id']}] {tab.get('title', 'No title')}")
            if len(tabs) > 3:
                print(f"      ... and {len(tabs) - 3} more")
        else:
            print(f"   ❌ Failed to get tabs: {tabs_response.error}")
    except Exception as e:
        print(f"   ❌ Error getting tabs: {e}")
    
    print("\n3. Opening test page...")
    try:
        # Open the test HTML page
        test_page_path = Path(__file__).parent / "html_test_pages" / "basic_test.html"
        test_page_url = f"file://{test_page_path.absolute()}"
        
        open_command = TabCommand(action="open", url=test_page_url)
        open_response = await command_processor.execute(open_command)
        
        if open_response.success:
            print(f"   ✅ Opened test page: {test_page_url}")
            # Set as current tab for subsequent commands
            if open_response.data and 'tabId' in open_response.data:
                command_processor.set_current_tab(open_response.data['tabId'])
                print(f"   Tab ID: {open_response.data['tabId']}")
        else:
            print(f"   ❌ Failed to open test page: {open_response.error}")
    except Exception as e:
        print(f"   ❌ Error opening test page: {e}")
    
    print("\n4. Taking screenshot...")
    try:
        screenshot_command = ScreenshotCommand(include_cursor=True, quality=85)
        screenshot_response = await command_processor.execute(screenshot_command)
        
        if screenshot_response.success:
            print("   ✅ Screenshot captured successfully")
            # Save screenshot if image data is included
            if screenshot_response.data and 'imageData' in screenshot_response.data:
                import base64
                image_data = screenshot_response.data['imageData']
                
                # Remove data URL prefix if present
                if image_data.startswith('data:image/'):
                    header, data = image_data.split(',', 1)
                    image_data = data
                
                # Save to file
                screenshot_path = Path(__file__).parent / "demo_screenshot.png"
                with open(screenshot_path, 'wb') as f:
                    f.write(base64.b64decode(image_data))
                print(f"   📸 Saved to: {screenshot_path}")
        else:
            print(f"   ❌ Failed to capture screenshot: {screenshot_response.error}")
    except Exception as e:
        print(f"   ❌ Error capturing screenshot: {e}")
    
    print("\n5. Simulating keyboard input...")
    try:
        # Type some text (would need an input field to be focused)
        type_command = KeyboardTypeCommand(text="Hello from Local Chrome Server!")
        type_response = await command_processor.execute(type_command)
        
        if type_response.success:
            print(f"   ✅ Typed: \"{type_command.text}\"")
        else:
            print(f"   ❌ Failed to type: {type_response.error}")
    except Exception as e:
        print(f"   ❌ Error typing text: {e}")
    
    print("\n6. Simulating mouse click...")
    try:
        # This would click at position 0,0 (top-left) which may not be useful
        # In a real scenario, you'd use coordinates from screenshot analysis
        click_command = MouseClickCommand(button="left", count=1)
        click_response = await command_processor.execute(click_command)
        
        if click_response.success:
            print("   ✅ Mouse click simulated")
        else:
            print(f"   ❌ Failed to click: {click_response.error}")
    except Exception as e:
        print(f"   ❌ Error clicking: {e}")
    
    print("\n" + "=" * 50)
    print("🎬 Demo complete!")
    print("\nNext steps:")
    print("1. Use the CLI: chrome-cli interactive")
    print("2. Check API docs: http://127.0.0.1:8765")
    print("3. Run tests: pytest tests/")
    
    return True


async def demo_cli_style():
    """Demo using the CLI client directly"""
    print("\n📋 CLI-style Demo")
    print("-" * 50)
    
    import requests
    from cli.main import ChromeCLIClient
    
    client = ChromeCLIClient()
    
    print("1. Checking server health...")
    if client.health_check():
        print("   ✅ Server is healthy")
    else:
        print("   ❌ Server not responding")
        return
    
    print("\n2. Testing tab operations...")
    try:
        # Get tabs
        result = client.get_tabs()
        if result.get('success'):
            tabs = result.get('data', {}).get('tabs', [])
            print(f"   ✅ Found {len(tabs)} tabs")
        else:
            print(f"   ❌ Error: {result.get('error')}")
    except Exception as e:
        print(f"   ❌ Exception: {e}")
    
    print("\n3. Testing mouse commands...")
    try:
        result = client.mouse_move(100, 50)
        if result.get('success'):
            print("   ✅ Mouse move command sent")
        else:
            print(f"   ❌ Error: {result.get('error')}")
    except Exception as e:
        print(f"   ❌ Exception: {e}")
    
    print("\n✅ CLI demo complete")


def main():
    """Main demo function"""
    print("Local Chrome Server - Demonstration")
    print()
    
    # Run async demos
    try:
        asyncio.run(demo_basic_commands())
        # asyncio.run(demo_cli_style())  # Uncomment to test CLI client
    except KeyboardInterrupt:
        print("\n👋 Demo interrupted")
    except Exception as e:
        print(f"\n❌ Demo error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()