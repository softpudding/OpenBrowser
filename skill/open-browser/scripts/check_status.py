#!/usr/bin/env python3
"""Check OpenBrowser readiness status.

Verifies that the OpenBrowser server is running, the Chrome extension
is connected, and LLM API key is configured.

Usage:
    python check_status.py
    python check_status.py --json
    python check_status.py --chrome-uuid <uuid>
"""

import argparse
import json
import os
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError


def check_server(base_url: str) -> dict:
    """Check if server is running."""
    try:
        req = Request(f"{base_url}/health")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except URLError:
        return {"status": "not_running", "error": "Server not reachable"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_extension(base_url: str) -> dict:
    """Check if Chrome extension is connected."""
    try:
        req = Request(f"{base_url}/api")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return {
                "connected": data.get("websocket_connected", False),
                "connections": data.get("websocket_connections", 0),
            }
    except Exception as e:
        return {"connected": False, "error": str(e)}


def check_llm_config(base_url: str) -> dict:
    """Check if LLM API key is configured."""
    try:
        req = Request(f"{base_url}/api/config/llm")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            config = data.get("config", {})
            return {
                "configured": config.get("has_api_key", False),
                "model": config.get("model"),
                "base_url": config.get("base_url"),
            }
    except Exception as e:
        return {"configured": False, "error": str(e)}


def check_browser_uuid(base_url: str, chrome_uuid: str) -> dict:
    """Check if a browser UUID is currently registered and valid."""
    try:
        req = Request(f"{base_url}/browsers/{chrome_uuid}/valid")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return {
                "provided": True,
                "valid": data.get("valid", False),
                "message": data.get("message", ""),
            }
    except Exception as e:
        return {"provided": True, "valid": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="Check OpenBrowser readiness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python check_status.py\n"
            "  python check_status.py --chrome-uuid YOUR_BROWSER_UUID\n"
            "  OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID python check_status.py --json"
        ),
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL (default: http://127.0.0.1:8765)",
    )
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help=(
            "Optional browser UUID capability token to validate. "
            "Can also be set via OPENBROWSER_CHROME_UUID."
        ),
    )
    args = parser.parse_args()

    results = {
        "server": check_server(args.url),
        "extension": check_extension(args.url),
        "llm_config": check_llm_config(args.url),
    }

    if args.chrome_uuid:
        results["browser_uuid"] = check_browser_uuid(args.url, args.chrome_uuid)

    # Determine overall status
    all_ready = (
        results["server"].get("status") == "healthy"
        and results["extension"].get("connected", False)
        and results["llm_config"].get("configured", False)
    )
    if args.chrome_uuid:
        all_ready = all_ready and results["browser_uuid"].get("valid", False)
    results["ready"] = all_ready

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print("=" * 50)
        print("OpenBrowser Status Check")
        print("=" * 50)

        # Server status
        if results["server"].get("status") == "healthy":
            print("✅ Server: Running")
        else:
            error = results["server"].get("error", "Unknown error")
            print(f"❌ Server: {error}")

        # Extension status
        if results["extension"].get("connected"):
            conn_count = results["extension"].get("connections", 0)
            print(f"✅ Extension: Connected ({conn_count} connection(s))")
        else:
            error = results["extension"].get("error", "Not connected")
            print(f"❌ Extension: {error}")

        # LLM config status
        if results["llm_config"].get("configured"):
            model = results["llm_config"].get("model", "unknown")
            print(f"✅ LLM Config: {model}")
        else:
            error = results["llm_config"].get("error", "API key not configured")
            print(f"❌ LLM Config: {error}")

        if args.chrome_uuid:
            if results["browser_uuid"].get("valid"):
                print(f"✅ Browser UUID: Valid and registered")
            else:
                error = (
                    results["browser_uuid"].get("error")
                    or results["browser_uuid"].get("message")
                    or "UUID not registered"
                )
                print(f"❌ Browser UUID: {error}")

        print("=" * 50)
        if all_ready:
            print("🎉 OpenBrowser is ready to use!")
            sys.exit(0)
        else:
            print("⚠️  OpenBrowser is NOT ready. Please fix the issues above.")
            sys.exit(1)

    sys.exit(0 if all_ready else 1)


if __name__ == "__main__":
    main()
