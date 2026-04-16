---
name: open-browser
description: Drive a real Chrome browser through the local OpenBrowser service for interactive website tasks that require rendered-page inspection, clicking, typing, scrolling, dialog handling, or multi-step navigation. Use when Claude Code needs to open websites, fill forms, scrape JS-rendered content, reproduce browser-only issues, verify a frontend change end-to-end, or complete UI workflows. Prefer direct HTTP/API tools for simple fetches, downloads, or non-visual integrations.
---

# OpenBrowser (Claude flavor)

Use OpenBrowser as a dedicated browser-operation agent when the task
depends on a live Chrome session and visual page state. This flavor of
the skill is tuned for Claude Code: foreground SSE streaming by default,
no message truncation, conversation reuse for follow-up turns, and the
noisy system prompt suppressed from the log.

## Decide Fast

Use this skill for:
- Multi-step UI navigation
- Form filling and browser interactions
- JS-rendered pages that need a real browser
- Visual verification of a frontend change you just made
- Browser bug reproduction or manual flow verification

Do not use this skill for:
- Simple API calls — use `curl` or the WebFetch tool
- Static downloads — use `curl -O`
- Local file transformations — use the standard editing tools

## Preconditions

Before sending a browser task, confirm all of the following:

1. The OpenBrowser server is reachable at `http://127.0.0.1:8765`
2. The Chrome extension is connected
3. The OpenBrowser UI already has a valid LLM configuration
4. A browser UUID is available through `OPENBROWSER_CHROME_UUID` or `--chrome-uuid`

Run this first:

```bash
python3 ~/.claude/skills/open-browser/scripts/check_status.py --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

If readiness fails, read [references/setup.md](references/setup.md) or
[references/troubleshooting.md](references/troubleshooting.md).

## Standard Workflow

1. Run `check_status.py`.
2. If the server is down, start it from the repo root with
   `uv run local-chrome-server serve`. Use the Bash tool's
   `run_in_background: true` parameter so Claude Code surfaces its
   completion natively.
3. If the extension, UUID, or API key is missing, pause and ask the user
   to complete the manual Chrome/UI steps from
   [references/setup.md](references/setup.md).
4. Submit the task with `send_task.py` in **foreground mode**. The full
   SSE stream lands directly in your conversation log — no truncation,
   no separate file to tail.
5. Read the live SSE output to monitor actions, observations, and the
   final assistant message in real time.
6. For very long tasks, run the same `send_task.py` invocation through
   the Bash tool with `run_in_background: true` rather than the
   `--background` flag. Claude Code will notify you on completion;
   never sleep-poll.
7. Summarize the final browser outcome, any failures, and the
   conversation ID when useful so a follow-up turn can reuse it.

## Run Tasks

Foreground is the default and almost always the right choice in Claude
Code, because the SSE stream becomes part of your conversation context
without any extra plumbing:

```bash
python3 ~/.claude/skills/open-browser/scripts/send_task.py \
  "Open https://example.com and report the page title" \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

What you will see in the log:

- `[conversation] <id>` and `[task] <text>` once at the start
- `[system_prompt] suppressed (…)` instead of a 12 KB prompt dump
- `[action] click element_id=A1H` style lines as the agent acts
- `[observation:ok] …` after each action
- `[message:assistant] <full text>` for any assistant message — no
  trailing `…`, no character cap
- `[usage] model=… cost_rmb=… tokens=…` at the end
- `[complete] Conversation completed`

If you need to inspect the OpenBrowser system prompt for debugging, pass
`--show-system-prompt` to disable suppression.

## Long-running tasks

If you expect a task to run for several minutes and don't want to keep
the foreground tool busy, prefer Claude Code's native background mode.
Invoke the same `send_task.py` command via the Bash tool with
`run_in_background: true`. Claude Code will notify you when it
completes — do **not** sleep, poll, or `tail -f` the log.

The legacy `--background --output /tmp/openbrowser.log` flag still
works as a fallback for shell-only environments, but it should not be
your default in Claude Code.

## Attaching images to a task

OpenBrowser uses multimodal LLMs, so you can send an image (screenshot,
UI mockup, reference photo) alongside the text prompt. Use this when the
task is "recreate this design", "why does my UI look wrong compared to
this screenshot", or "find the element that matches this picture".

Pass `--image PATH` once per image. Images are read from disk, base64
encoded, and sent as data URIs — no upload endpoint or static server is
required. Limit: 10 MB per image, up to 8 images per message.

```bash
python3 ~/.claude/skills/open-browser/scripts/send_task.py \
  "Open the local dashboard and tell me which section looks different from this screenshot." \
  --image /tmp/reference.png \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

Typical use cases:
- **Visual regression check**: screenshot the expected UI, send it with
  "compare this to the current page at http://localhost:3000 and list
  differences".
- **Reproducing a bug from a user report**: drop in the user's
  screenshot and ask "navigate to the page shown here and confirm you
  see the same error".
- **Asset-matching**: send a design mockup and ask the agent to pick
  the closest live element from the current page.

The conversation history saves an `[image attached: name, NkB]` marker
(not the bytes) so replays don't balloon to megabytes.

## Follow-up turns on the same browser session

To send a second instruction to the same conversation (so the agent
keeps its prior screenshots and observations), reuse the conversation
ID from the previous run:

```bash
python3 ~/.claude/skills/open-browser/scripts/send_task.py \
  "Now click the 'Sign in' button you just identified" \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID" \
  --conversation-id 1b32b26a-1a7e-4b6c-9599-139fc6b9c89b
```

This is the right tool for: stepwise debugging of a web flow, breaking
a long task into smaller verifiable chunks, or re-asking the agent to
report a value it already saw.

## Working Directory

The skill's scripts live at `~/.claude/skills/open-browser/` so they
work from any project's current working directory. The OpenBrowser
server itself must still be started from the repo root
(`uv run local-chrome-server serve` in `~/git/OpenBrowser`).

Use `--cwd` when the browser task should operate with context from
another workspace:

```bash
python3 ~/.claude/skills/open-browser/scripts/send_task.py \
  "Open the local app and verify the login flow" \
  --cwd /absolute/path/to/project \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

## Verifying frontend changes you just made

A common Claude Code workflow on this repo: edit `frontend/index.html`,
then ask the OpenBrowser agent to load the page and confirm the change
visually. Tips that improve the success rate:

- Be specific about the route to take and the element to interact with
  ("click the entry whose id starts with `38322447`", not "click any
  recording").
- Ask the agent to **scroll the specific pane** rather than the
  document, and to report what it sees afterwards. This is the only
  reliable way to verify nested-scroll bugs without DevTools.
- For pure layout questions (what computed style, what scroll height),
  the agent can't run JavaScript — fall back to asking the user to
  check, or rebuild the page locally and re-test.
- End the prompt with an explicit "Be concise — 3-5 sentences" so the
  final assistant message is short enough to read at a glance.

## Failure Handling

If the task does not start or fails immediately:

- Re-run `check_status.py`
- Verify that the browser UUID is still valid
- Inspect the live foreground stream first (it is in your conversation
  log — no need to open any file)
- If you used background mode, inspect `/tmp/openbrowser.log` or your
  chosen log file
- Read [references/troubleshooting.md](references/troubleshooting.md)

If you need lower-level control or want to inspect conversations
directly, read [references/api_reference.md](references/api_reference.md).

## Proxy gotcha

If a global `HTTP_PROXY` / `HTTPS_PROXY` is set in the environment,
prefix Bash invocations with `NO_PROXY="127.0.0.1,localhost"` so
requests to `127.0.0.1:8765` bypass the proxy. The Python scripts use
stdlib `urllib` and respect the same variables.

## References

- [references/setup.md](references/setup.md): Read when OpenBrowser is not ready yet
- [references/troubleshooting.md](references/troubleshooting.md): Read when connectivity, UUID, or task execution fails
- [references/api_reference.md](references/api_reference.md): Read when scripting against the HTTP API or inspecting conversation state
