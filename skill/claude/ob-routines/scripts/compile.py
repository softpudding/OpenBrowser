#!/usr/bin/env python3
"""Compile a stopped recording into a named Browser Routine.

Starts the Compiler Agent, streams its SSE output, and acts as a bridge
between the agent and the user:
  - Agent reasoning and tool calls are printed to stdout as they arrive.
  - When the compiler agent asks a clarification question (status=asking),
    this script prints the question and reads the user's answer from stdin,
    then resumes compilation via /compile/answer.
  - When the agent stalls (status=stalled), the agent's last message is
    shown and the user can send a follow-up.
  - When compilation completes (status=review), the script prompts the user
    to name the routine, then calls /compile/finalize to save it.

The outer agent (Claude Code / Codex) should relay the printed questions to
the user and feed their responses back via stdin — it should NOT try to
re-implement compiler logic.

Example:
  python3 compile.py abc123-recording-id
  python3 compile.py abc123-recording-id --model-alias fast
"""

from __future__ import annotations

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# SSE event formatting  (same conventions as send_task.py)
# ---------------------------------------------------------------------------


def _format_compiler_event(event_type: str, data: dict) -> None:
    """Print one SSE event from the compiler agent stream."""
    if event_type == "error":
        print(f"[compiler:error] {data.get('error', data)}", flush=True)
        return

    if event_type != "agent_event":
        # Pass-through for unknown top-level event types
        print(f"[{event_type}] {json.dumps(data, ensure_ascii=False)}", flush=True)
        return

    data_type = data.get("type", "unknown")

    if data_type == "SystemPromptEvent":
        text_len = len(data.get("text", ""))
        print(
            f"[compiler:system_prompt] suppressed ({text_len} chars)",
            flush=True,
        )
        return

    if data_type == "ThoughtEvent":
        thought = data.get("thought", data.get("content", ""))
        print(f"[compiler:thought] {thought}", flush=True)
        return

    if data_type == "ActionEvent":
        action = data.get("action", {})
        if isinstance(action, dict):
            action_name = action.get("action", "unknown")
            if action_name == "ask_user":
                question = action.get("question", "")
                print(f"[compiler:ask_user] {question}", flush=True)
            else:
                # FileEditorTool, TraceViewerTool, SubmitWorkflowTool, etc.
                extras = {
                    k: v for k, v in action.items() if k != "action" and v is not None
                }
                suffix = (
                    (" " + json.dumps(extras, ensure_ascii=False)) if extras else ""
                )
                print(f"[compiler:action] {action_name}{suffix}", flush=True)
        else:
            print(f"[compiler:action] {action}", flush=True)
        return

    if data_type == "ObservationEvent":
        success = data.get("success", False)
        message = data.get("message", "")
        state = "ok" if success else "error"
        print(f"[compiler:observation:{state}] {message}", flush=True)
        return

    if data_type == "MessageEvent":
        role = data.get("role", "unknown")
        text = data.get("text", "")
        print(f"[compiler:message:{role}] {text}", flush=True)
        return

    if data_type == "ErrorEvent":
        print(f"[compiler:error] {data.get('error', 'unknown error')}", flush=True)
        return

    print(
        f"[compiler:agent_event:{data_type}] {json.dumps(data, ensure_ascii=False)}",
        flush=True,
    )


# ---------------------------------------------------------------------------
# SSE streaming
# ---------------------------------------------------------------------------


def _stream_sse(url: str, body: dict) -> dict | None:
    """POST to url with body, stream SSE events, return the final complete result.

    Returns the ``result`` dict from the complete event, or None on error.
    """
    req = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    complete_result: dict | None = None
    sse_event: str | None = None
    sse_data: str | None = None

    try:
        with urlopen(req, timeout=None) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8").rstrip("\n")
                if not line:
                    if sse_event and sse_data is not None:
                        try:
                            parsed = json.loads(sse_data)
                        except json.JSONDecodeError:
                            parsed = {"raw": sse_data}

                        if sse_event == "complete":
                            complete_result = parsed.get("result", parsed)
                        else:
                            _format_compiler_event(sse_event, parsed)

                    sse_event = None
                    sse_data = None
                    continue

                if line.startswith("event:"):
                    sse_event = line[6:].strip()
                elif line.startswith("data:"):
                    sse_data = line[5:].lstrip()

    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        print(
            f"[compiler:http_error] {exc.code} {exc.reason}: {body_text}",
            file=sys.stderr,
        )
        return None

    return complete_result


# ---------------------------------------------------------------------------
# Compile loop
# ---------------------------------------------------------------------------


def compile_recording(base_url: str, recording_id: str, model_alias: str | None) -> int:
    """Run the compile → Q&A → finalize flow. Returns exit code."""
    print(f"[compiler:start] recording={recording_id}", flush=True)

    # ── Phase 1: initial compile ──────────────────────────────────────────
    compile_body: dict = {}
    if model_alias:
        compile_body["model_alias"] = model_alias

    result = _stream_sse(
        f"{base_url}/recordings/{recording_id}/compile",
        body=compile_body,
    )
    if result is None:
        return 1

    # ── Phase 2: Q&A loop ─────────────────────────────────────────────────
    while True:
        status = result.get("status")

        if status == "asking":
            question = result.get("question", "")
            print(f"\n[compiler:question] {question}", flush=True)
            print(
                "[compiler:waiting_for_answer] Type your answer and press Enter:",
                flush=True,
            )
            try:
                answer = input().strip()
            except (EOFError, KeyboardInterrupt):
                print("\n[compiler:interrupted] Compilation cancelled.", flush=True)
                return 130

            result = _stream_sse(
                f"{base_url}/recordings/{recording_id}/compile/answer",
                body={"answer": answer},
            )
            if result is None:
                return 1

        elif status == "stalled":
            # Agent replied in prose instead of calling ask_user.
            # Show the message and let the user send a follow-up.
            message = result.get("message", "")
            if message:
                print(f"\n[compiler:stalled] {message}", flush=True)
            print(
                "[compiler:waiting_for_follow_up] Agent stalled — send a follow-up "
                "(or press Enter to continue without one):",
                flush=True,
            )
            try:
                follow_up = input().strip()
            except (EOFError, KeyboardInterrupt):
                print("\n[compiler:interrupted] Compilation cancelled.", flush=True)
                return 130

            if not follow_up:
                follow_up = "Please continue."

            result = _stream_sse(
                f"{base_url}/recordings/{recording_id}/compile/answer",
                body={"answer": follow_up},
            )
            if result is None:
                return 1

        elif status == "review":
            # Compilation done — show the draft and pause for quality gate
            # before proceeding to the name prompt. The outer agent (Claude
            # Code / Codex) reads the routine here and may send corrective
            # feedback (e.g. missing delivery step) via the gate prompt.
            # Only an empty Enter moves forward to naming.
            goal = result.get("goal", "")
            step_count = result.get("step_count", "?")
            routine_markdown = result.get("routine_markdown", "")
            print(
                f"\n[compiler:complete] goal={goal!r}  steps={step_count}", flush=True
            )
            if routine_markdown:
                print(f"[compiler:routine_draft]\n{routine_markdown}", flush=True)
            print(
                "\n[compiler:gate_check] Review the routine above.\n"
                "Press Enter to proceed to naming, or type feedback to send back to the compiler:",
                flush=True,
            )
            try:
                gate_input = input().strip()
            except (EOFError, KeyboardInterrupt):
                print("\n[compiler:interrupted] Compilation cancelled.", flush=True)
                return 130

            if gate_input:
                # Outer agent has feedback — send it back to the compiler
                result = _stream_sse(
                    f"{base_url}/recordings/{recording_id}/compile/answer",
                    body={"answer": gate_input},
                )
                if result is None:
                    return 1
                # Loop back to handle the next status
                continue

            # Gate passed — proceed to naming
            break

        else:
            print(
                f"[compiler:unexpected_status] {status} — result: {result}",
                file=sys.stderr,
            )
            return 1

    # ── Phase 3: name the routine and finalize ────────────────────────────
    goal = result.get("goal", "")
    step_count = result.get("step_count", "?")

    # Suggest a slug derived from the goal
    suggested = _slugify(goal) if goal else "my-routine"
    print(
        f"\n[compiler:name_prompt] Suggested name: {suggested!r}\n"
        f"Accept (press Enter) or type a new name:",
        flush=True,
    )
    try:
        chosen_name = input().strip()
    except (EOFError, KeyboardInterrupt):
        print("\n[compiler:interrupted] Finalization cancelled.", flush=True)
        return 130

    if not chosen_name:
        chosen_name = suggested

    # ── Phase 4: finalize ─────────────────────────────────────────────────
    try:
        finalize_result = request_json(
            f"{base_url}/recordings/{recording_id}/compile/finalize",
            method="POST",
            body={"name": chosen_name},
        )
    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        print(f"[compiler:finalize_error] {exc.code}: {body_text}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[compiler:finalize_error] {exc}", file=sys.stderr)
        return 1

    routine = finalize_result.get("routine", {})
    routine_id = routine.get("routine_id", "?")
    name = routine.get("name", chosen_name)
    steps = routine.get("step_count", "?")

    print(f"[compiler:saved] name={name!r}  id={routine_id}  steps={steps}", flush=True)
    print(
        f"\nRoutine saved. To replay it, run:\n\n" f"  python3 replay.py {name!r}\n",
        flush=True,
    )
    return 0


def _slugify(text: str) -> str:
    """Turn a goal string into a short, lowercase, hyphenated slug."""
    import re

    # Lowercase, keep only alnum and spaces, collapse and replace with hyphens
    slug = re.sub(r"[^\w\s]", "", text.lower())
    slug = re.sub(r"\s+", "-", slug.strip())
    # Truncate to 40 chars, trim trailing hyphens
    slug = slug[:40].rstrip("-")
    return slug or "routine"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile a stopped recording into a named Browser Routine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("recording_id", help="Recording ID from stop_recording.py")
    parser.add_argument(
        "--model-alias",
        help="LLM model alias to use for compilation (uses server default if omitted)",
    )
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8765",
        help="OpenBrowser server URL",
    )
    args = parser.parse_args()

    try:
        return compile_recording(args.url, args.recording_id, args.model_alias)
    except URLError as exc:
        print(f"Cannot reach OpenBrowser server: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
