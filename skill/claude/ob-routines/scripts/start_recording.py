#!/usr/bin/env python3
"""Start a new browser recording session.

The server sends a command to the Chrome extension which opens a dedicated
recording window. After this script exits, the user performs their actions
in that browser window. When done, they return to the terminal and run
stop_recording.py with the printed recording_id.

Example:
  python3 start_recording.py \\
    --chrome-uuid "$OPENBROWSER_CHROME_UUID" \\
    --name "Gmail compose flow" \\
    --intent "draft a new email to a contact and send it"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    timeout: int = 10,
) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Start a new recording session in Chrome",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help="Browser UUID capability token (or set OPENBROWSER_CHROME_UUID)",
    )
    parser.add_argument(
        "--name",
        help="Human-readable name for this recording session",
    )
    parser.add_argument(
        "--intent",
        help="Short description of what you intend to record (guides compilation later)",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    args = parser.parse_args()

    if not args.chrome_uuid:
        print(
            "Browser UUID is required. Set OPENBROWSER_CHROME_UUID or pass --chrome-uuid.",
            file=sys.stderr,
        )
        return 2

    try:
        # Validate browser connectivity first
        browser_status = request_json(f"{args.url}/browsers/{args.chrome_uuid}/valid")
        if not browser_status.get("valid", False):
            msg = browser_status.get("message", "browser UUID is not valid")
            print(f"Browser UUID validation failed: {msg}", file=sys.stderr)
            return 1

        # Create and start recording
        payload: dict = {"browser_id": args.chrome_uuid}
        if args.name:
            payload["name"] = args.name

        result = request_json(f"{args.url}/recordings", method="POST", body=payload)
        if not result.get("success"):
            print(f"Failed to create recording: {result}", file=sys.stderr)
            return 1

        recording = result["recording"]
        recording_id = recording["recording_id"]

        # Save intent note if provided
        if args.intent:
            request_json(
                f"{args.url}/recordings/{recording_id}/intent-note",
                method="POST",
                body={"intent_note": args.intent},
            )

    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Failed to start recording: {exc}", file=sys.stderr)
        return 1

    name_display = f" ({args.name})" if args.name else ""
    print(f"[recording:started] {recording_id}{name_display}", flush=True)
    if args.intent:
        print(f"[recording:intent] {args.intent}", flush=True)
    print(
        "\nA recording window has opened in Chrome.\n"
        "Perform your actions in the browser, then return here and run:\n\n"
        f"  python3 stop_recording.py {recording_id}\n",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
