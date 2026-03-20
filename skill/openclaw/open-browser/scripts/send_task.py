#!/usr/bin/env python3
"""Submit automation task to OpenBrowser Agent.

Creates a conversation and sends a task to the OpenBrowser Agent.
Outputs SSE events in real-time.

Usage:
    python send_task.py "Go to example.com and extract the title" --chrome-uuid <uuid>
    python send_task.py "Fill the form at https://example.com/contact" --cwd /path/to/project --chrome-uuid <uuid>
    OPENBROWSER_CHROME_UUID=<uuid> python send_task.py "Scrape news from HN" --background --output task.log
"""

import argparse
import json
import os
import subprocess
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError


def emit(message: str) -> None:
    """Print a log line immediately, even when stdout is redirected."""
    print(message, flush=True)


def create_conversation(base_url: str, cwd: str, chrome_uuid: str | None = None) -> str:
    """Create a new conversation and return its ID."""
    request_body = {"cwd": cwd}
    if chrome_uuid:
        request_body["browser_id"] = chrome_uuid

    req = Request(
        f"{base_url}/agent/conversations",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["conversation_id"]


def check_server_status(base_url: str) -> dict:
    """Quick server status check."""
    try:
        req = Request(f"{base_url}/api")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {"websocket_connected": False}


def get_conversation_status(base_url: str, conversation_id: str) -> dict:
    """Get conversation status."""
    try:
        req = Request(f"{base_url}/agent/conversations/{conversation_id}")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {}


def stream_task(
    base_url: str, conversation_id: str, task: str, cwd: str, chrome_uuid: str
):
    """Stream task execution with SSE events in real time."""
    url = f"{base_url}/agent/conversations/{conversation_id}/messages"
    req = Request(
        url,
        data=json.dumps({"text": task, "cwd": cwd, "browser_id": chrome_uuid}).encode(
            "utf-8"
        ),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=None) as resp:
            emit(f"🔗 Connected: {conversation_id}")
            emit(f"📋 Task: {task}")
            emit("⏳ Running...")

            sse_event = None
            sse_data = None

            for line in resp:
                line = line.decode("utf-8").strip()

                # Empty line signals end of an event
                if not line:
                    if sse_event and sse_data:
                        try:
                            data = json.loads(sse_data)
                            format_event(sse_event, data)
                        except json.JSONDecodeError:
                            emit(f"[{sse_event}] {sse_data}")
                    # Reset for next event
                    sse_event = None
                    sse_data = None
                    continue

                # Parse SSE fields
                if line.startswith("event:"):
                    sse_event = line[6:].strip()
                elif line.startswith("data:"):
                    sse_data = line[5:].strip()

    except KeyboardInterrupt:
        emit("\n⚠️  Interrupted by user")
        emit(f"📊 Conversation ID: {conversation_id}")
        emit("   Resume or check status using the ID above.")
        sys.exit(130)


def format_event(event_type: str, data: dict):
    """Format and print SSE event.

    Args:
        event_type: SSE event type (e.g., "agent_event", "complete", "usage_metrics")
        data: Event data dictionary
    """
    # Handle SSE event types
    if event_type == "complete":
        emit(f"✅ Completed: {data.get('message', '')}")
        return

    # Handle usage metrics event
    if event_type == "usage_metrics":
        metrics = data.get("metrics", {})
        model_name = metrics.get("model_name", "unknown")
        cost = metrics.get("accumulated_cost", 0)
        token_usage = metrics.get("accumulated_token_usage", {})

        emit(f"📊 Cost: ¥{cost:.6f} | Model: {model_name}")

        if token_usage:
            prompt_tokens = token_usage.get("prompt_tokens", 0)
            completion_tokens = token_usage.get("completion_tokens", 0)
            reasoning_tokens = token_usage.get("reasoning_tokens", 0)
            total_tokens = token_usage.get("total_tokens", 0)

            # 如果 total_tokens 不存在或为0，则计算总数
            if total_tokens == 0:
                total_tokens = prompt_tokens + completion_tokens + reasoning_tokens

            if total_tokens > 0:
                token_details = f"   Tokens: {total_tokens:,} (prompt: {prompt_tokens:,}, completion: {completion_tokens:,}"
                if reasoning_tokens > 0:
                    token_details += f", reasoning: {reasoning_tokens:,}"
                token_details += ")"
                emit(token_details)
        return

    # Handle agent events (check data.type field)
    if event_type == "agent_event":
        data_type = data.get("type", "unknown")

        if data_type == "MessageEvent":
            role = data.get("role", "unknown")
            text = data.get("text", "")
            if role == "assistant":
                emit(f"🤖 {text[:200]}")

        elif data_type == "ThoughtEvent":
            content = data.get("thought", data.get("content", ""))
            if content:
                preview = content[:100] + "..." if len(content) > 100 else content
                emit(f"💭 {preview}")

        elif data_type == "ActionEvent":
            action = data.get("action", {})
            action_name = (
                action.get("action", "unknown")
                if isinstance(action, dict)
                else str(action)
            )
            emit(f"🔧 Action: {action_name}")

        elif data_type == "ObservationEvent":
            success = data.get("success", False)
            message = data.get("message", "")
            status = "✓" if success else "✗"
            if message:
                emit(f"👁️  {status} {message[:100]}")

        elif data_type == "ErrorEvent":
            error = data.get("error", "Unknown error")
            emit(f"❌ Error: {error}")


def main():
    parser = argparse.ArgumentParser(
        description="Submit automation task to OpenBrowser Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  python send_task.py "Open example.com" --chrome-uuid YOUR_BROWSER_UUID\n'
            '  python send_task.py "Fill out the form" --cwd /path/to/workspace --chrome-uuid YOUR_BROWSER_UUID\n'
            '  OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID python send_task.py "Run in background" --background --output /tmp/ob.log\n'
            "  python send_task.py --check\n"
            "  python send_task.py --status <conversation_id>"
        ),
    )
    parser.add_argument(
        "task",
        nargs="?",
        help="Task description for the agent to execute (optional with --check or --status)",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL (default: http://127.0.0.1:8765)",
    )
    parser.add_argument(
        "--cwd",
        default=".",
        help="Working directory for the agent (default: current directory)",
    )
    parser.add_argument(
        "--chrome-uuid",
        default=os.environ.get("OPENBROWSER_CHROME_UUID"),
        help=(
            "Browser UUID capability token for the Chrome instance to control. "
            "Can also be set via OPENBROWSER_CHROME_UUID."
        ),
    )
    parser.add_argument(
        "--background",
        action="store_true",
        help="Run in background (requires --output)",
    )
    parser.add_argument("--output", help="Output file for background mode or logging")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only check server status, don't submit task",
    )
    parser.add_argument(
        "--status", help="Check conversation status (requires conversation ID)"
    )

    args = parser.parse_args()

    if not args.check and not args.status and not args.chrome_uuid:
        emit(
            "Error: --chrome-uuid is required for browser automation "
            "(or set OPENBROWSER_CHROME_UUID)"
        )
        sys.exit(2)

    # Status check only
    if args.check:
        status = check_server_status(args.url)
        emit("OpenBrowser Server Status:")
        emit(f"  WebSocket Connected: {status.get('websocket_connected', False)}")
        emit(f"  Connections: {status.get('websocket_connections', 0)}")
        return

    # Conversation status check
    if args.status:
        status = get_conversation_status(args.url, args.status)
        emit(json.dumps(status, indent=2))
        return

    # Background execution
    if args.background:
        if not args.output:
            emit("❌ Background mode requires --output flag")
            sys.exit(1)

        # Build command (remove --background flag for child process)
        cmd = [
            sys.executable,
            __file__,
            args.task,
            "--url",
            args.url,
            "--cwd",
            args.cwd,
        ]
        if args.chrome_uuid:
            cmd.extend(["--chrome-uuid", args.chrome_uuid])

        with open(args.output, "a") as log_file:
            process = subprocess.Popen(
                cmd, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True
            )

        emit("🚀 Started task in background")
        emit(f"📝 PID: {process.pid}")
        emit(f"📄 Log file: {args.output}")
        emit(f"   Monitor with: tail -f {args.output}")
        return

    # Foreground execution
    if not args.task:
        parser.error("Task description is required (unless using --check or --status)")

    try:
        # Check server first
        status = check_server_status(args.url)
        if not status.get("websocket_connected"):
            emit("❌ Chrome extension not connected")
            emit("   Browser automation will not work without the extension.")
            emit("   Please install or refresh the OpenBrowser extension first.")
            sys.exit(1)

        # Create conversation
        conversation_id = create_conversation(args.url, args.cwd, args.chrome_uuid)

        # Stream task execution
        stream_task(args.url, conversation_id, args.task, args.cwd, args.chrome_uuid)

    except URLError as e:
        emit(f"❌ Cannot connect to OpenBrowser server: {e}")
        emit("   Make sure the server is running: uv run local-chrome-server serve")
        sys.exit(1)
    except Exception as e:
        emit(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
