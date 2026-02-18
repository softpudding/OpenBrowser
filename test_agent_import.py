#!/usr/bin/env python3
"""
Test script to verify OpenBrowserAgent imports and basic functionality.
"""

import sys
import os

# Add project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_imports():
    """Test basic imports"""
    print("Testing imports...")
    
    # Test OpenHands SDK imports
    try:
        from openhands.sdk import Action, Observation, ToolDefinition
        print("✅ OpenHands SDK imports successful")
    except ImportError as e:
        print(f"❌ OpenHands SDK import failed: {e}")
        return False
    
    # Test server imports
    try:
        from server.core.processor import command_processor
        print("✅ Server command processor import successful")
    except ImportError as e:
        print(f"⚠️  Server command processor import warning: {e}")
        # This might be OK if server isn't fully initialized
    
    # Test agent imports
    try:
        from server.agent.tools.open_browser_tool import OpenBrowserTool
        print("✅ OpenBrowserTool import successful")
    except ImportError as e:
        print(f"❌ OpenBrowserTool import failed: {e}")
        return False
    
    # Test agent manager imports
    try:
        from server.agent.agent import agent_manager
        print("✅ Agent manager import successful")
    except ImportError as e:
        print(f"❌ Agent manager import failed: {e}")
        return False
    
    return True

def test_tool_registration():
    """Test if OpenBrowserTool is registered"""
    print("\nTesting tool registration...")
    
    try:
        from openhands.sdk.tool import get_registered_tools
        tools = get_registered_tools()
        
        print(f"Registered tools: {list(tools.keys())}")
        
        if "OpenBrowserTool" in tools:
            print("✅ OpenBrowserTool is registered")
            return True
        else:
            print("❌ OpenBrowserTool is NOT registered")
            return False
            
    except Exception as e:
        print(f"❌ Error checking tool registration: {e}")
        return False

def test_api_endpoints():
    """Test API endpoint imports"""
    print("\nTesting API endpoint imports...")
    
    try:
        from server.api.main import app
        print("✅ FastAPI app import successful")
        
        # Check if agent endpoints are defined
        routes = [route.path for route in app.routes]
        agent_routes = [r for r in routes if '/agent/' in r]
        
        print(f"Found {len(agent_routes)} agent routes:")
        for route in agent_routes:
            print(f"  - {route}")
        
        if len(agent_routes) > 0:
            print("✅ Agent API endpoints are defined")
            return True
        else:
            print("❌ No agent API endpoints found")
            return False
            
    except ImportError as e:
        print(f"❌ API import failed: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("OpenBrowserAgent Integration Test")
    print("=" * 60)
    
    success = True
    
    # Test 1: Basic imports
    if not test_imports():
        success = False
    
    # Test 2: Tool registration
    if not test_tool_registration():
        success = False
    
    # Test 3: API endpoints
    if not test_api_endpoints():
        success = False
    
    print("\n" + "=" * 60)
    if success:
        print("✅ All tests passed! OpenBrowserAgent integration looks good.")
        print("\nNext steps:")
        print("1. Set LLM_API_KEY environment variable")
        print("2. Start the server: uv run local-chrome-server serve")
        print("3. Load Chrome extension")
        print("4. Test agent via API endpoints")
    else:
        print("❌ Some tests failed. Please check the errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()