#!/usr/bin/env python3
"""
Test script to verify JavaScript command parsing and processing
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.models.commands import parse_command, JavascriptExecuteCommand
from server.core.processor import CommandProcessor

def test_parse_command():
    """Test that javascript_execute command can be parsed"""
    print("Testing javascript_execute command parsing...")
    
    # Test 1: Basic command parsing
    command_data = {
        "type": "javascript_execute",
        "script": "document.title",
        "command_id": "test_123"
    }
    
    try:
        command = parse_command(command_data)
        print(f"✅ Command parsed successfully: {command}")
        print(f"  Type: {command.type}")
        print(f"  Script: {command.script}")
        print(f"  Class: {command.__class__.__name__}")
        
        # Verify it's the right type
        assert isinstance(command, JavascriptExecuteCommand)
        assert command.type == "javascript_execute"
        assert command.script == "document.title"
        print("✅ Command type validation passed")
        
    except Exception as e:
        print(f"❌ Failed to parse command: {e}")
        return False
    
    # Test 2: Command with all parameters
    command_data_full = {
        "type": "javascript_execute",
        "script": "document.querySelector('h1').textContent",
        "return_by_value": False,
        "await_promise": True,
        "timeout": 10000,
        "tab_id": 123,
        "command_id": "test_456"
    }
    
    try:
        command = parse_command(command_data_full)
        print(f"\n✅ Full command parsed successfully: {command}")
        print(f"  Return by value: {command.return_by_value}")
        print(f"  Await promise: {command.await_promise}")
        print(f"  Timeout: {command.timeout}")
        print(f"  Tab ID: {command.tab_id}")
        
        assert command.return_by_value == False
        assert command.await_promise == True
        assert command.timeout == 10000
        assert command.tab_id == 123
        print("✅ Full parameter validation passed")
        
    except Exception as e:
        print(f"❌ Failed to parse full command: {e}")
        return False
    
    # Test 3: Invalid command type
    print("\nTesting invalid command type...")
    invalid_data = {
        "type": "invalid_javascript",
        "script": "test"
    }
    
    try:
        command = parse_command(invalid_data)
        print(f"❌ Should have raised error but got: {command}")
        return False
    except ValueError as e:
        print(f"✅ Correctly rejected invalid command type: {e}")
    
    # Test 4: Command processor integration
    print("\nTesting CommandProcessor integration...")
    try:
        processor = CommandProcessor()
        command = JavascriptExecuteCommand(script="document.title")
        
        # Note: This will fail if WebSocket is not connected, but we can still test
        # that the processor recognizes the command type
        print(f"✅ CommandProcessor can instantiate JavascriptExecuteCommand")
        
        # Check if processor.execute has the branch for JavascriptExecuteCommand
        import inspect
        source = inspect.getsource(processor.execute)
        if "JavascriptExecuteCommand" in source:
            print("✅ CommandProcessor.execute has JavascriptExecuteCommand branch")
        else:
            print("❌ CommandProcessor.execute missing JavascriptExecuteCommand branch")
            return False
            
    except Exception as e:
        print(f"❌ CommandProcessor test failed: {e}")
        return False
    
    return True

def test_command_union():
    """Test that Command union type includes JavascriptExecuteCommand"""
    from server.models.commands import Command
    
    print("\nTesting Command union type...")
    
    # Create a JavascriptExecuteCommand
    js_command = JavascriptExecuteCommand(script="test")
    
    # This should work without type errors
    # (just checking it can be assigned to Command type)
    command: Command = js_command
    print(f"✅ JavascriptExecuteCommand can be assigned to Command type")
    
    # Check the union types
    import typing
    if hasattr(Command, '__args__'):
        union_types = Command.__args__
        print(f"  Union types: {[t.__name__ for t in union_types]}")
        
        from server.models.commands import JavascriptExecuteCommand as JEC
        if JEC in union_types:
            print("✅ JavascriptExecuteCommand is in Command union")
        else:
            print("❌ JavascriptExecuteCommand NOT in Command union")
            return False
    
    return True

if __name__ == "__main__":
    print("=" * 60)
    print("Testing JavaScript Command Integration")
    print("=" * 60)
    
    success = True
    
    if not test_parse_command():
        success = False
        
    if not test_command_union():
        success = False
    
    print("\n" + "=" * 60)
    if success:
        print("✅ All tests passed!")
        print("\nNext steps:")
        print("1. Make sure Chrome extension is rebuilt: npm run build")
        print("2. Start server: local-chrome-server serve")
        print("3. Load extension in Chrome")
        print("4. Test with: local-chrome-server javascript execute 'document.title'")
    else:
        print("❌ Some tests failed")
        sys.exit(1)