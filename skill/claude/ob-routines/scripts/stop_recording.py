#!/usr/bin/env python3
"""Stop an active recording session.

Sends a stop command to the Chrome extension, which closes the recording
window and flushes the event buffer. Prints the final event count so the
agent knows how much was captured before kicking off compilation.

Example:
  python3 stop_recording.py abc123-recording-id
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    timeout: int = 15,
) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Stop an active recording session",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("recording_id", help="Recording ID from start_recording.py")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    args = parser.parse_args()

    try:
        result = request_json(
            f"{args.url}/recordings/{args.recording_id}/stop",
            method="POST",
            body={},
        )
    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Failed to stop recording: {exc}", file=sys.stderr)
        return 1

    if not result.get("success"):
        print(f"Stop failed: {result}", file=sys.stderr)
        return 1

    recording = result.get("recording") or {}
    event_count = recording.get("event_count", "?")
    name = recording.get("name") or ""
    stop_reason = result.get("stop_reason", "")

    display = f" ({name})" if name else ""
    print(f"[recording:stopped] {args.recording_id}{display}", flush=True)
    print(f"[recording:events] {event_count} events captured", flush=True)
    if stop_reason == "browser_disconnected":
        print(
            "[recording:warning] Browser was disconnected — recording marked stopped "
            "locally. Event capture may be incomplete.",
            flush=True,
        )

    print(
        f"\nRecording stopped. To compile this recording into a routine, run:\n\n"
        f"  python3 compile.py {args.recording_id}\n",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
