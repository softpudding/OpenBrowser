#!/usr/bin/env python3
"""
Example script demonstrating JavaScript execution in Local Chrome Server

This script shows how to use the new javascript_execute command
to run JavaScript code in browser tabs.

Prerequisites:
1. Local Chrome Server running (local-chrome-server serve)
2. Chrome extension loaded and connected
3. Managed tab initialized (tabs init <url>)

Usage:
  python javascript_execute_example.py
"""

import json
import requests
import time

# Server URL (default: http://127.0.0.1:8765)
SERVER_URL = "http://127.0.0.1:8765"

def check_server_health():
    """Check if server is running"""
    try:
        response = requests.get(f"{SERVER_URL}/health", timeout=2)
        return response.status_code == 200
    except requests.RequestException:
        return False

def execute_command(command):
    """Execute a command via API"""
    try:
        response = requests.post(
            f"{SERVER_URL}/command",
            json=command,
            timeout=30
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"API request failed: {e}")
        return None

def main():
    print("=== JavaScript Execution Example ===\n")
    
    # Check server health
    print("1. Checking server health...")
    if not check_server_health():
        print("❌ Server is not running. Please start it with:")
        print("   local-chrome-server serve")
        return
    print("✅ Server is running\n")
    
    # First, we need to initialize a managed session
    print("2. Initializing a managed session with example.com...")
    init_command = {
        "type": "tab",
        "action": "init",
        "url": "https://example.com"
    }
    init_result = execute_command(init_command)
    
    if not init_result or not init_result.get('success'):
        print("❌ Failed to initialize session. Make sure Chrome extension is loaded.")
        if init_result and init_result.get('error'):
            print(f"   Error: {init_result['error']}")
        return
    
    tab_id = init_result.get('data', {}).get('tabId')
    print(f"✅ Session initialized with tab ID: {tab_id}\n")
    
    # Wait for page to load
    print("3. Waiting for page to load...")
    time.sleep(2)
    
    # Example 1: Get page title
    print("4. Example 1: Getting page title via JavaScript")
    title_command = {
        "type": "javascript_execute",
        "script": "document.title",
        "tab_id": tab_id,
        "return_by_value": True
    }
    title_result = execute_command(title_command)
    
    if title_result and title_result.get('success'):
        result_data = title_result.get('data', {}).get('result', {})
        if result_data.get('value'):
            print(f"✅ Page title: {result_data['value']}")
        else:
            print(f"❌ No title value returned: {result_data}")
    else:
        print(f"❌ Failed to execute JavaScript: {title_result}")
    
    # Example 2: Get current URL
    print("\n5. Example 2: Getting current URL")
    url_command = {
        "type": "javascript_execute",
        "script": "window.location.href",
        "tab_id": tab_id
    }
    url_result = execute_command(url_command)
    
    if url_result and url_result.get('success'):
        result_data = url_result.get('data', {}).get('result', {})
        if result_data.get('value'):
            print(f"✅ Current URL: {result_data['value']}")
    
    # Example 3: Manipulate DOM (change page background color temporarily)
    print("\n6. Example 3: Changing page background color (temporary)")
    color_command = {
        "type": "javascript_execute",
        "script": """
            // Store original background
            const originalBg = document.body.style.backgroundColor;
            // Change to light blue
            document.body.style.backgroundColor = '#e6f3ff';
            // Return original color
            originalBg || 'transparent';
        """,
        "tab_id": tab_id
    }
    color_result = execute_command(color_command)
    
    if color_result and color_result.get('success'):
        result_data = color_result.get('data', {}).get('result', {})
        if result_data.get('value'):
            print(f"✅ Original background: {result_data['value']}")
            print("   Page background changed to light blue")
    
    # Wait a bit to see the color change
    time.sleep(1)
    
    # Example 4: Reset background color
    print("\n7. Example 4: Resetting background color")
    reset_command = {
        "type": "javascript_execute",
        "script": "document.body.style.backgroundColor = ''; 'Background reset'",
        "tab_id": tab_id
    }
    reset_result = execute_command(reset_command)
    
    if reset_result and reset_result.get('success'):
        print("✅ Background color reset")
    
    # Example 5: Get viewport dimensions
    print("\n8. Example 5: Getting viewport dimensions")
    viewport_command = {
        "type": "javascript_execute",
        "script": "({width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio})",
        "tab_id": tab_id
    }
    viewport_result = execute_command(viewport_command)
    
    if viewport_result and viewport_result.get('success'):
        result_data = viewport_result.get('data', {}).get('result', {})
        if result_data.get('value'):
            dims = result_data['value']
            print(f"✅ Viewport: {dims.get('width')}x{dims.get('height')} (device pixel ratio: {dims.get('devicePixelRatio')})")
    
    # Example 6: Complex object return
    print("\n9. Example 6: Getting page metadata as complex object")
    meta_command = {
        "type": "javascript_execute",
        "script": """
            ({
                title: document.title,
                url: window.location.href,
                charset: document.characterSet,
                doctype: document.doctype ? document.doctype.name : null,
                links: Array.from(document.links).slice(0, 5).map(link => ({
                    text: link.textContent.substring(0, 50),
                    href: link.href
                }))
            })
        """,
        "tab_id": tab_id
    }
    meta_result = execute_command(meta_command)
    
    if meta_result and meta_result.get('success'):
        result_data = meta_result.get('data', {}).get('result', {})
        if result_data.get('value'):
            meta = result_data['value']
            print(f"✅ Page metadata:")
            print(f"   Title: {meta.get('title')}")
            print(f"   URL: {meta.get('url')}")
            print(f"   Charset: {meta.get('charset')}")
            print(f"   Doctype: {meta.get('doctype')}")
            print(f"   First {len(meta.get('links', []))} links extracted")
    
    # Example 7: Error handling - executing invalid JavaScript
    print("\n10. Example 7: Error handling (intentional error)")
    error_command = {
        "type": "javascript_execute",
        "script": "undefinedVariable.someMethod()",  # This will throw an error
        "tab_id": tab_id
    }
    error_result = execute_command(error_command)
    
    if error_result and not error_result.get('success'):
        print(f"✅ JavaScript error caught as expected:")
        print(f"   Error: {error_result.get('error')}")
    elif error_result and error_result.get('data') and error_result['data'].get('exceptionDetails'):
        print(f"✅ JavaScript exception details:")
        exception = error_result['data']['exceptionDetails']
        if exception.get('exception'):
            print(f"   Exception: {exception['exception'].get('description')}")
        if exception.get('text'):
            print(f"   Error text: {exception['text']}")
    
    # Summary
    print("\n" + "="*50)
    print("Summary:")
    print("- JavaScript execution is fully integrated into Local Chrome Server")
    print("- Supports return_by_value for serializable results")
    print("- Exception details are captured and returned")
    print("- Can execute arbitrary JavaScript in browser context")
    print("- Works with managed tabs for isolation")
    print("\nTry it yourself with CLI:")
    print(f"  local-chrome-server javascript execute 'document.title' --tab-id {tab_id}")
    print("  local-chrome-server interactive")
    print("    Then type: javascript document.title")
    print("\nOr via direct API call:")
    print(f'  curl -X POST {SERVER_URL}/command \\')
    print('    -H "Content-Type: application/json" \\')
    print('    -d \'{"type": "javascript_execute", "script": "document.title"}\'')

if __name__ == "__main__":
    main()