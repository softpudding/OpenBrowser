"""LLM-backed user proxy for the routine compile-eval harness.

This module does two jobs during a compile-eval run:

1. **Answer clarification questions** from the Compiler Agent's
   ``ask_user`` tool. The proxy sees the fixture's hidden ``raw_intent``
   (the detailed ground-truth the user would hold in their head) plus the
   prior Q/A history and responds in a short, direct sentence — the way a
   real user would.

2. **Judge the final compiled routine** against three criteria the user
   cares about:
      - **intent_match**: does the routine execute the user's real intent
        end-to-end, with no missing or extra steps?
      - **keyword_placement**: does the routine include a
        ``**Keywords:**`` line on every step whose target exposed a clean
        stable identifier in the recording?
      - **asking_behavior**: did the compiler ask clarification questions
        for the topics the fixture marks as genuinely ambiguous, AND avoid
        asking about topics the fixture marks as unambiguous?

Both functions force structured output via tool calling (the same pattern
as ``tests/integration/utils/llm_judge.py:116`` in the agent-sdk fork)
rather than parsing free-form JSON out of prose — that's significantly
more reliable on smaller models.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic import Field, SecretStr

from openhands.sdk import LLM, Message, TextContent
from openhands.sdk.tool import (
    Action,
    Observation,
    ToolDefinition,
    ToolExecutor,
)

from server.core.llm_config import llm_config_manager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
#  LLM construction
# ---------------------------------------------------------------------------


def build_user_proxy_llm(model_alias: Optional[str] = None) -> LLM:
    """Build an LLM for the user proxy using the server's llm_config.

    Reuses the OpenBrowser LLM config store so the compile-eval harness
    picks up the same API keys the rest of the server uses. Pass a
    specific alias (e.g. ``"judge"``) to pin a stronger model for
    judging; omit it to use the default alias.
    """
    cfg = llm_config_manager.get_llm_config(model_alias)
    if not cfg.api_key:
        raise ValueError(
            "User proxy LLM has no API key configured. Set one in "
            "~/.openbrowser/llm_config.json or pick a different alias."
        )
    return LLM(
        usage_id="routine-eval-user-proxy",
        model=cfg.model,
        base_url=cfg.base_url,
        api_key=SecretStr(cfg.api_key),
    )


# ---------------------------------------------------------------------------
#  Clarification answer tool (forces structured output)
# ---------------------------------------------------------------------------


class SubmitAnswerAction(Action):
    """Action for the proxy to submit a clarification answer."""

    answer: str = Field(
        description=(
            "The user's answer to the compiler's clarification question. "
            "One or two short sentences, in first person — as if the real "
            "user is typing into the compile UI."
        ),
    )


class SubmitAnswerObservation(Observation):
    pass


class SubmitAnswerExecutor(ToolExecutor[SubmitAnswerAction, SubmitAnswerObservation]):
    def __call__(
        self, action: SubmitAnswerAction, conversation: Any = None
    ) -> SubmitAnswerObservation:
        return SubmitAnswerObservation.from_text("Answer received")


class SubmitAnswerTool(ToolDefinition[SubmitAnswerAction, SubmitAnswerObservation]):
    @classmethod
    def create(cls) -> list["SubmitAnswerTool"]:
        return [
            cls(
                action_type=SubmitAnswerAction,
                observation_type=SubmitAnswerObservation,
                description=(
                    "Submit your answer to the compiler's clarification "
                    "question. You MUST call this tool exactly once."
                ),
                executor=SubmitAnswerExecutor(),
            )
        ]


# ---------------------------------------------------------------------------
#  Judgment tool (forces per-axis scoring)
# ---------------------------------------------------------------------------


class SubmitJudgmentAction(Action):
    """Action for the proxy to submit a three-axis judgment."""

    intent_match_score: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "How faithfully the routine executes the user's real intent, "
            "end-to-end. 1.0 means the routine will do exactly what the "
            "user wanted; 0.0 means the routine would not accomplish the "
            "goal at all. Penalize missing required steps, extra unrelated "
            "steps, and wrong actions (e.g. downvote instead of upvote)."
        ),
    )
    intent_match_reasoning: str = Field(
        description="One-paragraph explanation of the intent_match score."
    )
    keyword_placement_score: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "How well the compiler placed `**Keywords:**` lines. 1.0 means "
            "every step whose target had a clean stable identifier (test "
            "hook, semantic id/name, aria-label, or distinctive attribute) "
            "carries a Keywords line, and the chosen tokens are valid per "
            "the compiler prompt's priority list. Lower scores penalize "
            "missing Keywords lines on steps where the fixture's "
            "expectations mark an identifier as available."
        ),
    )
    keyword_placement_reasoning: str = Field(
        description="One-paragraph explanation of the keyword_placement score."
    )
    asking_behavior_score: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "How well the compiler asked the right clarification questions. "
            "Asymmetric: 1.0 means the compiler asked at least one question "
            "covering every topic in `expected_questions.required`. Each "
            "missed required topic lowers the score. Extra questions — "
            "including ones that overlap topics in "
            "`expected_questions.forbidden` — are NOT penalized. Asking "
            "too much is acceptable; failing to ask required things is "
            "not."
        ),
    )
    asking_behavior_reasoning: str = Field(
        description="One-paragraph explanation of the asking_behavior score."
    )
    overall_pass: bool = Field(
        description=(
            "True iff all three per-axis scores are >= 0.8. Use this as a "
            "simple pass/fail rollup."
        ),
    )


class SubmitJudgmentObservation(Observation):
    pass


class SubmitJudgmentExecutor(
    ToolExecutor[SubmitJudgmentAction, SubmitJudgmentObservation]
):
    def __call__(
        self, action: SubmitJudgmentAction, conversation: Any = None
    ) -> SubmitJudgmentObservation:
        return SubmitJudgmentObservation.from_text("Judgment received")


class SubmitJudgmentTool(
    ToolDefinition[SubmitJudgmentAction, SubmitJudgmentObservation]
):
    @classmethod
    def create(cls) -> list["SubmitJudgmentTool"]:
        return [
            cls(
                action_type=SubmitJudgmentAction,
                observation_type=SubmitJudgmentObservation,
                description=(
                    "Submit your three-axis judgment of the compiled routine. "
                    "You MUST call this tool exactly once."
                ),
                executor=SubmitJudgmentExecutor(),
            )
        ]


# ---------------------------------------------------------------------------
#  Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ClarificationAnswer:
    answer: str
    cost: float = 0.0
    total_tokens: int = 0


@dataclass
class JudgmentResult:
    intent_match: float
    keyword_placement: float
    asking_behavior: float
    overall_pass: bool
    reasoning: dict[str, str] = field(default_factory=dict)
    cost: float = 0.0
    total_tokens: int = 0
    # Inputs and raw outputs of the judge LLM call. Captured so the eval
    # runner can dump them as a per-fixture artifact for offline review.
    # Intentionally excluded from to_dict() — they are large and would
    # bloat the canonical regression report.
    prompt: str = ""
    raw_args: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_match": self.intent_match,
            "keyword_placement": self.keyword_placement,
            "asking_behavior": self.asking_behavior,
            "overall_pass": self.overall_pass,
            "reasoning": self.reasoning,
            "cost": self.cost,
            "total_tokens": self.total_tokens,
        }


# ---------------------------------------------------------------------------
#  Prompt helpers
# ---------------------------------------------------------------------------


def _format_history(history: list[dict[str, str]]) -> str:
    if not history:
        return "(no prior questions in this compile session)"
    lines: list[str] = []
    for i, qa in enumerate(history, start=1):
        q = qa.get("question", "")
        a = qa.get("answer", "")
        lines.append(f"Q{i}: {q}\nA{i}: {a}")
    return "\n".join(lines)


def _format_expectations(expectations: dict[str, Any]) -> str:
    return json.dumps(expectations or {}, indent=2, ensure_ascii=False)


def _snapshot_metrics(llm: LLM) -> tuple[float, int, int]:
    """Return ``(cost, prompt_tokens, completion_tokens)`` from the LLM's
    cumulative metrics so a caller can compute the per-call delta after
    ``llm.completion()`` returns."""
    m = getattr(llm, "metrics", None)
    cost = float(getattr(m, "accumulated_cost", 0.0) or 0.0)
    tu = getattr(m, "accumulated_token_usage", None)
    pt = int(getattr(tu, "prompt_tokens", 0) or 0)
    ct = int(getattr(tu, "completion_tokens", 0) or 0)
    return cost, pt, ct


def _delta_metrics(llm: LLM, before: tuple[float, int, int]) -> tuple[float, int]:
    """Compute ``(delta_cost, delta_total_tokens)`` since *before*."""
    after = _snapshot_metrics(llm)
    delta_cost = max(0.0, after[0] - before[0])
    delta_tokens = max(0, (after[1] + after[2]) - (before[1] + before[2]))
    return delta_cost, delta_tokens


# ---------------------------------------------------------------------------
#  Public API
# ---------------------------------------------------------------------------


def answer_clarification(
    llm: LLM,
    raw_intent: str,
    question: str,
    history: Optional[list[dict[str, str]]] = None,
) -> ClarificationAnswer:
    """Answer a compiler ``ask_user`` question on the user's behalf.

    The proxy sees the fixture's raw intention (which the real user would
    hold in their head) and any prior Q/A pairs from the same compile
    session, and responds the way a real user would — one or two short
    sentences in first person, no meta-commentary.
    """
    tool = SubmitAnswerTool.create()[0]
    prior = _format_history(history or [])

    prompt = f"""You are role-playing as the end user who just recorded a browser \
workflow and is now having its recording compiled into a replayable Routine \
by the Browser Routine Compiler Agent. The compiler has paused to ask you a \
clarification question. You must answer it.

Your hidden true intention for the workflow (the compiler does NOT see this):
---
{raw_intent}
---

Prior clarification round(s) in this compile session:
---
{prior}
---

The compiler's new question:
---
{question}
---

Respond the way a real user would: one or two short sentences, first person, \
direct, no meta-commentary, no "as the user I would say", no quoting yourself. \
Use the true intention above as ground truth — if the intention makes the \
answer clear, give a decisive answer; if the intention does not cover the \
question, pick the most natural interpretation consistent with the rest of \
your stated goal.

You MUST call the submit_answer tool exactly once with your answer.
"""

    before = _snapshot_metrics(llm)
    try:
        messages = [Message(role="user", content=[TextContent(text=prompt)])]
        response = llm.completion(messages=messages, tools=[tool])
    except Exception as exc:
        logger.exception("User proxy clarification LLM call failed")
        return ClarificationAnswer(
            answer=f"(user proxy error: {exc})",
            cost=0.0,
        )

    cost, total_tokens = _delta_metrics(llm, before)

    tool_calls = getattr(response.message, "tool_calls", None) or []
    if not tool_calls:
        logger.error(
            "User proxy did not call submit_answer. Message: %s",
            (
                response.message.model_dump()
                if hasattr(response.message, "model_dump")
                else response.message
            ),
        )
        return ClarificationAnswer(
            answer="(user proxy did not answer — please proceed with your best guess)",
            cost=cost,
            total_tokens=total_tokens,
        )

    raw_args = tool_calls[0].arguments
    args = raw_args if isinstance(raw_args, dict) else json.loads(raw_args)
    answer_text = str(args.get("answer", "")).strip()
    if not answer_text:
        answer_text = "(user proxy returned an empty answer — please proceed.)"
    return ClarificationAnswer(answer=answer_text, cost=cost, total_tokens=total_tokens)


def judge_routine(
    llm: LLM,
    raw_intent: str,
    routine_markdown: str,
    expectations: dict[str, Any],
    asked_questions: list[str],
) -> JudgmentResult:
    """Judge a compiled routine against the fixture's expectations.

    The three axes are scored independently on [0, 1]; ``overall_pass``
    is True iff all three scores are >= 0.8. The raw intent is the
    ground truth the judge compares the routine against; expectations
    encode what the compiler should/shouldn't have asked about and where
    Keywords are mandatory.
    """
    tool = SubmitJudgmentTool.create()[0]
    expectations_json = _format_expectations(expectations)
    asked = (
        "\n".join(f"- {q}" for q in asked_questions) if asked_questions else "(none)"
    )

    prompt = f"""You are judging a compiled Browser Routine on behalf of the user \
who recorded the original trace. You have three jobs. Score each axis \
independently on [0.0, 1.0]; do NOT average them into a single score. Call the \
submit_judgment tool exactly once with all three scores and their reasoning.

---
USER'S RAW INTENTION (ground truth — the compiler did NOT see this):
{raw_intent}
---

FIXTURE EXPECTATIONS (what the compiler should/shouldn't ask about, which
steps must carry a Keywords line, etc.):
```json
{expectations_json}
```
---

CLARIFICATION QUESTIONS THE COMPILER ACTUALLY ASKED during this run:
{asked}
---

COMPILED ROUTINE (what the compiler produced):
```markdown
{routine_markdown}
```
---

Scoring rubric:

1. **intent_match** — Does the routine faithfully execute the user's raw \
intention, end-to-end? 1.0 if the routine's steps accomplish the goal with no \
missing required actions and no extra unrelated actions. Penalize wrong \
actions (e.g. downvote instead of upvote), missing required steps, or \
extra steps that the user did not intend.

2. **keyword_placement** — The fixture's \
`expected_keywords.must_have_for_steps` lists *target elements* (not \
specific routine step numbers) where a clean stable identifier was \
available and a Keywords line is therefore expected somewhere in the \
routine. Each entry has a `description` of the target and a list of \
`acceptable_tokens`. \
\
For each entry, find the routine step(s) that interact with the described \
target — note that a single routine step often legitimately merges \
multiple interactions ("open the menu, click the option, then click \
the destination") per the compiler prompt's "merge low-level trace events \
into meaningful high-level steps" rule. The must_have target may be one \
of several interactions inside a merged step. \
\
Score by counting required-target satisfaction: \
- ✓ The step(s) covering this target carry a `**Keywords:**` line with \
  one of the `acceptable_tokens`, OR with a different token that is \
  itself plausibly distinctive (priority rules 1–7 in the compiler \
  prompt) AND clearly addresses *this* target. \
- ✗ No step covering this target has any Keywords line at all. \
- ✗ The covering step has a Keywords line, but the chosen token \
  addresses a *different* interaction in the same merged step (e.g. \
  the routine merges "click new-doc button" + "click knowledge-base \
  name", and Keywords targets the knowledge-base name when the \
  must_have target is the new-doc button). When this happens, say so \
  in the reasoning — the chosen token is still a valid keyword for a \
  different target, it just doesn't satisfy *this* must_have entry. \
  Don't dismiss it as "wrong" or "irrelevant". \
\
Penalize tokens that are clearly disqualified per the priority list: \
hashed/CSS-module names (`css-x4j8b27`, `Mui…`, `sc-…`, ending in \
random-looking suffixes), overly generic words that would match dozens \
of elements (`btn`, `submit`, `link`, `wrapper`, `input`), or \
multi-word values. \
\
If the fixture lists no `must_have_for_steps` entries (or the list is \
empty), score 1.0 as long as any Keywords lines present look valid.

3. **asking_behavior** — Asymmetric. Compare the actually-asked \
questions against `expected_questions.required`: 1.0 if every required \
topic was covered by at least one asked question. Each missed required \
topic lowers the score. \
\
Extra questions — including ones that overlap topics in \
`expected_questions.forbidden` — do NOT lower the score. The compiler \
erring on the side of asking more is acceptable behaviour; under-asking \
is the actual failure mode this axis is here to catch. The `forbidden` \
list is informational context (signaling topics that *shouldn't* need \
asking because the trace makes them obvious), not a penalty trigger.

`overall_pass` is True iff all three scores are >= 0.8.

You MUST call submit_judgment exactly once.
"""

    before = _snapshot_metrics(llm)
    try:
        messages = [Message(role="user", content=[TextContent(text=prompt)])]
        response = llm.completion(messages=messages, tools=[tool])
    except Exception as exc:
        logger.exception("User proxy judge LLM call failed")
        return JudgmentResult(
            intent_match=0.0,
            keyword_placement=0.0,
            asking_behavior=0.0,
            overall_pass=False,
            reasoning={
                "intent_match": f"judge LLM error: {exc}",
                "keyword_placement": f"judge LLM error: {exc}",
                "asking_behavior": f"judge LLM error: {exc}",
            },
        )

    cost, total_tokens = _delta_metrics(llm, before)

    tool_calls = getattr(response.message, "tool_calls", None) or []
    if not tool_calls:
        logger.error(
            "User proxy judge did not call submit_judgment. Message: %s",
            (
                response.message.model_dump()
                if hasattr(response.message, "model_dump")
                else response.message
            ),
        )
        return JudgmentResult(
            intent_match=0.0,
            keyword_placement=0.0,
            asking_behavior=0.0,
            overall_pass=False,
            reasoning={
                "intent_match": "judge did not call submit_judgment tool",
                "keyword_placement": "judge did not call submit_judgment tool",
                "asking_behavior": "judge did not call submit_judgment tool",
            },
            cost=cost,
            total_tokens=total_tokens,
        )

    raw_args = tool_calls[0].arguments
    args = raw_args if isinstance(raw_args, dict) else json.loads(raw_args)

    def _score(key: str) -> float:
        try:
            return max(0.0, min(1.0, float(args.get(key, 0.0))))
        except (TypeError, ValueError):
            return 0.0

    intent_match = _score("intent_match_score")
    keyword_placement = _score("keyword_placement_score")
    asking_behavior = _score("asking_behavior_score")
    # Always derive overall_pass from the numeric scores rather than
    # trusting the model's flag — LLM tool outputs are not guaranteed
    # to be internally consistent.
    overall_pass = min(intent_match, keyword_placement, asking_behavior) >= 0.8

    return JudgmentResult(
        intent_match=intent_match,
        keyword_placement=keyword_placement,
        asking_behavior=asking_behavior,
        overall_pass=overall_pass,
        reasoning={
            "intent_match": str(args.get("intent_match_reasoning", "")),
            "keyword_placement": str(args.get("keyword_placement_reasoning", "")),
            "asking_behavior": str(args.get("asking_behavior_reasoning", "")),
        },
        cost=cost,
        total_tokens=total_tokens,
        prompt=prompt,
        raw_args=args if isinstance(args, dict) else {},
    )
