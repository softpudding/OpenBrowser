# Raw intention: record the top trending GitHub repo of the day in Yuque, with agent-investigation prompts

I'm on `https://github.com/trending`. The workflow is:

1. Open the **top 1 trending repository** (by position — whichever
   repository is ranked first on the day this runs, not the specific
   repo captured in the recording).
2. In Yuque, create a new document in the `AI专用` knowledge base.
3. Set the title to `Most trending project YYYY-MM-DD`, with today's
   date on the day of replay.
4. In the document body, paste:
   - The repo URL.
   - The repo's short description from the GitHub "About" sidebar.
   - Then the literal sentence
     `Write also: 1. A brief intro 2. What's special 3. Why's it trending`
     as **instructions for the replay agent**, not as static text to
     leave in the document.
5. The replay agent should follow that instruction: visit the repo
   page, then write the three additional sections (a brief intro to
   the project, what's special about it, why it's trending today)
   into the Yuque document.

## Why this fixture exists (the bug)

This fixture pins **two layered regressions** in the
recorder→compiler pipeline for rich-text editors:

1. **Recorder-side (fixed):** the Chrome extension previously filtered
   `input` events to `HTMLInputElement` / `HTMLTextAreaElement` only,
   so Yuque's contenteditable document body produced zero `input`
   events. Even the new `input` listener didn't help because the Lake
   editor (Yuque's framework) intercepts keystrokes via `keydown` +
   `preventDefault` and applies edits via its own DOM model, so
   native `input` events never fire on the body. Fix:
   `extension/src/content/index.ts` now also listens for
   `beforeinput` on contenteditable targets and snapshots the
   element in a microtask after Lake's mutation. With the fix, the
   typed instruction
   `Write also: 1. A brief intro 2. What's special 3. Why's it trending`
   appears in the trace as a normal sequence of `input` events with
   `inputType: "insertText"` and per-character `data`.

2. **Compiler-side (open):** even with the typed text in the trace,
   the compiler agent's `trace_viewer` views are blind to it:
   - `normalized_steps` shows form-fill steps as
     `step_NNN [form] Fill form fields  (events: [...])` — no field
     values at all.
   - `events` shows `value="..."` truncated to 80 characters
     (`server/core/compiler_agent.py:339`). The user's instruction
     starts at offset ~135 in the body value (after the URL and
     repo description), so it falls off the end of the truncated
     string in every event the agent inspects.
   The fix needs to (a) raise/eliminate the 80-char cap on input
   values in the events view, (b) emit final per-field values in the
   normalized_steps view for form-fill steps, and (c) update the
   compiler system prompt to flag that contenteditable bodies may
   carry agent-investigation prompts beyond the pasted URLs.

## Expected compiler behaviour

- Recognises the recorded repo as a top-1-by-position selection on
  the GitHub trending page (asks or infers), not the specific
  `huggingface/ml-intern` slug frozen into the routine.
- Recognises the date in the title as today's-date on replay.
- **Recognises the typed sentence
  `Write also: 1. A brief intro 2. What's special 3. Why's it trending`
  as instructions for the replay agent.** The compiled routine must
  contain explicit steps for the agent to (a) visit the repo page,
  (b) write a brief intro, (c) write what's special, (d) write why
  it's trending — into the Yuque document.
- Should NOT compile the typed sentence as literal text to paste.
- Should NOT silently drop the typed sentence (the failure mode this
  fixture is designed to catch).
