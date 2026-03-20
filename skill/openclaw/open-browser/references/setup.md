# Setup Guide

Detailed installation and configuration for OpenBrowser.

## Prerequisites

- **Python 3.10+** with [uv](https://docs.astral.sh/uv/)
- **Node.js 18+** (for Chrome extension)
- **Chrome browser**
- **DashScope API key** - requires Alibaba Cloud account

---

## Part 1: Automated Setup

OpenClaw can execute these steps for you:

```bash
# Clone and install
git clone https://github.com/softpudding/OpenBrowser.git ~/git/OpenBrowser
cd ~/git/OpenBrowser && uv sync

# Build extension
cd extension && npm install && npm run build && cd ..

# Start server
uv run local-chrome-server serve
```

---

## Part 2: Manual Steps 👤

You must do these steps manually:

### Step 1: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select `~/git/OpenBrowser/extension/dist`
5. Verify extension appears in list

### Step 2: Copy Browser UUID

1. After the extension loads, it opens the UUID page automatically
2. Copy the UUID shown on that page
3. Keep it secure; this UUID is the permission key for controlling this browser
4. You can reopen the page later by clicking the extension icon
### Step 3: Get DashScope API Key

1. Go to https://dashscope.aliyun.com/
2. Sign in with Alibaba Cloud (create account if needed)
3. Navigate to **API Key Management** (API密钥管理)
4. Click **Create API Key** (创建 API Key)
5. Copy the key (starts with `sk-`)

### Step 4: Configure API Key

1. Open http://localhost:8765 in Chrome
2. Click **⚙️ Settings**
3. Select model: `dashscope/qwen3.5-flash` (recommended)
4. Paste API key
5. Click **Save**

---

## Verify

```bash
export OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID
python3 skill/openclaw/open-browser/scripts/check_status.py --chrome-uuid YOUR_BROWSER_UUID
```

Expected:
```
✅ Server: Running
✅ Extension: Connected
✅ LLM Config: dashscope/qwen3.5-flash
✅ Browser UUID: Valid and registered
🎉 OpenBrowser is ready to use!
```

---

## Additional Settings

### Allow Pop-ups (when needed)

If links don't open new tabs:
1. Click 🚫 in address bar
2. Select "Always allow pop-ups from [site]"

## Files

- **LLM config**: `~/.openbrowser/llm_config.json`
- **Server logs**: `~/git/OpenBrowser/chrome_server.log`
