#!/usr/bin/env python3
"""Compile-eval orchestrator for the routine record/replay feature.

This CLI walks a set of hand-authored recording fixtures through the
Compiler Agent end-to-end and scores each resulting Routine with the
LLM-backed user proxy/judge in :mod:`user_proxy`.

Per fixture the flow is:

1. ``POST /recordings/ingest`` — load ``recording.json`` (plus
   ``intent_note.txt``) into the server's ``recording_manager`` as a
   STOPPED row and get back a ``recording_id``. The endpoint is gated
   behind ``OPENBROWSER_ENABLE_TEST_ROUTES=1`` so this script only works
   against a server started with that flag.
2. ``POST /recordings/{id}/compile`` — stream the Compiler Agent's SSE
   events until a ``complete`` event arrives.
3. If the complete event's ``result.status`` is ``asking``, pull the
   ``question`` field, hand it to
   :func:`user_proxy.answer_clarification` together with the fixture's
   hidden ``raw_intention.md``, then ``POST /recordings/{id}/compile/answer``
   and continue streaming. Loop until the compiler stops asking.
4. Once the compiler reports ``review`` (or ``completed``), hand the
   resulting ``routine_markdown`` to :func:`user_proxy.judge_routine`
   along with the fixture's ``expectations.yaml`` and the list of
   questions the compiler actually asked. Record the three-axis scores.
5. ``DELETE /recordings/{id}`` — tear the fixture row + compiler session
   down so repeated runs on the same fixture do not leak state.

Per-fixture rows plus aggregates (mean intent_match, mean
keyword_placement, mean asking_behavior, pass count, total proxy cost)
are written to ``eval/output/routine_compile_<timestamp>/routine_compile_report.json``.

Usage::

    # Start the server in one shell with the test routes enabled.
    OPENBROWSER_ENABLE_TEST_ROUTES=1 uv run local-chrome-server serve

    # Then in another shell:
    uv run python eval/routine_eval/evaluate_routine_compile.py \
        --fixture techforum_upvote_clear \
        --compile-alias primary \
        --judge-alias judge
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Optional

import requests
import yaml

# ---------------------------------------------------------------------------
#  Path shim — make the script runnable as a plain Python file even though
#  neither ``eval`` nor ``eval/routine_eval`` is an installed package. We
#  need the repo root so that ``from server.core.llm_config import ...`` in
#  ``user_proxy`` resolves, and this directory so we can import
#  ``user_proxy`` without turning ``eval/`` into a package.
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
for _p in (str(REPO_ROOT), str(HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from user_proxy import (  # noqa: E402  (import after sys.path shim)
    JudgmentResult,
    answer_clarification,
    build_user_proxy_llm,
    judge_routine,
)

logger = logging.getLogger("routine_compile_eval")


# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://localhost:8765"
FIXTURES_DIR = HERE / "fixtures"
OUTPUT_BASE_DIR = HERE.parent / "output"

# Per-HTTP-call timeouts. The compile SSE stream can take minutes to finish
# on a long trace, so we use a long read timeout but a short connect
# timeout so a dead server fails fast instead of hanging.
CONNECT_TIMEOUT = 10.0
SSE_READ_TIMEOUT = 900.0
SHORT_TIMEOUT = 30.0

# Safety cap on ask_user rounds per fixture. A real compile session that
# asks more than a handful of questions is almost certainly wedged in a
# loop, so we fail the fixture rather than burn the budget.
DEFAULT_MAX_ASK_ROUNDS = 5


# ---------------------------------------------------------------------------
#  Fixture loading
# ---------------------------------------------------------------------------


@dataclass
class Fixture:
    """One hand-authored compile-eval fixture on disk."""

    fixture_id: str
    intent_note: Optional[str]
    raw_intention: str
    expectations: dict[str, Any]
    events: list[dict[str, Any]]

    @classmethod
    def load(cls, fixture_dir: Path) -> "Fixture":
        if not fixture_dir.is_dir():
            raise FileNotFoundError(f"Fixture directory not found: {fixture_dir}")

        recording_path = fixture_dir / "recording.json"
        if not recording_path.exists():
            raise FileNotFoundError(f"Missing recording.json in {fixture_dir}")
        with recording_path.open(encoding="utf-8") as fh:
            payload = json.load(fh)
        # Accept either a raw event list OR the shape returned by
        # GET /recordings/{id}/events ({"events": [...], ...}).
        if isinstance(payload, dict) and "events" in payload:
            events = payload["events"]
        elif isinstance(payload, list):
            events = payload
        else:
            raise ValueError(
                f"{recording_path} must be a list or an object with an 'events' key"
            )
        if not events:
            raise ValueError(f"{recording_path} has no events")

        intent_note: Optional[str] = None
        intent_note_path = fixture_dir / "intent_note.txt"
        if intent_note_path.exists():
            intent_note = intent_note_path.read_text(encoding="utf-8").strip() or None

        raw_intention_path = fixture_dir / "raw_intention.md"
        if not raw_intention_path.exists():
            raise FileNotFoundError(f"Missing raw_intention.md in {fixture_dir}")
        raw_intention = raw_intention_path.read_text(encoding="utf-8").strip()
        if not raw_intention:
            raise ValueError(f"{raw_intention_path} is empty")

        expectations_path = fixture_dir / "expectations.yaml"
        if not expectations_path.exists():
            raise FileNotFoundError(f"Missing expectations.yaml in {fixture_dir}")
        with expectations_path.open(encoding="utf-8") as fh:
            expectations = yaml.safe_load(fh) or {}
        if not isinstance(expectations, dict):
            raise ValueError(
                f"{expectations_path} must parse to a YAML mapping, got {type(expectations).__name__}"
            )

        return cls(
            fixture_id=fixture_dir.name,
            intent_note=intent_note,
            raw_intention=raw_intention,
            expectations=expectations,
            events=events,
        )


# ---------------------------------------------------------------------------
#  Per-fixture run result
# ---------------------------------------------------------------------------


@dataclass
class FixtureRunResult:
    fixture_id: str
    success: bool = False
    final_status: str = ""
    routine_markdown: str = ""
    asked_questions: list[dict[str, str]] = field(default_factory=list)
    judgment: Optional[JudgmentResult] = None
    error: Optional[str] = None
    proxy_cost: float = 0.0
    proxy_tokens: int = 0
    compile_duration_seconds: float = 0.0
    recording_id: Optional[str] = None
    agent_events: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fixture_id": self.fixture_id,
            "success": self.success,
            "final_status": self.final_status,
            "routine_markdown": self.routine_markdown,
            "asked_questions": self.asked_questions,
            "judgment": self.judgment.to_dict() if self.judgment is not None else None,
            "error": self.error,
            "proxy_cost": self.proxy_cost,
            "proxy_tokens": self.proxy_tokens,
            "compile_duration_seconds": self.compile_duration_seconds,
            "recording_id": self.recording_id,
            "agent_events": self.agent_events,
        }


# ---------------------------------------------------------------------------
#  SSE helpers
# ---------------------------------------------------------------------------


def _iter_sse(response: requests.Response) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield ``(event_type, data)`` tuples from an SSE stream.

    The OpenBrowser SSE producer escapes newlines inside ``data`` as the
    literal string ``\\n`` (see ``server/api/sse.py:SSEEvent.to_sse_format``),
    so each event fits on one ``data:`` line and we don't need to
    reassemble multi-line payloads here. We still handle multi-line data
    defensively — the first parseable JSON wins.
    """
    event_type: Optional[str] = None
    data_lines: list[str] = []

    for raw_line in response.iter_lines(decode_unicode=True):
        # iter_lines yields None on keep-alive pings in some versions.
        if raw_line is None:
            continue
        if raw_line == "":
            # Blank line terminates an event.
            if event_type is not None and data_lines:
                data_str = "\n".join(data_lines)
                try:
                    data_obj = json.loads(data_str)
                except json.JSONDecodeError as exc:
                    logger.warning(
                        "Unparseable SSE payload on %s: %s (first 200 chars: %r)",
                        event_type,
                        exc,
                        data_str[:200],
                    )
                else:
                    yield event_type, data_obj
            event_type = None
            data_lines = []
            continue
        if raw_line.startswith(":"):
            # SSE comment / heartbeat — ignore.
            continue
        if raw_line.startswith("event:"):
            event_type = raw_line[len("event:") :].strip()
        elif raw_line.startswith("data:"):
            data_lines.append(raw_line[len("data:") :].lstrip())


def _format_agent_event(data: dict[str, Any], truncate: int = 500) -> Optional[str]:
    """Format an ``agent_event`` SSE payload into a single line.

    Mirrors the frontend's ``appendCompilerLogEntry()`` labels:
    ``STEP [tool]``, ``ASK``, ``RESULT [tool]``, ``AGENT``.

    All newlines in the body are collapsed to ``" | "`` so each event
    is exactly one terminal line — easy to scan and unambiguous about
    where one event ends and the next begins.

    *truncate* caps the body length. Pass ``0`` for no limit (``--full-events``).

    Returns ``None`` for events that aren't worth printing (e.g.
    system prompts or initial user messages).
    """
    event_type = data.get("type", "")
    tool = data.get("tool_name", "")
    text = data.get("text", "")

    def _oneline(s: str) -> str:
        """Collapse newlines and compress whitespace into a single line."""
        return " | ".join(
            part for line in s.splitlines() if (part := line.strip())
        )

    def _prep(s: str) -> str:
        s = _oneline(s)
        if truncate and len(s) > truncate:
            return s[:truncate] + "…"
        return s

    if event_type == "ActionEvent":
        body = data.get("summary") or data.get("action") or ""
        if tool == "ask_user":
            return f"  ASK  {_prep(body)}" if body else "  ASK"
        label = f"STEP [{tool}]" if tool else "STEP"
        return f"  {label}  {_prep(body)}" if body else f"  {label}"

    if event_type == "ObservationEvent":
        label = f"RESULT [{tool}]" if tool else "RESULT"
        # Extract result content, stripping the "Tool: ...\nResult:\n" header.
        body = ""
        if text:
            if "Result:\n" in text:
                body = text.split("Result:\n", 1)[1].strip()
            elif "Tool:" in text:
                lines = text.split("\n", 1)
                body = lines[1].strip() if len(lines) > 1 else text
            else:
                body = text.strip()
        if not body:
            body = data.get("message") or data.get("error") or ""
        return f"  {label}  {_prep(body)}" if body else f"  {label}"

    if event_type == "MessageEvent":
        role = data.get("role") or data.get("source") or ""
        if role in ("agent", "assistant"):
            return f"  AGENT  {_prep(text)}" if text else "  AGENT"
        return None  # skip user/system messages

    return None


def _consume_until_terminal(
    response: requests.Response,
    agent_events_out: Optional[list[dict[str, Any]]] = None,
    verbose: bool = False,
    event_truncate: int = 500,
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """Read an SSE stream until ``complete`` or ``error`` arrives.

    Returns ``(complete_payload, error_payload)`` where exactly one of
    the two is set on a well-formed stream. If the stream ends without
    either, both are ``None``.

    If *agent_events_out* is provided, every ``agent_event`` payload is
    appended to it (for inclusion in the report). When *verbose* is
    ``True``, agent events are printed to stderr in real time,
    truncated to *event_truncate* chars (0 = no limit).
    """
    try:
        for event_type, data in _iter_sse(response):
            if event_type == "agent_event":
                if agent_events_out is not None:
                    agent_events_out.append(data)
                if verbose:
                    line = _format_agent_event(data, truncate=event_truncate)
                    if line:
                        print(line, file=sys.stderr, flush=True)
                continue
            if event_type == "complete":
                return data, None
            if event_type == "error":
                return None, data
    finally:
        response.close()
    return None, None


# ---------------------------------------------------------------------------
#  Server interaction
# ---------------------------------------------------------------------------


def _probe_server(base_url: str) -> None:
    """Fail loudly if the server is unreachable or the ingest route is gated."""
    try:
        resp = requests.get(f"{base_url}/health", timeout=SHORT_TIMEOUT)
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Cannot reach OpenBrowser server at {base_url}: {exc}. "
            f"Start it with `OPENBROWSER_ENABLE_TEST_ROUTES=1 uv run local-chrome-server serve`."
        ) from exc
    if resp.status_code >= 400:
        raise RuntimeError(
            f"OpenBrowser health check at {base_url} returned HTTP {resp.status_code}"
        )

    # Probe the ingest endpoint with an intentionally invalid body. The
    # route rejects an empty event list with 400 when it is enabled and
    # returns 404 when OPENBROWSER_ENABLE_TEST_ROUTES is unset, so the
    # two outcomes are easy to tell apart.
    probe_body = {"name": "__routine_eval_probe__", "events": []}
    try:
        probe = requests.post(
            f"{base_url}/recordings/ingest",
            json=probe_body,
            timeout=SHORT_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Ingest probe failed: {exc}") from exc
    if probe.status_code == 404:
        raise RuntimeError(
            "POST /recordings/ingest is disabled. Restart the OpenBrowser "
            "server with OPENBROWSER_ENABLE_TEST_ROUTES=1 in its environment."
        )
    if probe.status_code not in (400, 422):
        raise RuntimeError(
            f"Unexpected ingest probe response {probe.status_code}: {probe.text[:200]}"
        )


def _ingest_fixture(base_url: str, fixture: Fixture) -> str:
    body = {
        "name": f"routine-eval-{fixture.fixture_id}-{uuid.uuid4().hex[:8]}",
        "intent_note": fixture.intent_note,
        "events": fixture.events,
        "metadata": {
            "fixture_id": fixture.fixture_id,
            "ingest_source": "routine_eval",
        },
    }
    resp = requests.post(
        f"{base_url}/recordings/ingest",
        json=body,
        timeout=(CONNECT_TIMEOUT, SHORT_TIMEOUT),
    )
    resp.raise_for_status()
    data = resp.json()
    recording_id = data.get("recording_id")
    if not recording_id:
        raise RuntimeError(f"Ingest returned no recording_id: {data}")
    return recording_id


def _delete_recording(base_url: str, recording_id: str) -> None:
    try:
        resp = requests.delete(
            f"{base_url}/recordings/{recording_id}",
            timeout=SHORT_TIMEOUT,
        )
        if resp.status_code >= 400:
            logger.warning(
                "DELETE /recordings/%s returned %s: %s",
                recording_id,
                resp.status_code,
                resp.text[:200],
            )
    except requests.RequestException as exc:
        logger.warning("Failed to delete recording %s: %s", recording_id, exc)


def _stream_compile(
    base_url: str,
    recording_id: str,
    compile_alias: Optional[str],
) -> requests.Response:
    return requests.post(
        f"{base_url}/recordings/{recording_id}/compile",
        json={"model_alias": compile_alias},
        stream=True,
        timeout=(CONNECT_TIMEOUT, SSE_READ_TIMEOUT),
    )


def _stream_compile_answer(
    base_url: str,
    recording_id: str,
    answer: str,
) -> requests.Response:
    return requests.post(
        f"{base_url}/recordings/{recording_id}/compile/answer",
        json={"answer": answer},
        stream=True,
        timeout=(CONNECT_TIMEOUT, SSE_READ_TIMEOUT),
    )


# ---------------------------------------------------------------------------
#  Per-fixture driver
# ---------------------------------------------------------------------------


def run_one_fixture(
    base_url: str,
    fixture: Fixture,
    compile_alias: Optional[str],
    judge_llm: Any,
    max_ask_rounds: int = DEFAULT_MAX_ASK_ROUNDS,
    verbose: bool = False,
    event_truncate: int = 500,
) -> FixtureRunResult:
    """Drive one fixture end-to-end: ingest → compile loop → judge."""
    result = FixtureRunResult(fixture_id=fixture.fixture_id)
    start_time = time.time()
    recording_id: Optional[str] = None
    all_agent_events: list[dict[str, Any]] = []

    try:
        if verbose:
            _log(f"  ingesting fixture {fixture.fixture_id}...")
        recording_id = _ingest_fixture(base_url, fixture)
        result.recording_id = recording_id
        if verbose:
            _log(f"  recording_id={recording_id}, starting compile stream...")

        response = _stream_compile(base_url, recording_id, compile_alias)
        response.raise_for_status()
        if verbose:
            _log("  compile stream opened, waiting for events...")

        asked_history: list[dict[str, str]] = []
        final_compile_result: Optional[dict[str, Any]] = None
        ask_round = 0

        while True:
            complete, error = _consume_until_terminal(
                response,
                agent_events_out=all_agent_events,
                verbose=verbose,
                event_truncate=event_truncate,
            )
            if error is not None:
                result.error = f"Compiler error event: {error.get('error', error)}"
                result.compile_duration_seconds = time.time() - start_time
                return result
            if complete is None:
                result.error = "Compile SSE stream ended without a complete event"
                result.compile_duration_seconds = time.time() - start_time
                return result

            compile_result = complete.get("result") or {}
            status = compile_result.get("status") or ""

            if status != "asking":
                final_compile_result = compile_result
                break

            question = (compile_result.get("question") or "").strip()
            if not question:
                result.error = "Compiler status=asking but payload had no question text"
                result.compile_duration_seconds = time.time() - start_time
                return result

            if ask_round >= max_ask_rounds:
                result.error = (
                    f"Compiler exceeded max_ask_rounds={max_ask_rounds}; "
                    f"aborting to avoid an infinite clarification loop"
                )
                result.asked_questions = asked_history
                result.compile_duration_seconds = time.time() - start_time
                return result
            ask_round += 1

            clar = answer_clarification(
                llm=judge_llm,
                raw_intent=fixture.raw_intention,
                question=question,
                history=asked_history,
            )
            result.proxy_cost += clar.cost
            result.proxy_tokens += clar.total_tokens
            asked_history.append({"question": question, "answer": clar.answer})
            logger.info(
                "[%s] ask #%d: %s -> %s",
                fixture.fixture_id,
                ask_round,
                question[:80],
                clar.answer[:80],
            )

            response = _stream_compile_answer(base_url, recording_id, clar.answer)
            response.raise_for_status()

        result.final_status = (final_compile_result or {}).get("status", "") or ""
        routine_markdown = ((final_compile_result or {}).get("routine_markdown") or "").strip()
        result.routine_markdown = routine_markdown
        result.asked_questions = asked_history
        result.compile_duration_seconds = time.time() - start_time

        if result.final_status not in ("review", "completed"):
            result.error = (
                f"Compile ended in unexpected status: "
                f"{result.final_status or '(empty)'}"
            )
            return result
        if not routine_markdown:
            result.error = "Compile finished but routine_markdown was empty"
            return result

        if verbose:
            _log(
                f"  compile done (status={result.final_status}, "
                f"{len(all_agent_events)} agent events, "
                f"{len(asked_history)} questions). judging..."
            )
        judgment = judge_routine(
            llm=judge_llm,
            raw_intent=fixture.raw_intention,
            routine_markdown=routine_markdown,
            expectations=fixture.expectations,
            asked_questions=[qa["question"] for qa in asked_history],
        )
        result.judgment = judgment
        result.proxy_cost += judgment.cost
        result.proxy_tokens += judgment.total_tokens
        result.success = True

        # Print judge reasoning so the user can see why it scored that way.
        if judgment.reasoning:
            for axis, text in judgment.reasoning.items():
                if text:
                    print(
                        f"  [judge {axis}] {text[:300]}",
                        file=sys.stderr,
                        flush=True,
                    )

    except requests.HTTPError as exc:
        body = ""
        if exc.response is not None:
            try:
                body = exc.response.text[:500]
            except Exception:
                body = ""
        result.error = f"HTTP error during compile: {exc} ({body})"
    except Exception as exc:
        logger.exception("Fixture %s failed with an unexpected error", fixture.fixture_id)
        result.error = f"Orchestrator error: {exc}"
    finally:
        result.agent_events = all_agent_events
        if recording_id is not None:
            _delete_recording(base_url, recording_id)
        if result.compile_duration_seconds == 0.0:
            result.compile_duration_seconds = time.time() - start_time

    return result


# ---------------------------------------------------------------------------
#  Aggregation + report
# ---------------------------------------------------------------------------


def aggregate(results: list[FixtureRunResult]) -> dict[str, Any]:
    judged = [r for r in results if r.judgment is not None]
    passed = sum(1 for r in judged if r.judgment and r.judgment.overall_pass)
    summary: dict[str, Any] = {
        "fixture_count": len(results),
        "judged_count": len(judged),
        "passed_count": passed,
        "total_proxy_cost": round(sum(r.proxy_cost for r in results), 6),
        "total_proxy_tokens": sum(r.proxy_tokens for r in results),
    }
    if judged:
        summary["mean_intent_match"] = round(
            sum(r.judgment.intent_match for r in judged) / len(judged), 4
        )
        summary["mean_keyword_placement"] = round(
            sum(r.judgment.keyword_placement for r in judged) / len(judged), 4
        )
        summary["mean_asking_behavior"] = round(
            sum(r.judgment.asking_behavior for r in judged) / len(judged), 4
        )
    else:
        summary["mean_intent_match"] = None
        summary["mean_keyword_placement"] = None
        summary["mean_asking_behavior"] = None
    return summary


def _print_summary(results: list[FixtureRunResult], summary: dict[str, Any]) -> None:
    print()
    print("=" * 72)
    print("Routine compile eval — fixture results")
    print("=" * 72)
    for r in results:
        if r.judgment is not None:
            j = r.judgment
            status = "PASS" if j.overall_pass else "FAIL"
            print(
                f"  {r.fixture_id:40s}  {status}  "
                f"intent={j.intent_match:.2f}  "
                f"keywords={j.keyword_placement:.2f}  "
                f"asking={j.asking_behavior:.2f}  "
                f"asks={len(r.asked_questions)}"
            )
        else:
            print(f"  {r.fixture_id:40s}  ERROR  {r.error}")
    print("-" * 72)
    print(
        f"  fixtures={summary['fixture_count']}  "
        f"judged={summary['judged_count']}  "
        f"passed={summary['passed_count']}"
    )
    if summary.get("mean_intent_match") is not None:
        print(
            f"  mean intent_match       = {summary['mean_intent_match']:.3f}\n"
            f"  mean keyword_placement  = {summary['mean_keyword_placement']:.3f}\n"
            f"  mean asking_behavior    = {summary['mean_asking_behavior']:.3f}"
        )
    print(
        f"  total proxy cost        = {summary['total_proxy_cost']:.4f} "
        f"({summary['total_proxy_tokens']} tokens)"
    )
    print("=" * 72)


# ---------------------------------------------------------------------------
#  CLI
# ---------------------------------------------------------------------------


def _discover_fixtures(fixtures_dir: Path) -> list[str]:
    if not fixtures_dir.is_dir():
        return []
    return sorted(d.name for d in fixtures_dir.iterdir() if d.is_dir())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run the routine compile-eval harness: drive hand-authored "
            "recording fixtures through the Compiler Agent and score each "
            "resulting routine with an LLM-backed user proxy + judge."
        ),
    )
    parser.add_argument(
        "--fixture",
        action="append",
        dest="fixtures",
        help=(
            "Fixture id (name of the directory under eval/routine_eval/fixtures/). "
            "May be passed multiple times. Ignored if --all is set."
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run every fixture directory under eval/routine_eval/fixtures/.",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"OpenBrowser server base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--compile-alias",
        default=None,
        help=(
            "LLM alias (from ~/.openbrowser/llm_config.json) to use for the "
            "Compiler Agent. Defaults to the server's default alias."
        ),
    )
    parser.add_argument(
        "--judge-alias",
        default=None,
        help=(
            "LLM alias to use for the user proxy and judge. Defaults to the "
            "same alias as the compiler. Point this at a stronger model "
            "(e.g. 'judge') for more reliable scoring."
        ),
    )
    parser.add_argument(
        "--max-ask-rounds",
        type=int,
        default=DEFAULT_MAX_ASK_ROUNDS,
        help=(
            f"Safety cap on ask_user rounds per fixture. Default: "
            f"{DEFAULT_MAX_ASK_ROUNDS}."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Override output directory. Defaults to "
            "eval/output/routine_compile_<timestamp>/."
        ),
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Stream compiler agent events to stderr in real time.",
    )
    parser.add_argument(
        "--full-events",
        action="store_true",
        help="With -v, print full event text without truncation.",
    )
    return parser


def _log(msg: str) -> None:
    """Print a timestamped message to stderr immediately (no buffering)."""
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", file=sys.stderr, flush=True)


def main(argv: Optional[list[str]] = None) -> int:
    _log("parsing args...")
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )
    # Quiet noisy third-party loggers even in verbose mode.
    for noisy in ("LiteLLM", "litellm", "httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if args.all:
        fixture_ids = _discover_fixtures(FIXTURES_DIR)
        if not fixture_ids:
            logger.error("No fixtures found under %s", FIXTURES_DIR)
            return 2
    else:
        fixture_ids = list(args.fixtures or [])
        if not fixture_ids:
            parser.error("Pass --fixture ID (one or more) or --all.")

    _log(f"fixtures: {fixture_ids}")
    _log(f"probing server at {args.base_url}...")
    try:
        _probe_server(args.base_url)
    except RuntimeError as exc:
        logger.error(str(exc))
        return 2
    _log("server OK")

    judge_alias = args.judge_alias or args.compile_alias
    _log(f"building judge LLM (alias={judge_alias})...")
    try:
        judge_llm = build_user_proxy_llm(model_alias=judge_alias)
    except Exception as exc:
        logger.error("Failed to build judge LLM: %s", exc)
        return 2
    _log("judge LLM ready")

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_dir = args.output_dir or (OUTPUT_BASE_DIR / f"routine_compile_{timestamp}")
    output_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Writing report to %s", output_dir)

    results: list[FixtureRunResult] = []
    for fid in fixture_ids:
        fixture_dir = FIXTURES_DIR / fid
        try:
            fixture = Fixture.load(fixture_dir)
        except Exception as exc:
            logger.error("Failed to load fixture %s: %s", fid, exc)
            results.append(
                FixtureRunResult(
                    fixture_id=fid,
                    error=f"fixture load error: {exc}",
                )
            )
            continue

        _log(f"▶ running fixture: {fid} ({len(fixture.events)} events)")
        result = run_one_fixture(
            base_url=args.base_url,
            fixture=fixture,
            compile_alias=args.compile_alias,
            judge_llm=judge_llm,
            max_ask_rounds=args.max_ask_rounds,
            verbose=args.verbose,
            event_truncate=0 if args.full_events else 500,
        )
        results.append(result)

        if result.judgment is not None:
            j = result.judgment
            logger.info(
                "  done  intent=%.2f  keywords=%.2f  asking=%.2f  pass=%s",
                j.intent_match,
                j.keyword_placement,
                j.asking_behavior,
                j.overall_pass,
            )
        else:
            logger.error("  failed: %s", result.error)

    summary = aggregate(results)
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "base_url": args.base_url,
        "compile_alias": args.compile_alias,
        "judge_alias": judge_alias,
        "fixture_ids": fixture_ids,
        "fixtures": [r.to_dict() for r in results],
        "summary": summary,
    }
    report_path = output_dir / "routine_compile_report.json"
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Wrote %s", report_path)

    _print_summary(results, summary)

    # Exit 0 iff every fixture both completed and passed the judge.
    all_passed = bool(results) and all(
        r.judgment is not None and r.judgment.overall_pass for r in results
    )
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
