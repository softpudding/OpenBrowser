"""Unit tests for ``finalize_compiler_session`` guards.

These cover the guard added alongside the recording-mode follow-up:
finalize must refuse to persist a draft unless the compiler session has
actually reached post-submit review state, and the draft must re-validate
via ``validate_routine_markdown`` before the session is torn down.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from server.core import compiler_agent


def _valid_routine_markdown() -> str:
    return (
        "# Workflow: Example flow\n"
        "\n"
        "## Prerequisites\n"
        "- Starting URL: https://example.com/\n"
        "\n"
        "## Step 1: Open the page\n"
        "Visit the starting URL.\n"
    )


def _make_fake_session(tmp_path, *, draft_text: str) -> SimpleNamespace:
    """Build a minimal stand-in for ``CompilerSession``.

    The real dataclass pulls in ``openhands.sdk.Conversation``, which is
    heavy to construct. The only attributes ``finalize_compiler_session``
    touches on the session are:

    - ``conversation.state.events`` (fed to ``_detect_review_state``)
    - ``conversation.close()`` (on the happy path)
    - ``draft_path``                (read by ``_read_routine_from_session``)
    - ``model``                     (copied into ``routine_doc``)

    A ``SimpleNamespace`` with those fields is enough.
    """
    draft_path = tmp_path / "routine.md"
    draft_path.write_text(draft_text, encoding="utf-8")

    close_calls: list[int] = []

    class _Conversation:
        def __init__(self) -> None:
            self.state = SimpleNamespace(events=[])

        def close(self) -> None:
            close_calls.append(1)

    session = SimpleNamespace(
        recording_id="rec-test",
        conversation=_Conversation(),
        draft_path=str(draft_path),
        workspace_dir=str(tmp_path),
        model="dashscope/qwen3.5-plus",
        trace_path=None,
    )
    # Expose the call log so tests can assert teardown happened (or not).
    session._close_calls = close_calls  # type: ignore[attr-defined]
    return session


@pytest.fixture
def clear_compiler_sessions():
    """Guarantee a clean module-level ``_compiler_sessions`` dict per test."""
    compiler_agent._compiler_sessions.clear()
    yield
    compiler_agent._compiler_sessions.clear()


class TestFinalizeCompilerSession:
    def test_rejects_unknown_recording(self, clear_compiler_sessions) -> None:
        with pytest.raises(ValueError, match="Nothing to finalize"):
            compiler_agent.finalize_compiler_session("unknown-rec")

    def test_rejects_asking_state(
        self, tmp_path, monkeypatch, clear_compiler_sessions
    ) -> None:
        """If the agent hasn't submitted yet, finalize must refuse."""
        session = _make_fake_session(tmp_path, draft_text=_valid_routine_markdown())
        compiler_agent._compiler_sessions["rec-test"] = session

        # Simulate "no successful submit" → not in review.
        monkeypatch.setattr(
            compiler_agent, "_detect_review_state", lambda events: (False, None)
        )

        with pytest.raises(ValueError, match="post-submit review state"):
            compiler_agent.finalize_compiler_session("rec-test")

        # Session must stay alive so the user can keep answering.
        assert "rec-test" in compiler_agent._compiler_sessions
        assert session._close_calls == []

    def test_rejects_invalid_markdown(
        self, tmp_path, monkeypatch, clear_compiler_sessions
    ) -> None:
        """Markdown that fails ``validate_routine_markdown`` must be rejected."""
        broken_markdown = "not a routine — no headings at all"
        session = _make_fake_session(tmp_path, draft_text=broken_markdown)
        compiler_agent._compiler_sessions["rec-test"] = session

        monkeypatch.setattr(
            compiler_agent, "_detect_review_state", lambda events: (True, None)
        )
        # Skip the real trace dumping — it writes to ~/.openbrowser.
        monkeypatch.setattr(compiler_agent, "_dump_trace", lambda _session: None)

        with pytest.raises(ValueError, match="failed validation"):
            compiler_agent.finalize_compiler_session("rec-test")

        # Validation failure leaves the session alive so the user can
        # send revision feedback through /compile/answer.
        assert "rec-test" in compiler_agent._compiler_sessions
        assert session._close_calls == []

    def test_happy_path_returns_completed_routine(
        self, tmp_path, monkeypatch, clear_compiler_sessions
    ) -> None:
        """Valid review-state session finalizes cleanly and tears down."""
        session = _make_fake_session(tmp_path, draft_text=_valid_routine_markdown())
        compiler_agent._compiler_sessions["rec-test"] = session

        monkeypatch.setattr(
            compiler_agent, "_detect_review_state", lambda events: (True, "ok")
        )
        monkeypatch.setattr(
            compiler_agent, "_dump_trace", lambda _session: "/tmp/fake-trace.json"
        )

        result: dict[str, Any] = compiler_agent.finalize_compiler_session("rec-test")

        assert result["status"] == "completed"
        assert result["recording_id"] == "rec-test"
        assert result["model"] == "dashscope/qwen3.5-plus"
        assert result["trace_path"] == "/tmp/fake-trace.json"
        assert result["goal"] == "Example flow"
        assert result["step_count"] == 1
        assert "# Workflow: Example flow" in result["routine_markdown"]

        # Session is torn down on success.
        assert "rec-test" not in compiler_agent._compiler_sessions
        assert session._close_calls == [1]
