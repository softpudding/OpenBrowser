# Routine record/replay evaluation harness

This directory evaluates the two LLM-driven phases of OpenBrowser's routine
record→compile→replay feature:

| Track | What it measures | Entry point |
|-------|------------------|-------------|
| **Compile** | Does the Compiler Agent turn a recording into a routine that matches the user's real intent, place `**Keywords:**` lines wherever possible, and ask clarifying questions on ambiguous behaviours (but stay quiet on clear ones)? | `eval/routine_eval/evaluate_routine_compile.py` |
| **Replay** | Does OpenBrowser in `routine_replay` mode execute a hand-written golden routine end-to-end on the mocked eval sites? | `eval/evaluate_browser_agent.py --test replay_*` |

Recording itself is deterministic glue that does not need an eval.

---

## Layout

```
eval/routine_eval/
├── README.md                       # this file
├── __init__.py                     # package marker
├── user_proxy.py                   # LLM-backed clarification answerer + judge
├── evaluate_routine_compile.py     # compile-track CLI
├── fixtures/                       # hand-authored compile-track fixtures
│   ├── techforum_upvote_clear/
│   ├── finviz_filter_clear/
│   ├── techforum_count_ambiguous/
│   └── finviz_threshold_ambiguous/
└── routines/                       # golden routines used by the replay track
    ├── techforum_upvote.md
    └── finviz_filter_simple.md
```

Each compile-track fixture directory contains:

| File | Author | Purpose |
|---|---|---|
| `recording.json` | hand-written OR captured (see below) | The event list that `POST /recordings/ingest` loads into `recording_manager`. Shape: either a raw JSON array of `{event_type, event_data, event_index?}` rows OR the full `{"events": [...], ...}` payload from `GET /recordings/{id}/events`. |
| `intent_note.txt` | human | The short free-text intent note the user would type into the recording UI. Optional. |
| `raw_intention.md` | human | The **judge-only** ground truth. The user proxy sees this when answering clarifications and judging the final routine; the compiler never sees it. Keep it specific enough to settle the genuinely ambiguous cases. |
| `expectations.yaml` | human | What the compiler should and should not ask about, and which steps must carry a `**Keywords:**` line. See [Expectations schema](#expectations-schema) below. |

The replay track just needs the Markdown routine plus a YAML test-case binding
under `eval/dataset/replay_*.yaml`.

---

## Compile track: run it

The orchestrator calls the server over HTTP, so the server must already be
running with the test-only ingest route enabled:

```bash
OPENBROWSER_ENABLE_TEST_ROUTES=1 uv run local-chrome-server serve
```

Then, from the repo root:

```bash
# One fixture
uv run python eval/routine_eval/evaluate_routine_compile.py \
    --fixture techforum_upvote_clear \
    --compile-alias primary \
    --judge-alias judge

# All fixtures under fixtures/
uv run python eval/routine_eval/evaluate_routine_compile.py --all
```

The orchestrator ingests the fixture via `POST /recordings/ingest`, streams
`POST /recordings/{id}/compile`, routes any `ask_user` questions through
`user_proxy.answer_clarification` (which sees `raw_intention.md`), then judges
the final compiled routine with `user_proxy.judge_routine` against
`expectations.yaml`. Results land in
`eval/output/routine_compile_<timestamp>/routine_compile_report.json` with
per-fixture rows and per-axis aggregates.

Exit code is `0` only if every fixture both completed and had all three axes
score ≥ 0.8.

### Expectations schema

```yaml
intent_summary: |
  One sentence the judge can sanity-check the compiled routine against.

expected_questions:
  required:                      # topics the compiler MUST ask about
    - "What is the selection criterion for which posts to upvote"
  forbidden:                     # topics the compiler MUST NOT ask
    - "Which post to upvote"

expected_keywords:
  must_have_for_steps:           # per-step assertion that a Keywords line exists
    - description: "the upvote button on the first post"
      acceptable_tokens:         # any one of these is a valid pick
        - upvote
        - answer-action
```

The judge applies these strictly: each missed `required` topic or each
matched `forbidden` topic lowers `asking_behavior_score`; each missing
`must_have_for_steps` step lowers `keyword_placement_score`.

### Replacing synthetic recordings with real captures

The bundled `recording.json` files are hand-authored minimal fixtures: one
`page_view` plus the bare minimum click/change events with full
`element.html` so the compiler can actually reach Keywords decisions. They
are runnable on commit day and fast to debug. If you want higher-fidelity
fixtures with real screenshots and the full event stream the recorder
emits, capture them like this:

1. Start the dev server (`uv run local-chrome-server serve`) with the
   recording extension loaded.
2. Open the relevant mocked site at `http://localhost:16605/<site>/`.
3. Click the toolbar **Start recording** button, perform the workflow,
   click **Stop recording**.
4. Copy the `recording_id` the UI shows and run:
   ```bash
   curl -s http://localhost:8765/recordings/<id>/events | jq '.events' \
       > eval/routine_eval/fixtures/<fixture_id>/recording.json
   ```
5. Leave `raw_intention.md` and `expectations.yaml` unchanged — they are
   the source of truth for what the judge scores against.

---

## Replay track: run it

Replay tests are plain `eval/dataset/*.yaml` files with a `routine_file`
field set to a Markdown routine under `eval/routine_eval/routines/`. When
that field is set, `eval/evaluate_browser_agent.py` creates the conversation
in `routine_replay` mode and sends the routine markdown as the initial
message instead of `instruction`. Everything downstream — tracker.js
event collection, criterion scoring, cost/time limits, report shape —
stays identical to the rest of the eval suite.

```bash
uv run python eval/evaluate_browser_agent.py \
    --test replay_techforum_upvote \
    --chrome-uuid <UUID>
```

To run both replay fixtures bundled here:

```bash
uv run python eval/evaluate_browser_agent.py \
    --test replay_techforum_upvote \
    --test replay_finviz_filter_simple \
    --chrome-uuid <UUID>
```

The existing non-replay tests (e.g. `techforum`, `finviz_simple`) still
work exactly as before — the `routine_file` branch only activates when the
field is set on the test case.

---

## Fixture coverage (initial set)

| Fixture | Site | Ambiguous? | What it exercises |
|---|---|---|---|
| `techforum_upvote_clear` | TechForum | no | Plain click with a clean `data-action` keyword hook. |
| `finviz_filter_clear` | Finviz | no | Native `<select>` → `select` action with `id` keyword hook. |
| `techforum_count_ambiguous` | TechForum | yes | Count-based vs criterion-based selection (compiler must ask). |
| `finviz_threshold_ambiguous` | Finviz | yes | Filter touched then reverted (compiler must ask). |

Golden replay routines: `techforum_upvote.md`, `finviz_filter_simple.md`.
