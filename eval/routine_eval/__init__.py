"""Routine record/replay evaluation harness.

This package holds the compile-eval orchestrator, the LLM-backed user
proxy/judge, and hand-authored recording fixtures that exercise the
routine compilation pipeline. The replay track lives in
``eval/evaluate_browser_agent.py`` — test cases with a ``routine_file``
field are run in ``routine_replay`` conversation mode and scored by the
same tracker-based criterion matcher used for the rest of the eval
suite.
"""
