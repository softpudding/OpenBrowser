#!/usr/bin/env python3
"""Execute a saved Browser Routine in Chrome.

Looks up the routine by name (exact or prefix match, case-insensitive),
creates an agent conversation in routine_replay mode, sends the routine
markdown as the task, and streams execution output.

Examples:
  python3 replay.py "techforum-upvote" --chrome-uuid "$OPENBROWSER_CHROME_UUID"
  python3 replay.py login               # prefix match
  python3 replay.py --list              # list all available routines
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Routine lookup
# ---------------------------------------------------------------------------


def find_routine(base_url: str, query: str) -> dict | None:
    """Return a single routine matching query by exact name, then prefix, then substring."""
    data = request_json(f"{base_url}/routines")
    routines = data.get("routines", [])
    if not routines:
        return None

    q = query.lower()

    # 1. Exact name match
    for r in routines:
        if r["name"].lower() == q:
            return r

    # 2. Exact routine_id match
    for r in routines:
        if r["routine_id"].lower() == q:
            return r

    # 3. Prefix match on name
    prefix = [r for r in routines if r["name"].lower().startswith(q)]
    if len(prefix) == 1:
        return prefix[0]
    if len(prefix) > 1:
        print("[replay:ambiguous] Multiple routines match that prefix:", flush=True)
        for r in prefix:
            print(f"  {r['name']}  (id={r['routine_id']})", flush=True)
        print("Provide a more specific name or the full routine_id.", flush=True)
        return None

    # 4. Substring match on name or goal
    sub = [
        r for r in routines
        if q in r["name"].lower() or q in r.get("goal", "").lower()
    ]
    if len(sub) == 1:
        return sub[0]
    if len(sub) > 1:
        print("[replay:ambiguous] Multiple routines match that substring:", flush=True)
        for r in sub:
            print(f"  {r['name']}  (id={r['routine_id']})", flush=True)
        print("Provide a more specific name or the full routine_id.", flush=True)
        return None

    return None


# ---------------------------------------------------------------------------
# SSE streaming  (same conventions as send_task.py)
# ---------------------------------------------------------------------------


def _format_event(event_type: str, data: dict) -> None:
    if event_type == "complete":
        print(f"[complete] {data.get('message', '')}", flush=True)
        return

    if event_type == "usage_metrics":
        metrics = data.get("metrics", {})
        model_name = metrics.get("model_name", "unknown")
        cost = metrics.get("accumulated_cost", 0)
        token_usage = metrics.get("accumulated_token_usage", {})
        total_tokens = token_usage.get("total_tokens", 0)
        if total_tokens == 0:
            total_tokens = (
                token_usage.get("prompt_tokens", 0)
                + token_usage.get("completion_tokens", 0)
                + token_usage.get("reasoning_tokens", 0)
            )
        print(
            f"[usage] model={model_name} cost_rmb={cost:.6f} tokens={total_tokens}",
            flush=True,
        )
        return

    if event_type != "agent_event":
        print(f"[{event_type}] {json.dumps(data, ensure_ascii=False)}", flush=True)
        return

    data_type = data.get("type", "unknown")

    if data_type == "SystemPromptEvent":
        text_len = len(data.get("text", ""))
        print(
            f"[system_prompt] suppressed ({text_len} chars)",
            flush=True,
        )
        return

    if data_type == "MessageEvent":
        role = data.get("role", "unknown")
        text = data.get("text", "")
        print(f"[message:{role}] {text}", flush=True)
        return

    if data_type == "ThoughtEvent":
        thought = data.get("thought", data.get("content", ""))
        print(f"[thought] {thought}", flush=True)
        return

    if data_type == "ActionEvent":
        action = data.get("action", {})
        if isinstance(action, dict):
            action_name = action.get("action", "unknown")
            element_id = action.get("element_id")
            url = action.get("url")
            text = action.get("text")
            extras = []
            if element_id:
                extras.append(f"element_id={element_id}")
            if url:
                extras.append(f"url={url}")
            if text:
                extras.append(f"text={text!r}")
            suffix = (" " + " ".join(extras)) if extras else ""
            print(f"[action] {action_name}{suffix}", flush=True)
        else:
            print(f"[action] {action}", flush=True)
        return

    if data_type == "ObservationEvent":
        success = data.get("success", False)
        message = data.get("message", "")
        state = "ok" if success else "error"
        print(f"[observation:{state}] {message}", flush=True)
        return

    if data_type == "ErrorEvent":
        print(f"[error] {data.get('error', 'unknown error')}", flush=True)
        return

    print(
        f"[agent_event:{data_type}] {json.dumps(data, ensure_ascii=False)}",
        flush=True,
    )


def stream_replay(
    base_url: str,
    conversation_id: str,
    task: str,
    cwd: str,
    chrome_uuid: str,
) -> None:
    req = Request(
        f"{base_url}/agent/conversations/{conversation_id}/messages",
        data=json.dumps({
            "text": task,
            "cwd": cwd,
            "browser_id": chrome_uuid,
        }).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    with urlopen(req, timeout=None) as response:
        sse_event: str | None = None
        sse_data: str | None = None
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\n")
            if not line:
                if sse_event and sse_data is not None:
                    try:
                        _format_event(sse_event, json.loads(sse_data))
                    except json.JSONDecodeError:
                        print(f"[{sse_event}] {sse_data}", flush=True)
                sse_event = None
                sse_data = None
                continue

            if line.startswith("event:"):
                sse_event = line[6:].strip()
            elif line.startswith("data:"):
                sse_data = line[5:].lstrip()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replay a saved Browser Routine in Chrome",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "routine",
        nargs="?",
        help="Routine name, ID, or prefix to replay",
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help="Browser UUID capability token (or set OPENBROWSER_CHROME_UUID)",
    )
    parser.add_argument(
        "--cwd",
        default=".",
        help="Working directory passed to the agent",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available routines and exit",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    args = parser.parse_args()

    try:
        if args.list or not args.routine:
            data = request_json(f"{args.url}/routines")
            routines = data.get("routines", [])
            if not routines:
                print("No routines saved yet.")
                return 0
            print(f"{'NAME':<30}  {'STEPS':>5}  GOAL")
            print("-" * 72)
            for r in routines:
                print(f"{r['name']:<30}  {r.get('step_count', '?'):>5}  {r.get('goal', '')}")
            return 0

        if not args.chrome_uuid:
            print(
                "Browser UUID is required. Set OPENBROWSER_CHROME_UUID or pass --chrome-uuid.",
                file=sys.stderr,
            )
            return 2

        # ── Find the routine ──────────────────────────────────────────────
        routine = find_routine(args.url, args.routine)
        if routine is None:
            print(
                f"[replay:not_found] No routine found matching {args.routine!r}. "
                "Run with --list to see available routines.",
                file=sys.stderr,
            )
            return 1

        name = routine["name"]
        routine_id = routine["routine_id"]
        goal = routine.get("goal", "")
        routine_markdown = routine.get("routine_markdown", "")

        print(f"[replay:routine] {name}  id={routine_id}", flush=True)
        if goal:
            print(f"[replay:goal] {goal}", flush=True)

        # ── Validate browser UUID ─────────────────────────────────────────
        browser_status = request_json(f"{args.url}/browsers/{args.chrome_uuid}/valid")
        if not browser_status.get("valid", False):
            msg = browser_status.get("message", "browser UUID is not valid")
            print(f"Browser UUID validation failed: {msg}", file=sys.stderr)
            return 1

        # ── Create conversation in routine_replay mode ────────────────────
        conv_result = request_json(
            f"{args.url}/agent/conversations",
            method="POST",
            body={
                "cwd": args.cwd,
                "browser_id": args.chrome_uuid,
                "mode": "routine_replay",
            },
        )
        conversation_id = conv_result["conversation_id"]
        print(f"[replay:conversation] {conversation_id}", flush=True)

        # ── Send routine markdown as the task ────────────────────────────
        stream_replay(
            args.url,
            conversation_id,
            routine_markdown,
            args.cwd,
            args.chrome_uuid,
        )
        return 0

    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Replay failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
