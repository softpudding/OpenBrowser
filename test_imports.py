#!/usr/bin/env python3
"""
Test that all Python modules can be imported correctly
"""

import sys
import traceback

def test_import(module_name, import_statement):
    """Test importing a module"""
    try:
        exec(import_statement)
        print(f"✅ {module_name}: OK")
        return True
    except Exception as e:
        print(f"❌ {module_name}: FAILED - {e}")
        traceback.print_exc()
        return False

def main():
    print("Testing Local Chrome Server imports...")
    print("=" * 60)
    
    tests = [
        ("server.models.commands", "from server.models.commands import Command, parse_command"),
        ("server.core.config", "from server.core.config import config"),
        ("server.core.coordinates", "from server.core.coordinates import coord_manager"),
        ("server.core.processor", "from server.core.processor import command_processor"),
        ("server.websocket.manager", "from server.websocket.manager import ws_manager"),
        ("server.api.main", "from server.api.main import app"),
        ("cli.main", "from cli.main import ChromeCLIClient"),
    ]
    
    results = []
    for module_name, import_stmt in tests:
        results.append(test_import(module_name, import_stmt))
    
    print("=" * 60)
    success_count = sum(results)
    total_count = len(results)
    
    if success_count == total_count:
        print(f"✅ All {total_count} modules imported successfully!")
        return 0
    else:
        print(f"❌ {total_count - success_count} of {total_count} modules failed to import")
        return 1

if __name__ == '__main__':
    sys.exit(main())