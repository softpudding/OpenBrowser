# Browser Agent Evaluation Report

**Date:** 2026-03-16  
**Platform:** macOS (Apple Silicon)

---

## 1. Subjects

| Tool | Architecture | Control Model | Execution Model |
|------|--------------|---------------|-----------------|
| OpenClaw Browser Relay | Monolithic | bailian/glm-5 | bailian/glm-5 |
| OpenBrowser (qwen3.5-plus) | Independent Agent | bailian/glm-5 | dashscope/qwen3.5-plus |
| OpenBrowser (qwen3.5-flash) | Independent Agent | bailian/glm-5 | dashscope/qwen3.5-flash |

**Architecture Notes:**

- **OpenClaw Browser Relay**: The control window directly operates the browser. All browser states (screenshots, DOM, page content) are stored in the control window context.
- **OpenBrowser**: An independent agent service. The control window only sends task descriptions and receives results. Browser operations are handled by a dedicated model.

---

## 2. Test Cases

Seven test cases covering varying complexity levels:

| # | Test Name | Difficulty | Description | Time Limit |
|---|-----------|------------|-------------|------------|
| 1 | CloudStack DAS Interactive | medium | Locate DAS console, conduct multi-turn dialogue with agent | 500s |
| 2 | GBR Search | easy | Search for "fed" related news | 400s |
| 3 | TechForum Comment Reply | hard | Locate specified comment and reply | 500s |
| 4 | TechForum Upvote | easy | Upvote a post | 300s |
| 5 | CloudStack DAS Agent | hard | Locate DAS console and send greeting | 500s |
| 6 | DataFlow Visual Challenge | hard | Multi-step UI operations (settings, reports, navigation) | 600s |
| 7 | GBR Detailed Search & Read | medium | Search, read multiple articles, and summarize | 600s |

---

## 3. Test Results

### 3.1 Overall Metrics

| Metric | Browser Relay | OpenBrowser Plus | OpenBrowser Flash |
|--------|---------------|------------------|-------------------|
| **Pass Rate** | 85.7% (6/7) | 100% (7/7) | 71.4% → 100%* |
| **Avg. Execution Time** | 211s | 274s | 317s |
| **Avg. Efficiency Score** | 0.58 | 0.56 | 0.48 |
| **OpenBrowser Cost** | N/A | ¥4.04 | ¥1.65* |
| **Control Window Context** | 640% | 21% | 12% |

*Flash initial pass rate 71.4%, 100% after retry; cost includes initial + retry

### 3.2 Detailed Results per Test

| # | Test Name | Tool | Result | Score | Time(s) | Efficiency | Cost(¥) |
|---|-----------|------|--------|-------|---------|------------|---------|
| 1 | CloudStack DAS Interactive | Browser Relay | ✅ | 8.0/9.0 | 137 | 0.80 | - |
|   |  | OpenBrowser Plus | ✅ | 8.0/9.0 | 247 | 0.65 | 0.531 |
|   |  | OpenBrowser Flash | ✅ | 8.0/9.0 | 348 | 0.50 | 0.180 |
| 2 | GBR Search | Browser Relay | ✅ | 2.5/2.5 | 66 | 0.83 | - |
|   |  | OpenBrowser Plus | ✅ | 2.5/2.5 | 87 | 0.78 | 0.197 |
|   |  | OpenBrowser Flash | ✅ | 2.5/2.5 | 135 | 0.66 | 0.072 |
| 3 | TechForum Comment Reply | Browser Relay | ✅ | 9.5/9.5 | 130 | 0.74 | - |
|   |  | OpenBrowser Plus | ✅ | 9.5/9.5 | 257 | 0.49 | 0.799 |
|   |  | OpenBrowser Flash | ✅ | 9.5/9.5 | 435 | 0.13 | 0.376 |
| 4 | TechForum Upvote | Browser Relay | ✅ | 2.0/2.0 | 50 | 0.83 | - |
|   |  | OpenBrowser Plus | ✅ | 2.0/2.0 | 53 | 0.82 | 0.090 |
|   |  | OpenBrowser Flash | ✅ | 2.0/2.0 | 70 | 0.77 | 0.028 |
| 5 | CloudStack DAS Agent | Browser Relay | ✅ | 3.5/3.5 | 95 | 0.81 | - |
|   |  | OpenBrowser Plus | ✅ | 3.5/3.5 | 156 | 0.69 | 0.384 |
|   |  | OpenBrowser Flash | ✅ | 3.5/3.5 | 199 | 0.60 | 0.134 |
| 6 | DataFlow Visual Challenge | Browser Relay | ❌ | 2.0/3.0 | 414 | 0.00 | - |
|   |  | OpenBrowser Plus | ✅ | 3.0/3.0 | 615 | 0.00 | 1.417 |
|   |  | OpenBrowser Flash | ✅* | 3.0/3.0 | 432 | 0.00 | 0.365* |
| 7 | GBR Detailed Search | Browser Relay | ✅ | 6.0/7.0 | 585 | 0.02 | - |
|   |  | OpenBrowser Plus | ✅ | 6.0/7.0 | 286 | 0.52 | 0.625 |
|   |  | OpenBrowser Flash | ✅* | 6.0/7.0 | 637 | 0.00 | 0.494* |

*Flash Test 6, 7 are retry results; initial attempt failed

---

## 4. Context Consumption

### 4.1 Control Window Context Usage

| Tool | Context Used | Context Capacity | Usage Rate |
|------|--------------|------------------|------------|
| Browser Relay | 1,300k tokens | 203k tokens | **640%** |
| OpenBrowser Plus | 42k tokens | 203k tokens | 21% |
| OpenBrowser Flash | 25k tokens | 203k tokens | 12% |

**Note:** Browser Relay context accumulated beyond capacity limit during testing, reaching 640% at test completion. OpenBrowser maintains context isolation—the control window only stores task descriptions and result summaries.

### 4.2 OpenBrowser Agent Token Consumption

| Tool | Prompt Tokens | Completion Tokens | Total Tokens |
|------|---------------|-------------------|--------------|
| OpenBrowser Plus | 4,968,714 | 13,122 | 4,982,094 |
| OpenBrowser Flash | ~3,851,594* | - | - |

*Flash only counts 5 initially successful tests

---

## 5. Cost Breakdown

### 5.1 OpenBrowser Costs

| # | Test Name | Plus(¥) | Flash Initial(¥) | Flash Retry(¥) |
|---|-----------|---------|------------------|----------------|
| 1 | CloudStack DAS Interactive | 0.531 | 0.180 | - |
| 2 | GBR Search | 0.197 | 0.072 | - |
| 3 | TechForum Comment Reply | 0.799 | 0.376 | - |
| 4 | TechForum Upvote | 0.090 | 0.028 | - |
| 5 | CloudStack DAS Agent | 0.384 | 0.134 | - |
| 6 | DataFlow Visual Challenge | 1.417 | timeout | 0.365 |
| 7 | GBR Detailed Search | 0.625 | failed | 0.494 |
| **Total** | | **4.04** | **0.79** | **1.65** |

### 5.2 Cost Comparison

| Tool | Avg. Cost per Task | Total Cost (7 tasks) |
|------|--------------------|-----------------------|
| Browser Relay | N/A | N/A* |
| OpenBrowser Plus | ¥0.58 | ¥4.04 |
| OpenBrowser Flash | ¥0.24 | ¥1.65 |

*Browser Relay cost included in OpenClaw subscription, no separate billing

---

## 6. Efficiency Analysis

### 6.1 Execution Time by Difficulty

| Difficulty | Browser Relay | OpenBrowser Plus | OpenBrowser Flash |
|------------|---------------|------------------|-------------------|
| Easy (Test 2, 4) | 58s | 70s | 103s |
| Medium (Test 1, 7) | 361s | 267s | 493s* |
| Hard (Test 3, 5, 6) | 213s | 343s | 355s* |

*Flash includes retry data

### 6.2 Efficiency Score Comparison

Efficiency Score = max(0, 1 - actual_time / time_limit)

| # | Test Name | Browser Relay | Plus | Flash |
|---|-----------|---------------|------|-------|
| 1 | CloudStack DAS Interactive | 0.80 | 0.65 | 0.50 |
| 2 | GBR Search | 0.83 | 0.78 | 0.66 |
| 3 | TechForum Comment Reply | 0.74 | 0.49 | 0.13 |
| 4 | TechForum Upvote | 0.83 | 0.82 | 0.77 |
| 5 | CloudStack DAS Agent | 0.81 | 0.69 | 0.60 |
| 6 | DataFlow Visual Challenge | 0.00 | 0.00 | 0.00 |
| 7 | GBR Detailed Search | 0.02 | 0.52 | 0.00 |

---

## 7. Failure Analysis

### 7.1 Failed Test Cases

| Tool | Failed Test | Failure Reason |
|------|-------------|----------------|
| Browser Relay | Test 6 | Score 2.0/3.0, incomplete steps |
| OpenBrowser Flash (initial) | Test 6 | Execution timeout, process terminated |
| OpenBrowser Flash (initial) | Test 7 | Score 2.0/7.0, partial completion |

### 7.2 Complex Task Performance

Test 6 (DataFlow Visual Challenge) is the most complex test with 3 sequential steps:

| Tool | Initial Result | Steps Completed |
|------|----------------|-----------------|
| Browser Relay | ❌ 2.0/3.0 | 2/3 |
| OpenBrowser Plus | ✅ 3.0/3.0 | 3/3 |
| OpenBrowser Flash (initial) | ❌ timeout | - |
| OpenBrowser Flash (retry) | ✅ 3.0/3.0 | 3/3 |

---

## 8. Summary

### 8.1 Data Summary

| Metric | Browser Relay | OpenBrowser Plus | OpenBrowser Flash |
|--------|---------------|------------------|-------------------|
| Pass Rate | 85.7% | 100% | 100%* |
| Avg. Execution Time | 211s | 274s | 317s |
| Avg. Efficiency Score | 0.58 | 0.56 | 0.48 |
| OpenBrowser Cost | - | ¥4.04 | ¥1.65 |
| Control Window Context | 640% | 21% | 12% |
| Complex Task First-Attempt Pass | 0/1 | 1/1 | 0/1 |

*Flash includes retry

### 8.2 Architecture Comparison

| Dimension | Browser Relay | OpenBrowser |
|-----------|---------------|-------------|
| Browser State Storage | Control window context | Independent agent |
| Context Isolation | No | Yes |
| Model Specialization | Single model | Control model + execution model |

---

**Report Generated:** 2026-03-17

---

## Appendix: Raw Data

### A. Browser Relay Test Data

```
Test Date: 2026-03-16
Control Model: bailian/glm-5
Context Peak: 1.3M tokens / 203k capacity (640%)
Session End Context: 92k / 203k (45%)
```

### B. OpenBrowser Plus Test Data

```
Test Date: 2026-03-16
Control Model: bailian/glm-5
Execution Model: dashscope/qwen3.5-plus
Control Window Context: 42k / 203k (21%)
OpenBrowser Prompt Tokens: 4,968,714
OpenBrowser Completion Tokens: 13,122
Total Cost: ¥4.04
```

### C. OpenBrowser Flash Test Data

```
Test Date: 2026-03-16
Control Model: bailian/glm-5
Execution Model: dashscope/qwen3.5-flash
Control Window Context: 25k / 203k (12%)
Initial Test Cost: ¥0.79
Retry Cost: ¥0.86
Total Cost: ¥1.65
```