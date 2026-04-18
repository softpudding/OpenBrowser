#!/usr/bin/env python3
"""Check whether the local OpenBrowser service is ready for browser automation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def fetch_json(url: str) -> dict:
    request = Request(url)
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def check_server(base_url: str) -> dict:
    try:
        return fetch_json(f"{base_url}/health")
    except URLError:
        return {"status": "not_running", "error": "server not reachable"}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def check_extension(base_url: str) -> dict:
    try:
        data = fetch_json(f"{base_url}/api")
        return {
            "connected": data.get("websocket_connected", False),
            "connections": data.get("websocket_connections", 0),
        }
    except Exception as exc:
        return {"connected": False, "error": str(exc)}


def check_llm_config(base_url: str) -> dict:
    try:
        data = fetch_json(f"{base_url}/api/config/llm")
        config = data.get("config", {})
        return {
            "configured": config.get("has_api_key", False),
            "model": config.get("model"),
            "base_url": config.get("base_url"),
        }
    except Exception as exc:
        return {"configured": False, "error": str(exc)}


def check_browser_uuid(base_url: str, chrome_uuid: str) -> dict:
    try:
        data = fetch_json(f"{base_url}/browsers/{chrome_uuid}/valid")
        return {
            "provided": True,
            "valid": data.get("valid", False),
            "message": data.get("message", ""),
        }
    except Exception as exc:
        return {"provided": True, "valid": False, "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Check OpenBrowser readiness")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print machine-readable JSON"
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help="Optional browser UUID capability token",
    )
    args = parser.parse_args()

    results = {
        "server": check_server(args.url),
        "extension": check_extension(args.url),
        "llm_config": check_llm_config(args.url),
    }
    if args.chrome_uuid:
        results["browser_uuid"] = check_browser_uuid(args.url, args.chrome_uuid)

    ready = (
        results["server"].get("status") == "healthy"
        and results["extension"].get("connected", False)
        and results["llm_config"].get("configured", False)
    )
    if args.chrome_uuid:
        ready = ready and results["browser_uuid"].get("valid", False)
    results["ready"] = ready

    if args.json:
        print(json.dumps(results, indent=2, sort_keys=True))
        return 0 if ready else 1

    print("OpenBrowser status")
    print("==================")

    if results["server"].get("status") == "healthy":
        print("[OK] Server is running")
    else:
        print(f"[FAIL] Server: {results['server'].get('error', 'unknown error')}")

    if results["extension"].get("connected", False):
        count = results["extension"].get("connections", 0)
        print(f"[OK] Extension connected ({count} websocket connection(s))")
    else:
        print(f"[FAIL] Extension: {results['extension'].get('error', 'not connected')}")

    if results["llm_config"].get("configured", False):
        model = results["llm_config"].get("model", "unknown")
        print(f"[OK] LLM config present ({model})")
    else:
        print(
            f"[FAIL] LLM config: {results['llm_config'].get('error', 'API key missing')}"
        )

    if args.chrome_uuid:
        browser_uuid = results["browser_uuid"]
        if browser_uuid.get("valid", False):
            print("[OK] Browser UUID is valid and registered")
        else:
            error = (
                browser_uuid.get("error") or browser_uuid.get("message") or "invalid"
            )
            print(f"[FAIL] Browser UUID: {error}")

    if ready:
        print("Ready for browser automation.")
        return 0

    print("Not ready. See ~/.claude/skills/open-browser/references/setup.md if needed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
