---
name: open-browser
description: Drive a real Chrome browser through the local OpenBrowser service for interactive website tasks that require rendered-page inspection, clicking, typing, scrolling, dialog handling, or multi-step navigation. Use when Codex needs to open websites, fill forms, scrape JS-rendered content, reproduce browser-only issues, or complete end-to-end UI workflows. Prefer direct HTTP/API tools for simple fetches, downloads, or non-visual integrations.
---

# OpenBrowser

Use OpenBrowser as a dedicated browser-operation agent when the task depends on a live Chrome session and visual page state.

## Decide Fast

Use this skill for:
- Multi-step UI navigation
- Form filling and browser interactions
- JS-rendered pages that need a real browser
- Browser bug reproduction or manual flow verification

Do not use this skill for:
- Simple API calls
- Static downloads
- Local file transformations

## Preconditions

Before sending a browser task, confirm all of the following:

1. The OpenBrowser server is reachable at `http://127.0.0.1:8765`
2. The Chrome extension is connected
3. The OpenBrowser UI already has a valid LLM configuration
4. A browser UUID is available through `OPENBROWSER_CHROME_UUID` or `--chrome-uuid`

Run this first:

```bash
python3 skill/codex/open-browser/scripts/check_status.py --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

If readiness fails, read [references/setup.md](references/setup.md) or [references/troubleshooting.md](references/troubleshooting.md).

## Standard Workflow

1. Run `check_status.py`
2. If the server is down, start it from the repo root with `uv run local-chrome-server serve`
3. If the extension, UUID, or API key is missing, pause and ask the user to complete the manual Chrome or UI steps from [references/setup.md](references/setup.md)
4. Submit the task with `send_task.py` in foreground mode by default
5. Read the live SSE output in the terminal and use it to monitor progress in real time
6. Use background mode only when the task is expected to run long enough that a detached log is safer than an attached stream
7. Summarize the final browser outcome, any failures, and the conversation ID when useful

## Run Tasks

Foreground mode is the default and preferred mode for Codex usage because it exposes live SSE events in the current terminal:

```bash
python3 skill/codex/open-browser/scripts/send_task.py \
  "Open https://example.com and report the page title" \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

Prefer foreground mode for most tasks, including normal multi-step browser work, so you can inspect actions, observations, and usage metrics as they happen.

Use background mode only as a fallback for long-running tasks or when you explicitly need detached execution:

```bash
python3 skill/codex/open-browser/scripts/send_task.py \
  "Open https://example.com and click the sign in button" \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID" \
  --background \
  --output /tmp/openbrowser.log
sleep 120
tail -n 80 /tmp/openbrowser.log
```

If you choose background mode, use larger waits for longer flows:
- 60-90 seconds for a single navigation
- 120-180 seconds for a short multi-step task
- 300+ seconds for long workflows or debugging sessions

## Working Directory

Run commands from the OpenBrowser repo root so the relative script paths resolve cleanly.

Use `--cwd` when the browser task should operate with context from another workspace:

```bash
python3 skill/codex/open-browser/scripts/send_task.py \
  "Open the local app and verify the login flow" \
  --cwd /absolute/path/to/project \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

## Failure Handling

If the task does not start or fails immediately:
- Re-run `check_status.py`
- Verify that the browser UUID is still valid
- Inspect the live foreground stream first; if you used background mode, inspect `/tmp/openbrowser.log` or your chosen log file
- Read [references/troubleshooting.md](references/troubleshooting.md)

If you need lower-level control or want to inspect conversations directly, read [references/api_reference.md](references/api_reference.md).

## References

- [references/setup.md](references/setup.md): Read when OpenBrowser is not ready yet
- [references/troubleshooting.md](references/troubleshooting.md): Read when connectivity, UUID, or task execution fails
- [references/api_reference.md](references/api_reference.md): Read when scripting against the HTTP API or inspecting conversation state
