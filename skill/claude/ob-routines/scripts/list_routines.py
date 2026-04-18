#!/usr/bin/env python3
"""List saved routines and/or stopped recordings.

Routines are named, compiled browser workflows ready to replay.
Recordings are raw captured traces that may not yet be compiled.

Examples:
  python3 list_routines.py                    # list all routines
  python3 list_routines.py login              # filter by name/goal substring
  python3 list_routines.py --recordings       # list stopped recordings instead
  python3 list_routines.py --recordings login # filter recordings by name
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def request_json(url: str, *, timeout: int = 10) -> dict:
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def list_routines(base_url: str, query: str | None) -> int:
    try:
        data = request_json(f"{base_url}/routines")
    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1

    items = data.get("routines", [])
    if query:
        q = query.lower()
        items = [
            r for r in items if q in r["name"].lower() or q in r.get("goal", "").lower()
        ]

    if not items:
        suffix = f" matching {query!r}" if query else ""
        print(f"No routines found{suffix}.")
        return 0

    print(f"{'NAME':<30}  {'STEPS':>5}  {'GOAL'}")
    print("-" * 72)
    for r in items:
        name = r["name"]
        steps = r.get("step_count", "?")
        goal = r.get("goal", "")
        routine_id = r["routine_id"]
        print(f"{name:<30}  {steps:>5}  {goal}")
        print(f"  id={routine_id}")
    return 0


def list_recordings(base_url: str, query: str | None) -> int:
    try:
        data = request_json(f"{base_url}/recordings?status=stopped")
    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1

    items = data.get("recordings", [])
    if query:
        q = query.lower()
        items = [r for r in items if q in (r.get("name") or "").lower()]

    if not items:
        suffix = f" matching {query!r}" if query else ""
        print(f"No stopped recordings found{suffix}.")
        return 0

    print(f"{'NAME':<30}  {'EVENTS':>6}  {'RECORDING ID'}")
    print("-" * 72)
    for r in items:
        name = r.get("name") or "(unnamed)"
        events = r.get("event_count", "?")
        recording_id = r["recording_id"]
        compiled = "(compiled)" if (r.get("metadata") or {}).get("routine_id") else ""
        print(f"{name:<30}  {events:>6}  {recording_id}  {compiled}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List saved routines or stopped recordings",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "query",
        nargs="?",
        help="Filter by name or goal substring (case-insensitive)",
    )
    parser.add_argument(
        "--recordings",
        action="store_true",
        help="List stopped recordings instead of compiled routines",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    args = parser.parse_args()

    if args.recordings:
        return list_recordings(args.url, args.query)
    return list_routines(args.url, args.query)


if __name__ == "__main__":
    sys.exit(main())
