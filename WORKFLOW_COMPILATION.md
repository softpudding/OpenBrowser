# Recording To Workflow Compilation

## Status

This document records the current design direction for turning a recorded user
trace into an executable OpenBrowser workflow.

Current state:

- Recording infrastructure exists in
  [server/api/routes/recordings.py](/Users/yangxiao/git/OpenBrowser/server/api/routes/recordings.py)
  and
  [server/core/recording_manager.py](/Users/yangxiao/git/OpenBrowser/server/core/recording_manager.py).
- Browser-side recording exists in
  [extension/src/recording/recorder.ts](/Users/yangxiao/git/OpenBrowser/extension/src/recording/recorder.ts)
  and
  [extension/src/content/index.ts](/Users/yangxiao/git/OpenBrowser/extension/src/content/index.ts).
- A first-pass trace compiler exists in
  [server/core/workflow_compiler.py](/Users/yangxiao/git/OpenBrowser/server/core/workflow_compiler.py),
  but it is still a draft compiler, not a full replay system.
- A review UI already exists in
  [frontend/index.html](/Users/yangxiao/git/OpenBrowser/frontend/index.html),
  where the user can inspect captured events and the compiled workflow draft.

The missing gap is not trace replay. The missing gap is:

`recording trace -> executable intentful workflow -> OpenBrowser execution`

### Current Implementation Snapshot

As of the current implementation:

- `trace -> normalized steps -> workflow draft` is already wired through end to
  end.
- The current compiler output is a structured workflow draft JSON, not yet a
  polished natural-language plan with explicit reasoning blocks.
- All compiled workflow steps are currently forced to
  `executor_preference = "agent"`.
- This is intentional. Deterministic execution is temporarily deferred so the
  system can first converge on the right workflow semantics and review loop.
- User-supplied intent description after recording is part of the target design,
  but is not yet fully integrated into the compile path.
- Clarification questions are part of the target design, but are not yet fully
  implemented as a first-class workflow review flow.

## Goal

The goal of recording is to let a user demonstrate a browser workflow once, and
then let OpenBrowser repeat that workflow later.

Examples:

- Research information on Zhihu, then post a summary on Xiaohongshu.
- Search a site, inspect matching items, collect the useful ones, and prepare a report.

The output of recording should therefore not be a low-level replay script. It
should be a higher-level workflow that OpenBrowser can understand and execute.

## Three Stages

### Stage 1: Recording

1. User records manual browser behavior.
2. User stops recording.
3. After stopping, the user provides a short natural-language description of the
   overall intent of the workflow.

This description is required because trace alone usually does not contain the
business rule behind the actions.

Implementation note:

- This is the intended product behavior.
- The current system can already store and review the recording, but the
  explicit "describe the overall intent" step still needs to be added as a
  formal part of the recording completion flow.

Examples:

- "Search Zhihu for posts about LLM, collect useful findings, and write a
  Xiaohongshu post."
- "Open each relevant result and extract the important points into a report."

### Stage 2: Compilation

This stage converts recorded behavior into an OpenBrowser-executable workflow.

This is an AI interpretation task, not an execution task.

The compiler should understand:

- the recorded events,
- the user's high-level description,
- OpenBrowser tool semantics,
- which parts of the trace reveal clear intent,
- which parts are ambiguous and require clarification.

The compiler's job is to produce a workflow draft for user review.

### Stage 3: Execution

OpenBrowser executes the approved workflow produced by Stage 2.

The execution stage should consume the compiled workflow, not the raw trace.

## Core Principle

The system should not try to "learn by replaying clicks."

Instead, it should infer:

- what the user was trying to do,
- what steps OpenBrowser should perform,
- what rules OpenBrowser should follow,
- and what information is still missing.

That means the true product of compilation is an intentful workflow, not a
recorded macro.

## Compiler Agent

Stage 2 should be handled by a dedicated compiler-style agent.

This agent may or may not be implemented using the same OpenBrowser stack, but
its role must be different from the execution agent.

Its job is:

- read trace and grouped events,
- infer workflow steps,
- map those steps into OpenBrowser-compatible instructions,
- explain the reasoning for each step,
- identify ambiguity,
- ask clarification questions when required,
- produce a user-reviewable workflow draft.

Its job is not:

- to actually drive the browser,
- to run the workflow during compilation,
- or to directly replay the trace.

The compiler should operate under a different system instruction from the normal
execution agent so it remains focused on interpretation and compilation.

## First-Version Simplification

For the first version, execution ignores the distinction between
"deterministic" and "dynamic" actions at runtime.

Assume that all final steps are executed by OpenBrowser as agent-driven steps.

This is no longer just a design preference. It is the current implementation
decision.

However, the compiler still needs to distinguish between:

- steps whose intent is already clear,
- steps that are rule-based,
- and steps that remain unresolved.

This distinction is necessary because some trace segments are not executable
until the user clarifies the intent.

## What The Compiler Should Produce

The user-facing output should be a natural-language workflow draft.

Example:

```text
1. Open www.zhihu.com
   Reasoning: the trace begins by navigating to Zhihu, so this is the starting context.

2. Find posts about LLM and open each relevant post
   Reasoning: the trace suggests repeated inspection of posts around the same topic,
   so this appears to be rule-based selection rather than one fixed post.

3. Record the useful information into a final report
   Reasoning: after reading the posts, the user spent time collecting information
   rather than immediately interacting with the page.
```

That natural-language draft is for user review.

Internally, the system should also keep a structured representation so the
workflow can later be executed reliably.

Implementation note:

- Today the structured form is the primary artifact.
- The review UI currently exposes compiled steps and raw workflow JSON.
- A richer natural-language rendering with explicit reasoning should be added on
  top of the structured draft rather than replacing it.

The structured form should eventually include fields such as:

- `instruction`
- `reasoning`
- `evidence_event_ids`
- `ambiguity_level`
- `clarification_questions`
- `success_criteria`

## Clarification Is Part Of Compilation

Many workflows cannot be compiled from trace alone.

Example:

- A trace shows the user clicked one post.
- The compiler must determine whether the intent was:
  - click that exact post,
  - click every relevant post,
  - click the best matching post,
  - or inspect posts until enough information is collected.

When that cannot be inferred confidently, the compiler must ask the user.

Clarification questions should be limited to questions that change execution
logic.

Good examples:

- How should OpenBrowser determine which post is the target?
- Should it process one result or all matching results?
- What information should be extracted?
- If no matching result is found, should it retry, skip, or stop and ask?
- When posting to Xiaohongshu, should the content be copied, summarized, or rewritten?

Bad examples:

- Questions that merely restate the trace.
- Questions whose answers do not affect execution.

## User Review Loop

The compiler output should always be shown to the user before it becomes the
final executable workflow.

The user should be able to:

- inspect the proposed steps,
- inspect the reasoning,
- answer clarification questions,
- and correct the workflow intent.

After clarification and review, the workflow becomes the approved input for
execution.

Implementation note:

- The current review UI already supports inspection of:
  - captured events,
  - compiled workflow steps,
  - workflow JSON.
- The next missing layer is true review interaction:
  - collecting intent corrections,
  - collecting clarification answers,
  - and turning the draft into an approved executable workflow.

## Execution Model

Stage 3 should execute the approved workflow, not the raw trace.

OpenBrowser should treat the compiled workflow as the source of truth.

That means:

- the execution agent follows the compiled steps,
- the trace remains evidence and debugging context,
- but trace is not the runtime plan itself.

This lets execution stay robust even when page structure changes, because the
workflow can express intent such as:

- "find all posts about LLM"
- "collect useful findings"
- "prepare a report"

instead of only storing low-level clicks.

## Integration With The Current OpenBrowser Stack

The design should reuse the current execution stack rather than introduce a
separate browser runtime.

Relevant existing pieces:

- Recording and trace storage:
  [server/api/routes/recordings.py](/Users/yangxiao/git/OpenBrowser/server/api/routes/recordings.py)
- Trace compiler draft:
  [server/core/workflow_compiler.py](/Users/yangxiao/git/OpenBrowser/server/core/workflow_compiler.py)
- Conversation and agent entry:
  [server/agent/manager.py](/Users/yangxiao/git/OpenBrowser/server/agent/manager.py)
  [server/agent/api.py](/Users/yangxiao/git/OpenBrowser/server/agent/api.py)
- Browser execution:
  [server/agent/tools/browser_executor.py](/Users/yangxiao/git/OpenBrowser/server/agent/tools/browser_executor.py)
  [server/core/processor.py](/Users/yangxiao/git/OpenBrowser/server/core/processor.py)
- Human intervention:
  [server/agent/tools/help_tool.py](/Users/yangxiao/git/OpenBrowser/server/agent/tools/help_tool.py)
  [server/agent/user_help.py](/Users/yangxiao/git/OpenBrowser/server/agent/user_help.py)

The intended architecture is:

1. Recording finishes.
2. User provides a short description of the workflow intent.
3. Compiler agent reads trace plus user intent and generates a workflow draft.
4. User reviews the draft and answers clarification questions.
5. The approved workflow is passed to the normal OpenBrowser execution path.

## Important Design Constraint

Compilation should not operate on a fixed number of low-level events at a time.

It should segment trace by semantic blocks.

Examples of semantic blocks:

- open site,
- search or filter,
- inspect candidates,
- choose target,
- collect information,
- publish or submit.

A single click has no stable meaning without its surrounding context.

## Near-Term Product Direction

The near-term product shape should be:

- recording panel,
- workflow draft view,
- clarification questions,
- user approval,
- then execution from approved workflow.

## Immediate Working Rules

Until deterministic replay is reintroduced deliberately, the project should
follow these rules:

- Do not treat a recorded selector or recorded click as inherently replayable.
- Do not mark compiled steps as deterministic by default.
- Prefer emitting `agent` steps and preserving trace evidence.
- Use the review step to determine the real user intent before worrying about
  fixed execution.
- Keep the structured workflow draft as the system of record for later runtime
  integration.

This keeps the project aligned with the real problem:

`understand the workflow first, then optimize execution strategy`

This is a better foundation than a macro-style replay system because it aligns
with how OpenBrowser already works: high-level, visual, tool-driven, and
recoverable.

## Summary

The system being designed here is not:

- trace replay,
- click macro execution,
- or pixel-level automation.

It is:

- trace-backed workflow compilation,
- with explicit reasoning,
- explicit clarification,
- user review,
- and execution through the existing OpenBrowser agent stack.
