---
name: open-browser
description: This skill should be used when the user asks to "automate browser", "control Chrome", "browse website with AI", "use OpenBrowser", "run browser automation", or mentions web scraping, form filling, UI testing, or any task requiring visual browser interaction. Delegates browser automation tasks to OpenBrowser Agent.
---

# OpenBrowser Skill

Delegate browser automation to OpenBrowser Agent for visual browser control.

> **⚠️ Important**: Browser automation tasks are typically long-running. Always use a subagent to execute these tasks in the background while keeping the main conversation responsive.

## Quick Start

### 1. Check Prerequisites

```bash
python3 scripts/check_status.py
```

Expected output:
```
✅ Server: Running
✅ Extension: Connected (1 connection(s))
✅ LLM Config: dashscope/qwen3.5-plus
🎉 OpenBrowser is ready to use!
```

If not ready, see [First-Time Setup](#first-time-setup) below.

### 2. Submit Task

Use the task submission script:

```bash
# Submit task with real-time output
python3 scripts/send_task.py "Go to example.com and extract the title"

# For long-running tasks, run in background
python3 scripts/send_task.py "Scrape news from HN" --background --output task.log

# Check server status only
python3 scripts/send_task.py --check
```

### 3. Monitor Progress

For background tasks

```bash
# Monitor task output
tail -f task.log

# Check conversation status via API
curl http://localhost:8765/agent/conversations/{conversation_id}
```

---

## First-Time Setup

Before using OpenBrowser, you must complete three setup steps. This section guides you through the entire process.

### Setup Checklist

| Check | How to Verify | Expected Result |
|-------|---------------|-----------------|
| Server Running | `curl http://localhost:8765/health` | `{"status": "healthy"}` |
| Extension Connected | Visit http://localhost:8765/api | `websocket_connected: true` |
| API Key Configured | Visit http://localhost:8765 → Settings | `has_api_key: true` |

### Step 1: Install and Start Server

```bash
cd /path/to/OpenBrowser
uv sync
uv run local-chrome-server serve
```

Server runs at http://127.0.0.1:8765

**Important:** Check status first before assuming the server needs to be started:
```bash
python3 scripts/check_status.py
```

### Step 2: Configure LLM API Key (REQUIRED)

OpenBrowser requires a DashScope API key from Alibaba Cloud.

#### Getting Your DashScope API Key

1. **Visit** https://dashscope.aliyun.com/
2. **Sign in** with your Alibaba Cloud account (create one if needed)
3. **Navigate** to API Key Management (API-KEY管理)
4. **Create** a new API Key
5. **Copy** the API Key (starts with `sk-`)

#### Configuring in OpenBrowser

1. Open http://localhost:8765 in Chrome
2. Click the **⚙️ Settings** button in the status bar
3. Fill in:
   - **Model**: Choose from the options below (see [Model Selection Guide](#model-selection-guide))
   - **Base URL**: `https://dashscope.aliyuncs.com/compatible-mode/v1` (default)
   - **API Key**: Paste your API key
4. Click **Save**

#### Verify Configuration

```bash
python3 scripts/check_status.py
# Should show: ✅ LLM Config: dashscope/qwen3.5-plus (or dashscope/qwen3.5-flash)
```

**Note:** The LLM API key is stored locally in `~/.openbrowser/llm_config.json`.

### Step 3: Install Chrome Extension (REQUIRED)

#### Build the Extension

```bash
cd /path/to/OpenBrowser/extension
npm install
npm run build
```

#### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder
5. Verify the extension appears in the list

#### Verify Extension Connection

```bash
python3 scripts/check_status.py
# Should show: ✅ Extension: Connected
```

### Step 4: Configure Chrome Pop-up Settings (CRITICAL)

**⚠️ IMPORTANT: Chrome blocks pop-up windows by default, which prevents OpenBrowser from opening new tabs when clicking links.**

**Option A: Allow pop-ups for specific sites (Recommended)**
1. When a pop-up is blocked, a blocked pop-up icon (🚫) appears in the address bar
2. Click the icon and select "Always allow pop-ups and redirects from [site]"
3. Click **Done**

**Option B: Allow pop-ups globally**
1. Navigate to `chrome://settings/content/popups`
2. Under "Default behavior", select **Sites can send pop-ups and use redirects**

**Common symptom**: User reports that OpenBrowser clicks a link but no new tab opens. This indicates pop-ups are blocked. Check the address bar for the blocked pop-up icon.

---

## Model Selection Guide

OpenBrowser supports two models from the Qwen3.5 family. Choose based on your task requirements and budget.

### Quick Comparison

| Model | Best For | Cost per Task | Speed |
|-------|----------|---------------|-------|
| **dashscope/qwen3.5-plus** | Complex tasks, mission-critical automation | ~¥0.48 | Faster |
| **dashscope/qwen3.5-flash** | Simple tasks, cost-sensitive scenarios | ~¥0.13 | Slightly slower |

### Detailed Evaluation Results

Based on comprehensive testing (see `eval/evaluation_report.json`):

| Metric | Qwen3.5-Plus | Qwen3.5-Flash | Difference |
|--------|--------------|---------------|------------|
| **Pass Rate** | 100% | 100% | Same |
| **Task Score** | 32.0/33.5 | 31.0/33.5 | Plus +1 |
| **Avg Duration** | 127.6s | 140.7s | Plus 9% faster |
| **Avg Cost** | ¥0.479 | ¥0.133 | Flash 72% cheaper |
| **Efficiency Score** | 4.57 | 4.39 | Plus slightly higher |
| **Usage Score** | 3.55 | 5.31 | Flash much better |

### When to Choose Qwen3.5-Plus

- ✅ Complex multi-step workflows
- ✅ Visual reasoning intensive tasks
- ✅ Mission-critical automation where reliability is paramount
- ✅ When speed matters more than cost

### When to Choose Qwen3.5-Flash

- ✅ Simple navigation and scraping tasks
- ✅ High-volume repetitive operations
- ✅ Budget-constrained scenarios
- ✅ Development and testing workflows

### Cost Savings Example

For 100 typical browser automation tasks:
- **Plus**: ~¥48 total
- **Flash**: ~¥13 total
- **Savings**: ¥35 (73% reduction)

---

## First-Time User Interaction Flow

When a user requests browser automation for the first time, follow this interaction flow:

### Scenario A: Everything Ready

```
AI: Checking OpenBrowser status...
    
✅ Server: Running
✅ Extension: Connected
✅ LLM Config: dashscope/qwen3.5-plus

OpenBrowser is ready! What would you like me to do?
```

### Scenario B: API Key Not Configured

```
AI: Checking OpenBrowser status...
    
✅ Server: Running
✅ Extension: Connected
❌ LLM Config: API key not configured

OpenBrowser needs an API key to function. Here's how to set it up:

1. Get your DashScope API key:
   - Visit https://dashscope.aliyun.com/
   - Sign in with Alibaba Cloud
   - Go to API Key Management
   - Create and copy your API key

2. Configure in OpenBrowser:
   - Open http://localhost:8765
   - Click ⚙️ Settings
   - Paste your API key
   - Select a model (Plus for complex tasks, Flash for cost savings)
   - Click Save

Please let me know once you've configured the API key.
```

### Scenario C: Extension Not Connected

```
AI: Checking OpenBrowser status...
    
✅ Server: Running
❌ Extension: Not connected
✅ LLM Config: dashscope/qwen3.5-plus

The Chrome extension is not connected. Please:

1. Build the extension:
   cd /path/to/OpenBrowser/extension
   npm install && npm run build

2. Load in Chrome:
   - Open chrome://extensions/
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked"
   - Select the extension/dist folder

Let me know when the extension is loaded.
```

### Scenario D: Model Selection Prompt

```
AI: OpenBrowser is configured with dashscope/qwen3.5-plus.

📊 Model options based on your needs:

┌─────────────────────────────────────────────────────────────┐
│ 🟢 dashscope/qwen3.5-plus (current)                         │
│    • Best for complex tasks                                  │
│    • Faster average completion                               │
│    • Cost: ~¥0.48 per task                                   │
├─────────────────────────────────────────────────────────────┤
│ 🟡 dashscope/qwen3.5-flash                                   │
│    • Best for cost savings (72% cheaper)                     │
│    • Same pass rate (100%)                                   │
│    • Cost: ~¥0.13 per task                                   │
└─────────────────────────────────────────────────────────────┘

Would you like to keep the current model or switch to Flash for cost savings?
```

---

## Important Notes

- **Long-running tasks can take minutes** - Always run in background
- **Extension must stay loaded in Chrome** - Browser automation won't work if extension is disabled
- **Visual-based automation** - OpenBrowser sees pages via screenshots
- **Uses your browser session** - Leverages existing logins/cookies

---

## Troubleshooting

### Pop-ups Blocked - Links Don't Open New Tabs

**Symptom**: OpenBrowser clicks a link but no new tab opens.

**Cause**: Chrome blocks pop-up windows by default.

**Solution**:
1. Check the address bar for a blocked pop-up icon (🚫)
2. Click the icon and select "Always allow pop-ups and redirects from [site]"
3. Or configure globally at `chrome://settings/content/popups`

### Extension Not Connected (`websocket_connected: false`)

1. Verify extension is loaded in `chrome://extensions/`
2. Click the refresh icon on the extension
3. Check Chrome console for errors (F12 → Console tab)
4. Restart server

### API Key Not Configured (`has_api_key: false`)

1. Configure via web UI at http://localhost:8765
2. Check config file: `cat ~/.openbrowser/llm_config.json`
3. Ensure the API key starts with `sk-` and is not empty

### Task Not Progressing

1. Check conversation status API
2. View browser window - may be waiting for dialogs
3. Check for dialog prompts (confirm/alert)
4. Restart with new conversation

---

## Additional Resources

### Reference Documentation
- `references/api_reference.md` - Complete REST API documentation

### Utility Scripts
- `scripts/check_status.py` - Verify OpenBrowser readiness
- `scripts/send_task.py` - Submit automation tasks

### Architecture
```
AI Assistant → REST API → OpenBrowser Agent → Chrome Extension
                                     ↓
                              Qwen3.5 (Visual Understanding)
```