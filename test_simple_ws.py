#!/usr/bin/env python3
"""Simple WebSocket test to see what's happening"""

import asyncio
import websockets
import json

async def simple_test():
    print("Connecting to ws://127.0.0.1:8766...")
    try:
        # Just connect and see what happens
        websocket = await websockets.connect("ws://127.0.0.1:8766")
        print("Connected!")
        
        # Immediately try to receive
        print("Waiting for message...")
        try:
            message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
            print(f"Got message: {message}")
        except asyncio.TimeoutError:
            print("No message received within 1 second")
            
        # Check if connection is still open
        print("Checking connection state...")
        print(f"Open: {websocket.open}")
        print(f"Closed: {websocket.closed}")
        
        # Try to send something
        print("Sending ping...")
        await websocket.send(json.dumps({"type": "ping"}))
        
        # Wait a bit more
        await asyncio.sleep(0.5)
        
        # Close
        await websocket.close()
        print("Closed connection")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(simple_test())