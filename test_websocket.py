#!/usr/bin/env python3
"""Test WebSocket server connection"""

import asyncio
import websockets
import json
import time

async def test_connection():
    print("Testing connection to ws://127.0.0.1:8766")
    try:
        # Connect with longer timeout
        websocket = await asyncio.wait_for(
            websockets.connect("ws://127.0.0.1:8766"),
            timeout=5
        )
        
        async with websocket:
            print("✅ Connected")
            
            # Wait for welcome message
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=2)
                print(f"📨 Received message: {message}")
                
                # Try to send a ping
                ping_msg = json.dumps({"type": "ping"})
                await websocket.send(ping_msg)
                print("📤 Sent ping")
                
                # Wait for response
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=2)
                    print(f"📨 Response: {response}")
                except asyncio.TimeoutError:
                    print("⏱️  No response to ping")
                    
            except asyncio.TimeoutError:
                print("⏱️  No welcome message received")
                
            # Keep connection open for a bit
            print("Waiting 3 seconds...")
            await asyncio.sleep(3)
            print("Test complete")
            
    except ConnectionRefusedError:
        print("❌ Connection refused")
    except asyncio.TimeoutError:
        print("❌ Connection timeout")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_fastapi_ws():
    print("\nTesting connection to ws://127.0.0.1:8765/ws")
    try:
        websocket = await asyncio.wait_for(
            websockets.connect("ws://127.0.0.1:8765/ws"),
            timeout=5
        )
        
        async with websocket:
            print("✅ Connected to FastAPI WebSocket")
            
            # Try to send a command
            command = {
                "type": "get_tabs",
                "command_id": "test-123"
            }
            await websocket.send(json.dumps(command))
            print("📤 Sent get_tabs command")
            
            # Wait for response
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=5)
                print(f"📨 Response: {response}")
            except asyncio.TimeoutError:
                print("⏱️  No response to command")
                
    except ConnectionRefusedError:
        print("❌ Connection refused")
    except asyncio.TimeoutError:
        print("❌ Connection timeout")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connection())
    asyncio.run(test_fastapi_ws())