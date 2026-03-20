# OpenBrowser

**OpenBrowser** is a visual AI assistant powered by **Qwen3.5-Plus** (primary) with **Qwen3.5-Flash** support as a cost-effective alternative, designed for **browser automation** and **web interaction**. By combining AI-powered visual perception with direct browser control, OpenBrowser enables sophisticated web automation, data extraction, and interactive workflows.

> **Note**: OpenBrowser currently supports **Chrome only** (via Chrome extension) and has been tested primarily with **Qwen3.5-Plus**, with **Qwen3.5-Flash** as a supported cost-effective option. Other models are not officially supported.

## Demo

### AI-Powered News Collection from WSJ, CNN, and Reuters

OpenBrowser autonomously browses major news websites (WSJ, CNN, Reuters) to collect, summarize, and translate breaking news about the Iran conflict.

![News Collection Demo](demo/news_collection-preview.gif)

[📺 Watch full video: news_collection.mp4](demo/news_collection.mp4)

#### Collected Articles

OpenBrowser collected the following articles and saved them as markdown files:

- **[伊朗战争新闻汇总_2026-03-08.md](demo/伊朗战争新闻汇总_2026-03-08.md)** - Summary of all collected news with translations
- **[WSJ_伊朗历史首都成为美以空战震中.md](demo/WSJ_伊朗历史首都成为美以空战震中.md)** - WSJ report on Isfahan air strikes
- **[WSJ_特朗普不排除向伊朗派遣地面部队_实时更新.md](demo/WSJ_特朗普不排除向伊朗派遣地面部队_实时更新.md)** - WSJ live updates on Trump's Iran policy
- **[CNN_伊朗战争实时更新_能源设施袭击.md](demo/CNN_伊朗战争实时更新_能源设施袭击.md)** - CNN live coverage of energy facility attacks

### AI-Powered Apartment Hunting on Xiaohongshu

OpenBrowser searches for rental listings on Xiaohongshu (Little Red Book), automatically liking, saving, and commenting on posts to inquire about details. It also evaluates furniture and decor quality through visual analysis.

![Xiaohongshu Apartment Hunting Demo](demo/apartment_hunting-preview.gif)

[📺 Watch full video: apartment_hunting.mp4](demo/apartment_hunting.mp4)

#### Key Features Demonstrated

- **Autonomous Search**: Navigate and search on Xiaohongshu for rental listings
- **Social Interactions**: Like, save, and comment on posts to contact landlords
- **Visual Analysis**: Evaluate furniture quality and interior design through screenshots
- **Multi-step Workflow**: Complete end-to-end apartment hunting process

## Quick Start

### Try OpenBrowser with your browser

#### 1. Install Python Dependencies

```bash
# Using uv (recommended)
uv sync

# Or using pip
pip install -e .

# For development (includes dev dependencies like pytest, black, ruff)
uv sync --group dev
# Or with pip
pip install -e ".[dev]"
```

#### 2. Start the Server

```bash
uv run local-chrome-server serve
```

The server will start at `http://127.0.0.1:8765` (HTTP) and `ws://127.0.0.1:8766` (WebSocket).

#### 3. Configure LLM Settings

On first access, you'll be prompted to configure your LLM settings through the web interface:

1. Open `http://localhost:8765` in your browser
2. You'll see the **Configuration Page**
3. Fill in your API details:
   - **Model**: Default is `dashscope/qwen3.5-plus` (also supports `dashscope/qwen3.5-flash` as a cost-effective alternative)
   - **Base URL**: Default is `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - **API Key**: Your API key (required)
4. Optionally configure the **Default Working Directory** (CWD)
5. Click **Save** and then **Continue to Main Interface**

> **Note**: 
> - Configuration is stored in `~/.openbrowser/llm_config.json`
> - You can modify settings anytime by clicking the **⚙️ Settings** button in the status bar
> - Environment variables (LLM_API_KEY, LLM_MODEL, LLM_BASE_URL) are **no longer supported** - please use the web UI configuration

#### 4. Build the Chrome Extension

```bash
cd extension
npm install
npm run build
```

#### 5. Install the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/dist` directory

After installation, OpenBrowser will open a browser-internal page that shows this browser's UUID.
This UUID is the permission key for controlling that specific browser instance.

Important:
- Anyone who has this UUID can operate that browser through OpenBrowser
- Do not share it casually
- Clicking the extension icon will reopen the UUID page later

#### 6. Configure Chrome Pop-up Settings (IMPORTANT)

By default, Chrome blocks pop-up windows, which can prevent OpenBrowser from opening new tabs when clicking links. You need to configure Chrome to allow pop-ups:

**Option A: Allow pop-ups for specific sites (Recommended)**

1. When a pop-up is blocked, you'll see a blocked pop-up icon (🚫) in the address bar
2. Click the icon and select "Always allow pop-ups and redirects from [site]"
3. Click **Done**

**Option B: Allow pop-ups globally**

1. Open Chrome Settings: `chrome://settings/content/popups`
2. Under "Default behavior", select **Sites can send pop-ups and use redirects**
3. Alternatively, add specific sites to the "Allowed to send pop-ups" section

> **Note**: If OpenBrowser clicks a link but no new tab opens, check the address bar for the blocked pop-up icon. This is a common issue for new users.

#### 7. Access the Web Frontend

Open your browser and visit:

```
http://localhost:8765
```

You can now interact with the AI Agent through the web interface.

Before sending commands:
1. Copy the browser UUID from the extension page
2. Paste it into the `BROWSER UUID` field in the frontend
3. Start chatting

The permission flow is:

1. The Chrome extension connects to the server through WebSocket
2. The server stores a `uuid -> websocket` mapping for that browser
3. The frontend session asks the user for the UUID
4. When the user sends a message, the frontend includes that UUID
5. The server uses the UUID to route browser commands to the correct extension connection

This means browser control is authorized by possession of the UUID capability token.

---

### Try OpenBrowser with SKILL - install to your local agents

Simply tell your agent to install `skill/codex/open-browser`

## Why Qwen3.5-Plus?

We chose Qwen3.5-Plus as our foundation model because it offers exceptional multimodal capabilities at a fraction of the cost of competitors. Its native agentic design makes it ideal for tasks that require both visual understanding and code execution.

**Key Advantages:**
- **Strong Multimodal Capabilities**: Native multimodal training enables deep understanding of both code and visual content
- **Cost-Effective**: Priced at approximately $0.688-$3.44 per 1M tokens, roughly 1/18 the cost of Gemini 3 Pro
- **Agentic Design**: Specifically optimized for autonomous agent workflows

### Qwen3.5-Flash as a Cost-Effective Alternative

For cost-sensitive use cases, OpenBrowser also supports **Qwen3.5-Flash**, a faster and more affordable model from the Qwen3.5 family. Our evaluation results (see `eval/evaluation_report.json`) show that Qwen3.5-Flash maintains good performance for browser automation tasks while significantly reducing costs. 

**When to choose Flash:**
- **Budget constraints**: Flash offers similar capabilities at lower cost
- **Simpler tasks**: For straightforward browser interactions and automation
- **Development/testing**: When iterating on automation scripts

**When to stick with Plus:**
- **Complex visual reasoning**: Tasks requiring detailed visual analysis
- **Multi-step planning**: Complex workflows with many decision points
- **Highest accuracy**: Mission-critical automation where precision is paramount

Learn more about Qwen3.5:

- [Qwen3.5: Towards Native Multimodal Agents (Official Blog)](https://qwen.ai/blog/qwen3.5)
- [Qwen3.5: Towards Native Multimodal Agents (Alibaba Cloud)](https://www.alibabacloud.com/blog/qwen3.5-towards-native-multimodal-agents)
- [Alibaba unveils Qwen3.5 as China's chatbot race shifts to AI agents (CNBC)](https://www.cnbc.com/2026/02/17/china-alibaba-qwen3.5-ai-agent.html)
- [Alibaba unveils new Qwen3.5 model for 'agentic AI era' (Reuters)](https://www.reuters.com/technology/alibaba-unveils-qwen3.5-agentic-ai)
- [QwenLM/Qwen3.5 (GitHub)](https://github.com/QwenLM/Qwen3.5)

## Evaluation

OpenBrowser has been extensively evaluated against real-world browser automation tasks. Our evaluation framework tests various scenarios from simple navigation to complex multi-step workflows.

### Key Findings

- **100% Pass Rate**: Both Qwen3.5-Plus and Qwen3.5-Flash achieved high pass rates across all 9 test cases
- **Cost Efficiency**: Qwen3.5-Flash offers similar performance at ~3x lower cost
- **Context Isolation**: Independent agent architecture uses only 12-21% of control window context vs 640% for monolithic approach

### Evaluation Results

| Metric | Qwen3.5-Plus | Qwen3.5-Flash |
|--------|--------------|---------------|
| Pass Rate | High (9 tests) | High (9 tests) |
| Avg. Duration | ~274s | ~317s |
| Avg. Cost | ¥0.58/task | ¥0.24/task |
| Context Usage | 21% | 12% |

### Test Cases

Our evaluation suite includes 9 test cases across 4 difficulty levels:
- **Easy**: GBR Search, Finviz Simple Screener
- **Medium**: TechForum Upvote, GBR Detailed Search & Read, Finviz Multi-Filter, DataFlow Visual Challenge
- **Hard**: CloudStack DAS Agent, TechForum Comment Reply
- **Very Hard**: CloudStack DAS Interactive

### Reports & Data

- **[Latest Evaluation Report](eval/evaluation_report.json)** - Full JSON report with per-test metrics
- **[OpenClaw vs OpenBrowser Comparison](eval/archived/2026-03-16/browser_agent_evaluation_2026-03-16_openclaw_vs_openbrowser.md)** - Architecture comparison and detailed analysis

### Run Your Own Evaluation

```bash
# List available tests
python eval/evaluate_browser_agent.py --list

# Set the browser capability token once
export OPENBROWSER_CHROME_UUID=YOUR_BROWSER_UUID

# Run all tests with both models
python eval/evaluate_browser_agent.py --model dashscope/qwen3.5-plus --model dashscope/qwen3.5-flash

# Or pass the browser UUID explicitly per run
python eval/evaluate_browser_agent.py --test techforum --chrome-uuid YOUR_BROWSER_UUID
```

See [AGENTS.md](AGENTS.md#evaluation-system) for evaluation framework documentation.

## The Vision

Traditional browser automation tools require manual scripting and fragile selectors. OpenBrowser reimagines browser automation with **AI-powered visual understanding** and **natural interaction**:

- **Visual Perception**: The AI sees web pages through screenshots, understanding UI elements visually
- **Natural Interaction**: Click, type, scroll, and navigate using human-like visual recognition
- **Adaptive Automation**: Handle dynamic websites, JavaScript-heavy applications, and complex workflows
- **Cost-Effective**: Choose between Qwen3.5-Plus for maximum capability or Qwen3.5-Flash for budget-friendly automation

OpenBrowser transforms browser automation from brittle scripts to intelligent, adaptive workflows that understand web pages the way humans do.

## Key Differentiators

### 1. AI-Powered Visual Browser Automation
Unlike traditional automation tools that rely on brittle CSS selectors, OpenBrowser uses **visual AI to understand and interact with web pages naturally**:
- **Visual Understanding**: The AI sees pages through screenshots, recognizing buttons, forms, and content visually
- **Natural Interaction**: Click, type, scroll, and navigate based on visual cues, not fragile selectors
- **Adaptive Workflows**: Handle dynamic content, JavaScript applications, and complex multi-step processes
- **Unified Control**: One AI model handles visual perception, decision-making, and browser interaction

This visual-first approach enables robust automation that works across websites without manual selector maintenance.

### 2. Chrome Extension Architecture
OpenBrowser operates as a **Chrome extension that controls your local browser**, providing unique advantages:
- **Use Your Identity**: The extension inherits your browser's cookies, sessions, and login states, allowing the AI to interact with websites as you
- **Bypass CAPTCHAs**: Since the AI uses your authenticated browser session, most CAPTCHA and verification challenges are avoided
- **Access Restricted Content**: Interact with internal tools, private dashboards, and authenticated services that require your credentials
- **Natural Browsing**: The AI operates within your existing browser environment, maintaining your bookmarks, extensions, and preferences

### 3. Optimized for Qwen3.5 Family
OpenBrowser is specifically designed for the **Qwen3.5 family**, primarily **Qwen3.5-Plus** with **Qwen3.5-Flash** as a cost-effective alternative, leveraging their unique strengths:
- **Native Multimodal Training**: Unlike models with bolted-on vision capabilities, Qwen3.5-Plus was trained from the ground up with multimodal understanding (Flash inherits these capabilities)
- **Cost-Effective at Scale**: At ~$0.688-$3.44 per 1M tokens for Plus (roughly 1/18 the cost of Gemini 3 Pro), and even lower costs for Flash, extensive browser automation becomes economically viable
- **Agentic Architecture**: Purpose-built for autonomous agent workflows requiring tool use, visual reasoning, and multi-step planning

## Key Features

- **Visual AI Automation**: See and interact with web pages using AI-powered visual recognition
- **Browser Control**: Click, type, scroll, and navigate through visual understanding and JavaScript execution
- **Tab Management**: Open, close, switch, and manage browser tabs with session isolation
- **Data Extraction**: Scrape and collect data from websites with AI understanding of page structure
- **Form Filling & Submission**: Automatically fill forms, submit data, and handle multi-step workflows
- **Session Persistence**: Maintain browser sessions, cookies, and login states across automation tasks
- **Multi-Interface Access**: REST API, WebSocket, and CLI for programmatic control

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Qwen3.5 Family (Multimodal LLM)                │
│        Qwen3.5-Plus (primary) / Qwen3.5-Flash (cost-effective)
│         Visual Perception │ Decision Making │ Browser Control │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              OpenBrowser Agent Server (FastAPI)             │
│         REST API │ WebSocket │ Session Management │ Tool Orchestration
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Chrome Extension (Chrome DevTools)             │
│         Screenshots │ JavaScript Execution │ Tab Management │
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

LGPL-3.0

## Acknowledgments

This project is built upon the [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk), which provides the foundation for our agent architecture and tool integration. We gratefully acknowledge the OpenHands team's contributions to the open-source community.

Special thanks to:
- **OpenHands Team** - For the excellent SDK that powers our agent system
- **Qwen Team (Alibaba)** - For the powerful Qwen3.5-Plus multimodal model
