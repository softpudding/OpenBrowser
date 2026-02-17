#!/usr/bin/env python3
"""
Diagnosis script for Local Chrome Server connection issues
"""

import asyncio
import json
import sys
import time
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent / "server"
sys.path.insert(0, str(server_dir.parent))

try:
    import requests
    from websockets import connect, ConnectionClosed
    from server.core.config import config
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("Install with: uv sync")
    sys.exit(1)


def check_http_server():
    """Check if HTTP server is running"""
    print("🔍 Checking HTTP server (port 8765)...")
    try:
        response = requests.get("http://127.0.0.1:8765/health", timeout=2)
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ HTTP server is running: {data}")
            return True
        else:
            print(f"   ❌ HTTP server returned status {response.status_code}")
            return False
    except requests.ConnectionError:
        print("   ❌ HTTP server is not running")
        return False
    except Exception as e:
        print(f"   ❌ Error checking HTTP server: {e}")
        return False


async def check_websocket_server():
    """Check if WebSocket server is running"""
    print("🔍 Checking WebSocket server (port 8766)...")
    try:
        # Use asyncio.wait_for for timeout instead of connect timeout parameter
        try:
            websocket = await asyncio.wait_for(
                connect("ws://127.0.0.1:8766"),
                timeout=2
            )
        except asyncio.TimeoutError:
            print("   ❌ WebSocket connection timeout")
            return False
            
        async with websocket:
            # Try to receive welcome message
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=1)
                print(f"   ✅ WebSocket server is running")
                print(f"   📨 Received: {message[:100]}...")
                return True
            except asyncio.TimeoutError:
                print("   ⚠️  WebSocket connected but no welcome message")
                return True
            except Exception as e:
                print(f"   ⚠️  WebSocket connected but error: {e}")
                return True
    except ConnectionRefusedError:
        print("   ❌ WebSocket server is not running (connection refused)")
        return False
    except ConnectionClosed as e:
        print(f"   ❌ WebSocket connection closed: {e}")
        return False
    except Exception as e:
        print(f"   ❌ Error connecting to WebSocket server: {e}")
        return False


async def check_fastapi_websocket():
    """Check FastAPI WebSocket endpoint"""
    print("🔍 Checking FastAPI WebSocket endpoint (port 8765/ws)...")
    try:
        # Use asyncio.wait_for for timeout
        try:
            websocket = await asyncio.wait_for(
                connect("ws://127.0.0.1:8765/ws"),
                timeout=2
            )
        except asyncio.TimeoutError:
            print("   ❌ FastAPI WebSocket connection timeout")
            return False
            
        async with websocket:
            print("   ✅ FastAPI WebSocket endpoint is accessible")
            return True
    except ConnectionRefusedError:
        print("   ❌ FastAPI WebSocket endpoint not accessible")
        return False
    except Exception as e:
        print(f"   ❌ Error connecting to FastAPI WebSocket: {e}")
        return False


async def test_command_execution():
    """Test sending a simple command"""
    print("🔍 Testing command execution...")
    
    # First check HTTP server
    if not check_http_server():
        print("   ⏭️  Skipping command test - HTTP server not available")
        return False
    
    # Test simple command via HTTP
    try:
        command = {
            "type": "get_tabs",
            "command_id": "test-123"
        }
        
        response = requests.post(
            "http://127.0.0.1:8765/command",
            json=command,
            timeout=5
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"   ✅ Command executed: {result.get('message', 'No message')}")
            if result.get('success'):
                print(f"   📊 Success: {result.get('success')}")
                if result.get('data'):
                    tabs = result.get('data', {}).get('tabs', [])
                    print(f"   📑 Found {len(tabs)} tabs")
                return True
            else:
                print(f"   ❌ Command failed: {result.get('error', 'Unknown error')}")
                return False
        else:
            print(f"   ❌ HTTP error {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        print(f"   ❌ Error executing command: {e}")
        return False


def check_configuration():
    """Check server configuration"""
    print("🔍 Checking server configuration...")
    try:
        print(f"   📝 Host: {config.host}")
        print(f"   📝 Port: {config.port}")
        print(f"   📝 WebSocket port: {config.websocket_port}")
        if hasattr(config, 'preset_resolution'):
            width, height = config.preset_resolution
            print(f"   📝 Preset resolution: {width}x{height}")
        else:
            print(f"   📝 Preset resolution: Not configured")
        print(f"   📝 Log level: {config.log_level}")
        return True
    except Exception as e:
        print(f"   ❌ Error reading configuration: {e}")
        return False


def main():
    """Run all diagnostic checks"""
    print("=" * 60)
    print("Local Chrome Server - Connection Diagnostics")
    print("=" * 60)
    
    # Check configuration
    check_configuration()
    print()
    
    # Check HTTP server
    http_ok = check_http_server()
    print()
    
    # Check WebSocket servers
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    ws_ok = loop.run_until_complete(check_websocket_server())
    print()
    
    fastapi_ws_ok = loop.run_until_complete(check_fastapi_websocket())
    print()
    
    # Test command execution if HTTP is available
    command_ok = False
    if http_ok:
        command_ok = loop.run_until_complete(test_command_execution())
    print()
    
    # Summary
    print("=" * 60)
    print("📋 DIAGNOSTIC SUMMARY")
    print("=" * 60)
    
    print(f"HTTP Server (8765):        {'✅ OK' if http_ok else '❌ FAILED'}")
    print(f"WebSocket Server (8766):   {'✅ OK' if ws_ok else '❌ FAILED'}")
    print(f"FastAPI WebSocket (/ws):   {'✅ OK' if fastapi_ws_ok else '❌ FAILED'}")
    print(f"Command Execution:         {'✅ OK' if command_ok else '❌ FAILED'}")
    
    print()
    print("🔧 RECOMMENDATIONS:")
    
    if not http_ok:
        print("  • Start the server: local-chrome-server serve")
        print("  • Check if port 8765 is already in use")
        
    if http_ok and not ws_ok:
        print("  • WebSocket server may have failed to start")
        print("  • Check server logs for WebSocket startup errors")
        print("  • Try running with --log-level DEBUG")
        
    if http_ok and ws_ok and not command_ok:
        print("  • Server is running but commands failing")
        print("  • Check Chrome extension is loaded and connected")
        print("  • Check extension background page console for errors")
        
    if http_ok and command_ok:
        print("  • ✅ Server is functioning correctly!")
        print("  • Extension connectivity issues may be in extension itself")
        
    print()
    print("📝 For more help, see docs/ directory and AGENTS.md")


if __name__ == '__main__':
    main()