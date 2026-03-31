#!/usr/bin/env python3
"""Submit a task to the local OpenBrowser agent and stream the result."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    timeout: int | None = 10,
    extra_headers: dict[str, str] | None = None,
) -> dict:
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def create_conversation(base_url: str, cwd: str, chrome_uuid: str) -> str:
    payload = {"cwd": cwd, "browser_id": chrome_uuid}
    data = request_json(
        f"{base_url}/agent/conversations",
        method="POST",
        body=payload,
    )
    return data["conversation_id"]


def check_server_status(base_url: str) -> dict:
    try:
        return request_json(f"{base_url}/api")
    except Exception:
        return {"websocket_connected": False}


def validate_browser_uuid(base_url: str, chrome_uuid: str) -> dict:
    return request_json(f"{base_url}/browsers/{chrome_uuid}/valid")


def get_conversation_status(base_url: str, conversation_id: str) -> dict:
    return request_json(f"{base_url}/agent/conversations/{conversation_id}")


def format_event(event_type: str, data: dict) -> None:
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
        print(f"[{event_type}] {json.dumps(data, ensure_ascii=True)}", flush=True)
        return

    data_type = data.get("type", "unknown")
    if data_type == "MessageEvent":
        role = data.get("role", "unknown")
        text = data.get("text", "")
        print(f"[message:{role}] {text[:400]}", flush=True)
        return

    if data_type == "ThoughtEvent":
        thought = data.get("thought", data.get("content", ""))
        print(f"[thought] {thought[:200]}", flush=True)
        return

    if data_type == "ActionEvent":
        action = data.get("action", {})
        if isinstance(action, dict):
            action_name = action.get("action", "unknown")
            print(f"[action] {action_name}", flush=True)
        else:
            print(f"[action] {action}", flush=True)
        return

    if data_type == "ObservationEvent":
        success = data.get("success", False)
        message = data.get("message", "")
        state = "ok" if success else "error"
        print(f"[observation:{state}] {message[:200]}", flush=True)
        return

    if data_type == "ErrorEvent":
        print(f"[error] {data.get('error', 'unknown error')}", flush=True)
        return

    print(
        f"[agent_event:{data_type}] {json.dumps(data, ensure_ascii=True)}",
        flush=True,
    )


def stream_task(
    base_url: str,
    conversation_id: str,
    task: str,
    cwd: str,
    chrome_uuid: str,
) -> None:
    request = Request(
        f"{base_url}/agent/conversations/{conversation_id}/messages",
        data=json.dumps({"text": task, "cwd": cwd, "browser_id": chrome_uuid}).encode(
            "utf-8"
        ),
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    print(f"[conversation] {conversation_id}", flush=True)
    print(f"[task] {task}", flush=True)

    with urlopen(request, timeout=None) as response:
        sse_event = None
        sse_data = None
        for raw_line in response:
            line = raw_line.decode("utf-8").strip()
            if not line:
                if sse_event and sse_data:
                    try:
                        format_event(sse_event, json.loads(sse_data))
                    except json.JSONDecodeError:
                        print(f"[{sse_event}] {sse_data}", flush=True)
                sse_event = None
                sse_data = None
                continue

            if line.startswith("event:"):
                sse_event = line[6:].strip()
            elif line.startswith("data:"):
                sse_data = line[5:].strip()


def start_background_process(args: argparse.Namespace) -> int:
    if not args.output:
        print("Background mode requires --output.", file=sys.stderr)
        return 2

    command = [
        sys.executable,
        __file__,
        args.task,
        "--url",
        args.url,
        "--cwd",
        args.cwd,
        "--chrome-uuid",
        args.chrome_uuid,
    ]

    with open(args.output, "a", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            command,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    print(f"Started background task. pid={process.pid} log={args.output}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a task to OpenBrowser")
    parser.add_argument("task", nargs="?", help="Task for the browser agent")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    parser.add_argument(
        "--cwd",
        default=".",
        help="Working directory passed to the browser agent",
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help="Browser UUID capability token",
    )
    parser.add_argument(
        "--background",
        action="store_true",
        help="Spawn a detached process and write logs to --output",
    )
    parser.add_argument("--output", help="Log file used with --background")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Print server status without creating a conversation",
    )
    parser.add_argument(
        "--status",
        help="Print the JSON status for an existing conversation ID",
    )
    parser.add_argument(
        "--allow-no-extension",
        action="store_true",
        help="Skip the extension connectivity guard",
    )
    args = parser.parse_args()

    if args.check:
        data = check_server_status(args.url)
        print(json.dumps(data, indent=2, sort_keys=True))
        if args.chrome_uuid:
            print(
                json.dumps(
                    validate_browser_uuid(args.url, args.chrome_uuid),
                    indent=2,
                    sort_keys=True,
                )
            )
        return 0

    if args.status:
        print(json.dumps(get_conversation_status(args.url, args.status), indent=2))
        return 0

    if not args.task:
        parser.error("task is required unless --check or --status is used")

    if not args.chrome_uuid:
        print(
            "Browser UUID is required. Set OPENBROWSER_CHROME_UUID or pass --chrome-uuid.",
            file=sys.stderr,
        )
        return 2

    if args.background:
        return start_background_process(args)

    try:
        status = check_server_status(args.url)
        if not status.get("websocket_connected", False) and not args.allow_no_extension:
            print(
                "Chrome extension is not connected. Run check_status.py and fix setup first.",
                file=sys.stderr,
            )
            return 1

        browser_status = validate_browser_uuid(args.url, args.chrome_uuid)
        if not browser_status.get("valid", False):
            message = browser_status.get("message", "browser UUID is not valid")
            print(f"Browser UUID validation failed: {message}", file=sys.stderr)
            return 1

        conversation_id = create_conversation(args.url, args.cwd, args.chrome_uuid)
        stream_task(args.url, conversation_id, args.task, args.cwd, args.chrome_uuid)
        return 0
    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"OpenBrowser task failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
