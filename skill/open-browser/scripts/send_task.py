#!/usr/bin/env python3
"""Submit automation task to OpenBrowser Agent.

Creates a conversation and sends a task to the OpenBrowser Agent.
Outputs SSE events in real-time.

Usage:
    python send_task.py "Go to example.com and extract the title"
    python send_task.py "Fill the form at https://example.com/contact" --cwd /path/to/project
    python send_task.py "Scrape news from HN" --background --output task.log
"""

import argparse
import json
import re
import subprocess
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError


def create_conversation(base_url: str, cwd: str) -> str:
    """Create a new conversation and return its ID."""
    req = Request(
        f"{base_url}/agent/conversations",
        data=json.dumps({"cwd": cwd}).encode("utf-8"),
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


def stream_task(base_url: str, conversation_id: str, task: str, cwd: str):
    """Stream task execution with SSE events."""
    url = f"{base_url}/agent/conversations/{conversation_id}/messages"
    req = Request(
        url,
        data=json.dumps({"text": task, "cwd": cwd}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=None) as resp:
            print(f"🔗 Connected to conversation: {conversation_id}")
            print(f"📋 Task: {task}")
            print("-" * 50)

            # SSE event parsing state
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
                            print(f"[{sse_event}] {sse_data}")
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
        print("\n⚠️  Interrupted by user")
        print(f"📊 Conversation ID: {conversation_id}")
        print("   Resume or check status using the ID above.")
        sys.exit(130)


def format_event(event_type: str, data: dict):
    """Format and print SSE event.

    Args:
        event_type: SSE event type (e.g., "agent_event", "complete", "usage_metrics")
        data: Event data dictionary
    """
    # Handle SSE event types
    if event_type == "complete":
        print("-" * 50)
        print(f"✅ Completed: {data.get('conversation_id', '')}")
        print(f"   {data.get('message', '')}")
        return

    # Handle usage metrics event
    if event_type == "usage_metrics":
        metrics = data.get("metrics", {})
        model_name = metrics.get("model_name", "unknown")
        cost = metrics.get("accumulated_cost", 0)
        token_usage = metrics.get("accumulated_token_usage", {})

        print("-" * 50)
        print(f"📊 Usage Metrics:")
        print(f"   Model: {model_name}")
        print(f"   Cost: ¥{cost:.6f}")

        if token_usage:
            prompt_tokens = token_usage.get("prompt_tokens", 0)
            completion_tokens = token_usage.get("completion_tokens", 0)
            total_tokens = token_usage.get("total_tokens", 0)
            if total_tokens > 0:
                print(
                    f"   Tokens: {total_tokens:,} (prompt: {prompt_tokens:,}, completion: {completion_tokens:,})"
                )
        return

    # Handle agent events (check data.type field)
    if event_type == "agent_event":
        data_type = data.get("type", "unknown")

        if data_type == "SystemPromptEvent":
            # System prompt - skip or summarize
            print("📝 System prompt loaded")

        elif data_type == "MessageEvent":
            role = data.get("role", "unknown")
            text = data.get("text", "")
            timestamp = data.get("timestamp", "")

            if role == "user":
                print(f"👤 User: {text}")
            elif role == "assistant":
                print(f"🤖 Assistant: {text}")
            else:
                print(f"💬 [{role}]: {text}")

        elif data_type == "ThoughtEvent":
            content = data.get("thought", data.get("content", ""))
            if content:
                # Show first 150 chars of thought
                preview = content[:150] + "..." if len(content) > 150 else content
                print(f"💭 Thinking: {preview}")

        elif data_type == "ActionEvent":
            # Extract action info from the text field which contains structured info
            text = data.get("text", "")
            action = data.get("action", "unknown")

            # Parse action from the string representation
            if action and "action=" in str(action):
                # Extract action type from string like "type='tab' action='init'"
                action_match = re.search(r"action='([^']+)'", str(action))
                if action_match:
                    action_name = action_match.group(1)
                else:
                    action_name = str(action).split()[0] if action else "unknown"
            else:
                action_name = str(action) if action else "unknown"

            print(f"🔧 Action: {action_name}")

            # Extract key info from text summary
            if "Summary:" in text:
                summary = text.split("Summary:")[1].split("\n")[0].strip()
                if summary:
                    print(f"   → {summary[:100]}")

        elif data_type == "ObservationEvent":
            success = data.get("success", False)
            message = data.get("message", "")
            has_image = "image" in data

            status_emoji = "✓" if success else "✗"
            extras = []

            if has_image:
                extras.append("📷 screenshot")

            extras_str = f" ({', '.join(extras)})" if extras else ""
            print(f"👁️  Observation: {status_emoji}{extras_str}")

            if message:
                print(f"   → {message[:100]}")

        elif data_type == "ErrorEvent":
            error = data.get("error", "Unknown error")
            print(f"❌ Error: {error}")

        else:
            # Unknown agent event type - show type and basic info
            print(
                f"📡 [{data_type}] {json.dumps(data, indent=2, ensure_ascii=False)[:200]}..."
            )

    else:
        # Unknown SSE event type
        print(f"❓ [{event_type}] {json.dumps(data, ensure_ascii=False)[:200]}")


def main():
    parser = argparse.ArgumentParser(
        description="Submit automation task to OpenBrowser Agent"
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

    # Status check only
    if args.check:
        status = check_server_status(args.url)
        print("OpenBrowser Server Status:")
        print(f"  WebSocket Connected: {status.get('websocket_connected', False)}")
        print(f"  Connections: {status.get('websocket_connections', 0)}")
        return

    # Conversation status check
    if args.status:
        status = get_conversation_status(args.url, args.status)
        print(json.dumps(status, indent=2))
        return

    # Background execution
    if args.background:
        if not args.output:
            print("❌ Background mode requires --output flag")
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

        with open(args.output, "a") as log_file:
            process = subprocess.Popen(
                cmd, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True
            )

        print(f"🚀 Started task in background")
        print(f"📝 PID: {process.pid}")
        print(f"📄 Log file: {args.output}")
        print(f"   Monitor with: tail -f {args.output}")
        return

    # Foreground execution
    if not args.task:
        parser.error("Task description is required (unless using --check or --status)")

    try:
        # Check server first
        status = check_server_status(args.url)
        if not status.get("websocket_connected"):
            print("⚠️  Warning: Chrome extension not connected")
            print("   Browser automation will not work without the extension.")
            print("   Please install and enable the OpenBrowser extension.")
            response = input("Continue anyway? (y/N): ")
            if response.lower() != "y":
                sys.exit(1)

        # Create conversation
        conversation_id = create_conversation(args.url, args.cwd)

        # Stream task execution
        stream_task(args.url, conversation_id, args.task, args.cwd)

    except URLError as e:
        print(f"❌ Cannot connect to OpenBrowser server: {e}")
        print("   Make sure the server is running: uv run local-chrome-server serve")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
