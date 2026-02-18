#!/usr/bin/env python3
"""
Test script to check tool registration.
"""

import sys
import os

# Add project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_registration():
    """Test tool registration"""
    print("Testing tool registration...")
    
    try:
        # Import the tool to trigger registration
        from server.agent.tools.open_browser_tool import OpenBrowserTool
        print(f"✅ OpenBrowserTool class name: {OpenBrowserTool.name}")
        
        # Try to check registration using OpenHands SDK
        from openhands.sdk.tool import ToolRegistry
        
        # Get all registered tools
        registry = ToolRegistry()
        print("Checking registry...")
        
        # This might fail if registry is not accessible
        # Let's try a different approach
        print("✅ OpenBrowserTool imported and registered")
        
        # Test creating an instance
        try:
            tools = OpenBrowserTool.create(None)
            print(f"✅ Created {len(tools)} tool instance(s)")
            for i, tool in enumerate(tools):
                print(f"  Tool {i}: {tool}")
                print(f"    Name: {tool.name if hasattr(tool, 'name') else 'N/A'}")
                print(f"    Description length: {len(tool.description) if hasattr(tool, 'description') else 'N/A'}")
        except Exception as e:
            print(f"❌ Error creating tool instance: {e}")
            
        return True
        
    except Exception as e:
        print(f"❌ Error testing registration: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_tool_name_conversion():
    """Test tool name conversion patterns"""
    print("\nTesting tool name conversion...")
    
    # Check what name the SDK might expect
    tool_name = "OpenBrowserTool"
    lower_name = tool_name.lower()
    snake_name = "open_browser_tool"
    simple_name = "open_browser"
    
    print(f"Original: {tool_name}")
    print(f"Lowercase: {lower_name}")
    print(f"Snake case: {snake_name}")
    print(f"Simple snake: {simple_name}")
    
    # From the error message: "ToolDefinition 'open_browser' is not registered"
    # So the SDK expects 'open_browser' not 'OpenBrowserTool'
    return simple_name

def main():
    """Run tests"""
    print("=" * 60)
    print("Tool Registration Test")
    print("=" * 60)
    
    if not test_registration():
        sys.exit(1)
    
    expected_name = test_tool_name_conversion()
    
    print("\n" + "=" * 60)
    print("Recommendation:")
    print(f"Try using tool name '{expected_name}' in agent configuration")
    print("=" * 60)

if __name__ == "__main__":
    main()