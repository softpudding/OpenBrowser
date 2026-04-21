---
name: ob-routines
description: Record, compile, and replay Browser Routines — saved, named browser workflows. (Alias for openbrowser-routines.) Supports subcommands: "list [query]" to list/search routines, "new" to record a new routine, "execute <name>" to replay a saved routine. Use when the user says "list routines", "record a routine", "replay X", "execute X", or "/ob-routines <subcommand>".
---

# Browser Routines

Browser Routines are named, compiled workflows captured from real Chrome sessions.
The pipeline has four stages: **record → compile → name → replay**.

## Subcommand dispatch

When invoked with arguments, act immediately — do not ask the user what they want:

| Invocation | Action |
|---|---|
| `/ob-routines` | Show available routines and ask what to do |
| `/ob-routines list [query]` | Run `list_routines.py [query]` and display results |
| `/ob-routines new` | Ask **only** for the one-line goal/intention, then start recording immediately (see "Before recording" below) |
| `/ob-routines execute <name>` | Run `replay.py <name>` immediately |

---

## Your role during compilation

You are a **bridge and quality gate**, not the compiler. The Compiler Agent does
the reasoning; you ensure it did its job correctly before finalizing.

### Bridge duties
1. Run `compile.py` in a tmux pane (mandatory — see below).
2. Watch for `[compiler:question]` — relay it to the user, send their answer back.
3. Watch for `[compiler:stalled]` — show the agent's message, optionally prompt a follow-up.
4. At `[compiler:name_prompt]` — help the user pick a short slug.

### Quality gate (run before every finalize)

After the compiler reports `status=review`, read the compiled routine markdown
and check **both** of the following before calling `/compile/finalize`:

#### Gate 1 — Intent clarity
Did the compiler understand *why* the user performed each action, not just *what*
they clicked? Red flags:
- Steps that say "click X" with no explanation of goal or condition
- A position-based selection from a sorted/filtered list without asking whether
  to replay by position or by identity (e.g. "upvote the top 3 posts" — top 3
  today vs. the same 3 posts always?)
- A value (date, search query, ticker, ID) that will obviously change between
  runs, not parameterized

If any red flag is present and the compiler did NOT ask about it: relay the
ambiguity to the user yourself, get their answer, then send it via
`POST /recordings/{id}/compile/answer` so the compiler can revise.

#### Gate 2 — Delivery goal for read-only workflows

A workflow is **read-only** if it has no form submission, no purchase, no
send/post/create/delete action — the user only navigated, read, filtered, or
inspected. For read-only workflows, ask: does the compiled routine end with a
delivery step (a `file_editor` write, a `terminal` command, or an explicit
instruction to report results in chat)?

**If the routine is read-only AND has no delivery step, the compiler made an
error.** Do not finalize. Instead:

1. Tell the user: "This routine reads data but doesn't capture results anywhere.
   How do you want results delivered on replay?"
   - (a) Summary shown in chat (brief / structured table / full details?)
   - (b) Written to a local file (path + format: plain text, Markdown, CSV, JSON?)
   - (c) Both
2. Get their answer.
3. Send it to the compiler via `POST /recordings/{id}/compile/answer` — the
   compiler will revise the routine to include the delivery step.
4. Wait for the next `status=review`, then re-run both gates.

> **Why this matters:** A routine that just clicks through pages is useless on
> replay — OpenBrowser will navigate and stop with no output. The delivery step
> is what makes the routine meaningful.

---

## Preconditions

**First time?** Complete the full setup in `~/.claude/skills/open-browser/references/setup.md`
before using this skill. That guide covers: loading the Chrome extension, connecting
it to the server, and obtaining a valid `OPENBROWSER_CHROME_UUID`. Without that,
recording and replay will fail immediately.

For subsequent uses, confirm:
- OpenBrowser server at `http://127.0.0.1:8765`
- Chrome extension connected
- `OPENBROWSER_CHROME_UUID` set (or passed via `--chrome-uuid`)

Quick check:
```bash
python3 ~/.claude/skills/open-browser/scripts/check_status.py --chrome-uuid "$OPENBROWSER_CHROME_UUID"
```

Start the server if needed:
```bash
cd /Users/yangxiao/git/OpenBrowser && uv run local-chrome-server serve
```

Scripts path: `~/.claude/skills/ob-routines/scripts/`.

---

## List & search routines

```bash
python3 ~/.claude/skills/ob-routines/scripts/list_routines.py
python3 ~/.claude/skills/ob-routines/scripts/list_routines.py "login"
python3 ~/.claude/skills/ob-routines/scripts/list_routines.py --recordings
```

---

## Record a routine

### Before recording — DO NOT interrogate the user

The whole point of record → compile is that the browser actions are **observed**,
and the Compiler Agent asks clarifying questions *after* it has seen them.

Ask the user **only** for a short goal/intention (one line). Do **NOT** ask:
- which site or URL to start from
- which tool/screener to use
- how to define filter terms ("what's high-value?", "what's significant?")
- which parameters should vary between runs

All of that is the compiler's job during Gate 1. Pre-record interrogation
defeats the pipeline and wastes the user's time. If the user's goal is vague
("find good stocks"), that's fine — start recording. The compiler will ask.

### Step 1 — start recording
```bash
python3 ~/.claude/skills/ob-routines/scripts/start_recording.py \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID" \
  --name "xiaohongshu-messages" \
  --intent "check messages on Xiaohongshu"
```

Prints `[recording:started] <recording_id>`. **Save this ID.**

Tell the user: **"Perform your actions in the browser window, then come back and say done."**
Do NOT proceed until the user confirms.

### Step 2 — stop recording
```bash
python3 ~/.claude/skills/ob-routines/scripts/stop_recording.py <recording_id>
```

---

## Compile to a routine — MANDATORY: tmux interactive session

**compile.py uses `input()` for Q&A and the name prompt. It MUST run in an
interactive shell. Never invoke it directly via the Bash tool — it will block
and then be killed, losing the compiler session.**

### Launch in tmux
```bash
tmux new-window -n "compile" \
  "python3 ~/.claude/skills/ob-routines/scripts/compile.py <recording_id>; echo '[compile-done]'"
```

### Monitor output
```bash
tmux capture-pane -t "compile" -p
```

### Send an answer
```bash
tmux send-keys -t "compile" "the answer" Enter
```

### Markers to watch for

| Marker | Your action |
|---|---|
| `[compiler:thought]` / `[compiler:action]` | Relay as progress to user |
| `[compiler:question] <text>` | Relay to user, wait for answer, send via `tmux send-keys` |
| `[compiler:stalled] <text>` | Show message, ask user for follow-up |
| `[compiler:complete] goal=… steps=N` | Compilation reached review state |
| `[compiler:routine_draft]` | Full routine markdown printed for inspection |
| `[compiler:gate_check]` | **Run both quality gates here.** Send feedback or press Enter |
| `[compiler:name_prompt]` | Gates passed — help user pick slug |
| `[compiler:saved]` | Done — report name and id |

### Quality gate checkpoint
When `[compiler:gate_check]` appears in the pane, compile.py is explicitly
paused waiting for your review of `[compiler:routine_draft]`. Run Gate 1 and Gate 2:

- **Gates pass** → send an empty Enter: `tmux send-keys -t main:compile "" Enter`
- **Gate fails** → send corrective feedback:
  `tmux send-keys -t main:compile "Please add a delivery step: summarise results in chat as a structured list of tickers with metrics." Enter`

compile.py forwards non-empty input back to the compiler, streams the revision,
and loops back to another `[compiler:gate_check]`. Only an empty Enter advances
to `[compiler:name_prompt]`.

**Never send gate feedback at the `[compiler:name_prompt]` stage** — that input
goes directly to the routine name field, not the compiler.

---

## Replay a routine

```bash
python3 ~/.claude/skills/ob-routines/scripts/replay.py "routine-name" \
  --chrome-uuid "$OPENBROWSER_CHROME_UUID"

# List without replaying
python3 ~/.claude/skills/ob-routines/scripts/replay.py --list
```

Name matching: exact → ID → prefix → substring.

---

## Full example workflow

```
1. /ob-routines new  →  ask user what to record
2. start_recording  →  [recording:started] abc123
3. (user records in browser, says "done")
4. stop_recording abc123  →  [recording:events] 21 events
5. tmux new-window "compile.py abc123"
6. monitor pane → relay questions → send answers
7. [compiler:complete]  →  run Gate 1 + Gate 2
   Gate 2 fails: routine is read-only, no delivery step
   → ask user: chat summary, file, or both?
   → send answer via tmux send-keys
   → wait for next [compiler:complete]
8. Gates pass → [compiler:name_prompt] → user picks slug
9. [compiler:saved] name='…' id=…
10. /ob-routines execute <name>  →  streams [action] … [complete]
```

---

## Failure handling

- **Server unreachable**: `uv run local-chrome-server serve`
- **Browser UUID invalid**: reconnect Chrome extension, get fresh UUID
- **0 events captured**: browser disconnected; re-record
- **tmux not found**: `brew install tmux`
- **tmux window conflict**: check `tmux list-windows`, use a unique `-n` name
- **Compiler session expired** (pane exited before finalize): call
  `POST /recordings/{id}/compile` again to restart — session is fresh
- **Relay stuck**: `[observation:error]` lines in SSE stream; relay to user
