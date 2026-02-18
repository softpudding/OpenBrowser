# OpenBrowser

**OpenBrowser** is a visual AI assistant powered by **Qwen3.5-Plus** that bridges the gap between frontend and backend development. By combining coding capabilities with visual browser perception, OpenBrowser enables seamless full-stack debugging and automation.

> **Note**: OpenBrowser currently supports **Chrome only** (via Chrome extension) and has been tested exclusively with **Qwen3.5-Plus**. Other models are not officially supported.
>
> **Limitation**: OpenBrowser currently supports **single-session only**. All operations share a global conversation context; multi-session management is not yet implemented.

## Why Qwen3.5-Plus?

We chose Qwen3.5-Plus as our foundation model because it offers exceptional multimodal capabilities at a fraction of the cost of competitors. Its native agentic design makes it ideal for tasks that require both visual understanding and code execution.

Learn more about Qwen3.5:

- [Qwen3.5: Towards Native Multimodal Agents (Official Blog)](https://qwen.ai/blog/qwen3.5)
- [Qwen3.5: Towards Native Multimodal Agents (Alibaba Cloud)](https://www.alibabacloud.com/blog/qwen3.5-towards-native-multimodal-agents)
- [Alibaba unveils Qwen3.5 as China's chatbot race shifts to AI agents (CNBC)](https://www.cnbc.com/2026/02/17/china-alibaba-qwen3.5-ai-agent.html)
- [Alibaba unveils new Qwen3.5 model for 'agentic AI era' (Reuters)](https://www.reuters.com/technology/alibaba-unveils-qwen3.5-agentic-ai)
- [QwenLM/Qwen3.5 (GitHub)](https://github.com/QwenLM/Qwen3.5)

## The Vision

Modern development workflows often require switching between:
- Writing code
- Inspecting browser state visually
- Interacting with web UIs
- Running terminal commands

OpenBrowser unifies these tasks into a **single-model closed loop**. Qwen3.5-Plus handles everything—code generation, visual perception, browser control, and bash execution—enabling the AI assistant to truly understand and debug full-stack applications end-to-end.

## Key Features

- **Single-Model Automation**: One model for coding, visual observation, browser interaction, and terminal commands
- **Visual Browser Control**: Real-time screenshots with intelligent element detection (clickable elements in blue, text inputs in green)
- **Full Browser API**: Mouse, keyboard, scrolling, and tab management with session isolation
- **Terminal Integration**: Execute bash commands for backend operations
- **Multiple Interfaces**: REST API and WebSocket

## Quick Start

### 1. Set Environment Variables

Configure the LLM connection. Note that `LLM_BASE_URL` must be an **OpenAI-compatible API endpoint**:

```bash
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"  # OpenAI-compatible URL
export LLM_MODEL="qwen3.5-plus"
```

### 2. Install Python Dependencies

```bash
# Using uv (recommended)
uv sync

# Or using pip
pip install -e .
```

### 3. Start the Server

```bash
local-chrome-server serve
```

The server will start at `http://127.0.0.1:8765` (HTTP) and `ws://127.0.0.1:8766` (WebSocket).

### 4. Build the Chrome Extension

```bash
cd extension
npm install
npm run build
```

### 5. Install the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/dist` directory

### 6. Access the Web Frontend

Open your browser and visit:

```
http://localhost:8765
```

You can now interact with the AI Agent through the web interface.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Qwen3.5-Plus (Multimodal LLM)            │
│         Code │ Visual │ Tool Orchestration │ Bash          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              OpenBrowser Agent Server (FastAPI)             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Chrome Extension (Chrome DevTools)             │
│         Screenshots │ Mouse/Keyboard │ Tab Management       │
└─────────────────────────────────────────────────────────────┘
```

## Development

### Build Commands

```bash
# Extension development build with watch
cd extension
npm run dev

# TypeScript type checking
npm run typecheck

# Run tests
pytest
```

### Project Structure

```
.
├── server/              # FastAPI server and agent logic
│   ├── agent/          # Agent orchestration
│   ├── api/            # REST endpoints
│   ├── core/           # Core processing logic
│   └── websocket/      # WebSocket server
├── extension/          # Chrome extension (TypeScript)
│   ├── src/
│   │   ├── background/ # Background script with CDP
│   │   ├── commands/   # Browser automation commands
│   │   └── content/    # Content script for visual feedback
│   └── dist/           # Built extension
└── frontend/           # Web UI
```

## License

MIT