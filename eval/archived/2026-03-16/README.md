# Evaluation Reproduction Guide

This evaluation compares OpenClaw Browser Relay vs OpenBrowser Agent on human-like interactive web tasks.

## Test Environment

- Platform: macOS (Apple Silicon)
- Control Model: bailian/glm-5
- OpenBrowser Models: dashscope/qwen3.5-plus, dashscope/qwen3.5-flash

## Prerequisites

1. OpenClaw running with Browser Relay available
2. OpenBrowser installed and configured (see `skill/open-browser/references/setup.md`)
3. Eval server running: `cd OpenBrowser && uv run eval/server.py`
4. Clean OpenClaw session (use `/new` before each test round)

## Round 1: Browser Relay

Start a new OpenClaw session (`/new`) and run:

```
Now we will evaluate OpenClaw Browser Relay and OpenBrowser alternately. You need to use these two tools to complete tests in sequence.

Evaluation method: Run `cd OpenBrowser && uv run eval/evaluate_browser_agent.py --test dataflow --manual` and follow the instructions.

Current test round 1: Use OpenClaw Browser Relay only.

Test requirements:
1. Do NOT read any files under /placeholder/OpenBrowser directory.

2. Follow the test script sequence strictly. Wait for prompts before each action:
   a. Test script shows "Press Enter when ready..." → Send Enter
   b. Test script shows task instruction and "Enter 'ok' when completed" → Now use OpenClaw Browser to complete the task
   c. **After OpenClaw Browser completes the task → Immediately send "ok" + Enter (do NOT wait for any prompt, process exit = send immediately)**
   d. Test script shows score → Send Enter to proceed to next test
   e. Repeat above steps

3. Set reasonable timeout when running OpenClaw Browser to avoid webpage not responding.

4. This test does NOT use any OpenClaw subagent. Complete it yourself.

5. Record for each test: test name, result (pass/fail), score.

6. When interacting with test script, only use send-keys for input. Do NOT use write command, do NOT set eof=true.

Key rules:
- The entire test is a continuous loop, do NOT stop in the middle
- After OpenClaw Browser completes task = immediately send "ok" + Enter, this is automatic, no need to wait for prompt
- Record result of each test

Start
```

**Human intervention required:**
- Control the OpenClaw window throughout the test
- Monitor progress and handle any issues

## Round 2: OpenBrowser

Start a new OpenClaw session (`/new`) and run:

```
Now we will evaluate OpenClaw Browser Relay and OpenBrowser alternately. You need to use these two tools to complete tests in sequence.

Evaluation method: Run `cd /placeholder/OpenBrowser && uv run eval/evaluate_browser_agent.py --manual` and follow the instructions.

Current test round 2: Use OpenBrowser skill (/placeholder/OpenBrowser/skill/open-browser) only.

Test requirements:

1. Do NOT read any files under /placeholder/OpenBrowser directory.

2. Follow the test script sequence strictly. Wait for prompts before each action:
   a. Test script shows "Press Enter when ready..." → Send Enter
   b. Test script shows task instruction and "Enter 'ok' when completed" → Now start OpenBrowser to complete the task
   c. **After OpenBrowser process exits → Immediately send "ok" + Enter (do NOT wait for any prompt, process exit = send immediately)**
   d. Test script shows score → Send Enter to proceed to next test
   e. Repeat above steps

3. When running test script, exec must set timeout: 3600 or larger (this is a long-running interactive script that needs multiple test loops).

4. Give the complete test task to OpenBrowser skill. Set at least 480 timeout. Task description must include:
   - Complete test URL
   - Specific operation steps

5. This test does NOT use any OpenClaw subagent. Complete it yourself.

6. Record for each test: test name, result (pass/fail), score, OpenBrowser usage (cost, tokens).

7. When interacting with test script, only use send-keys for input. Do NOT use write command, do NOT set eof=true.

Key rules:
- The entire test is a continuous loop, do NOT stop in the middle
- OpenBrowser process exit = immediately send "ok" + Enter, this is automatic, no need to wait for prompt
- Record result of each test

Start
```

**Human intervention required:**
- Control the OpenClaw window throughout the test
- Monitor progress and handle any issues

## Test Cases

| # | Test Name | Difficulty | Description |
|---|-----------|------------|-------------|
| 1 | CloudStack DAS Interactive | medium | Multi-turn dialogue with DAS agent |
| 2 | GBR Search | easy | Search for "fed" related news |
| 3 | TechForum Comment Reply | hard | Locate specified comment and reply |
| 4 | TechForum Upvote | easy | Upvote a post |
| 5 | CloudStack DAS Agent | hard | Locate DAS console and send greeting |
| 6 | DataFlow Visual Challenge | hard | Multi-step UI operations |
| 7 | GBR Detailed Search & Read | medium | Search, read multiple articles, summarize |

## Results Summary

See `browser_agent_evaluation_2026-03-16_openclaw_vs_openbrowser.md` for detailed results.

| Metric | Browser Relay | OpenBrowser Plus | OpenBrowser Flash |
|--------|---------------|------------------|-------------------|
| Pass Rate | 85.7% | **100%** | 100%* |
| Context Usage | 640% (overflow) | **21%** | **12%** |
| Avg. Time | 211s | 274s | 317s |