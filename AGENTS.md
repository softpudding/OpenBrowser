# OpenBrowser Project Knowledge Base

**Generated:** 2026-02-27
**Commit:** 8836b0b (main)
**Stack:** Python 3.12+ (FastAPI) + TypeScript (Chrome Extension MV3)

## OVERVIEW

Visual AI assistant powered by Qwen3.5-Plus for browser automation with visual feedback. Single-model closed loop: code generation → visual verification → browser control → terminal execution.

## STRUCTURE

```
OpenBrowser/
├── server/           # FastAPI backend + agent logic + WebSocket
│   ├── prompts/      # Jinja2 templates for agent prompts (new)
│   ├── agent/        # Agent orchestration and tool definitions
│   └── ...
├── extension/        # Chrome extension (MV3) for browser control
├── cli/              # Command-line tool (chrome-cli)
├── frontend/         # Static web UI (HTML)
└── reference/        # External SDK references (read-only)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Agent orchestration | `server/agent/manager.py` | Conversation lifecycle, LLM config |
| Browser commands | `server/core/processor.py` | Command routing, multi-session |
| Dialog handling | `server/models/commands.py` | HandleDialogCommand, DialogAction |
| REST API routes | `server/api/routes/` | FastAPI endpoints |
| WebSocket handling | `server/websocket/manager.py` | Extension communication |
| Command models | `server/models/commands.py` | Pydantic command/response types |
| **Prompt templates** | `server/prompts/` | **Jinja2 templates for agent prompts** |
| Tab tool | `server/agent/tools/tab_tool.py` | TabTool for tab management |
| Highlight tool | `server/agent/tools/highlight_tool.py` | HighlightTool for element discovery |
| Element interaction | `server/agent/tools/element_interaction_tool.py` | ElementInteractionTool with 2PC flow |
| Dialog tool | `server/agent/tools/dialog_tool.py` | DialogTool for dialog handling |
| JavaScript tool | `server/agent/tools/javascript_tool.py` | JavaScriptTool for fallback execution |
| ToolSet aggregator | `server/agent/tools/toolset.py` | OpenBrowserToolSet aggregates all 5 tools |
| Deprecated tool | `server/agent/tools/open_browser_tool.py` | OpenBrowserTool (monolithic, deprecated) |
| Extension entry | `extension/src/background/index.ts` | Command handler, dialog processing |
| Dialog manager | `extension/src/commands/dialog.ts` | CDP dialog events, cascading |
| JavaScript execution | `extension/src/commands/javascript.ts` | CDP Runtime.evaluate, dialog race |
| Screenshot capture | `extension/src/commands/screenshot.ts` | CDP Page.captureScreenshot |
| Tab management | `extension/src/commands/tab-manager.ts` | Session isolation, tab groups |
| CLI implementation | `cli/main.py` | Interactive mode, shortcuts |
## ARCHITECTURE

```
┌─────────────────────────────────────────┐
│     Qwen3.5-Plus (Multimodal LLM)       │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   OpenBrowser Agent Server (FastAPI)    │
│   - REST API (port 8765)                │
│   - WebSocket (port 8766)               │
│   - OpenHands SDK integration           │
│   - handle_dialog action                │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Chrome Extension (CDP)                │
│   - JavaScript execution (with race)    │
│   - Dialog detection & handling         │
│   - Screenshots (1280x720)              │
│   - Tab management with groups          │
└─────────────────────────────────────────┘
```

## DIALOG HANDLING

When JavaScript triggers a dialog (alert/confirm/prompt), the browser pauses.
OpenBrowser uses Promise.race to detect dialogs gracefully.

### Flow
```
1. javascript_execute runs
2. Promise.race([
     jsExecution,    // Runtime.evaluate
     dialogEvent,    // Page.javascriptDialogOpening
     timeout         // User timeout
   ])
3. If dialog opens:
   - Alert → Auto-accept
   - Confirm/Prompt → Return dialog info
4. AI calls handle_dialog(accept/dismiss)
5. Extension handles, checks cascade
```

### Dialog Types
| Type | Needs Decision | AI Action |
|------|----------------|----------|
| alert | No | Auto-accepted |
| confirm | Yes | handle_dialog(accept/dismiss) |
| prompt | Yes | handle_dialog(accept, text) |
| beforeunload | Yes | handle_dialog(accept/dismiss) |

### Cascading Dialogs
Dialog → Dialog → Dialog chain supported. After handling one dialog,
the system checks for new dialogs within 150ms.

### Element Actions Dialog Handling
When JavaScript execution triggers a dialog during element actions (click, hover, scroll, keyboard input), the `executeJavaScript` function returns a result with `dialog_opened: true` but no `result` field. Element action functions (`performElementClick`, `performElementHover`, etc.) must check for `jsResult.dialog_opened` before checking `jsResult.result?.value`. If a dialog opened, treat the action as successful (clicked/hovered/scrolled/input = true) and propagate dialog info to the screenshot handler. This prevents false "Invalid JavaScript result.value structure" errors.

## CONVENTIONS

### Python (server/)
- **Line length:** 88 (black/ruff)
- **Target:** Python 3.12
- **Strict typing:** `disallow_untyped_defs = true` in mypy
- **Imports:** isort via ruff

### TypeScript (extension/)
- **Target:** ES2022
- **Module:** ESNext with bundler resolution
- **Strict mode:** enabled
- **Path alias:** `@/*` → `src/*`
- **Build:** Vite with multi-entry (background, content, workers)

## PROMPT MANAGEMENT

OpenBrowser uses Jinja2 templates for agent prompts, enabling dynamic content injection based on configuration.

### Template Structure
- **Location**: `server/prompts/` directory
- **Format**: `.j2` extension with Jinja2 syntax
- **5 Tool Templates**: Each of the 5 focused tools has its own template:
  - `tab_tool.j2` - Tab management documentation
  - `highlight_tool.j2` - Element discovery with color coding
  - `element_interaction_tool.j2` - 2PC flow with orange confirmations
  - `dialog_tool.j2` - Dialog handling
  - `javascript_tool.j2` - JavaScript fallback
- **Legacy**: `open_browser_description.j2` - original monolithic tool description (retained for reference)

### Dynamic JavaScript Control
The `javascript_execute` command can be disabled via environment variable:
```bash
export OPEN_BROWSER_DISABLE_JAVASCRIPT_EXECUTE=1
```
When disabled:
- Template removes all `javascript_execute` references using `{% if not disable_javascript %}` conditionals
- `OpenBrowserAction.type` description excludes `'javascript_execute'`
- Command execution returns error if attempted

### Template Features
- **Conditional rendering**: Use `{% if %}` blocks for configurable sections
- **Variable injection**: Pass context variables like `disable_javascript` at render time
- **Clean output**: `trim_blocks=True` and `lstrip_blocks=True` remove extra whitespace
- **Caching**: Templates are cached after first load for performance

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER use pixel-based mouse/keyboard simulation** - All operations via JavaScript execution
- **NEVER skip conversation_id** - Required for multi-session isolation
- **NEVER return DOM nodes from JavaScript** - Must be JSON-serializable
- **NEVER use `.click()` for React/Vue** - Dispatch full event sequence instead
- **NEVER suppress type errors** - `as any`, `@ts-ignore` forbidden
- **NEVER ignore dialog_opened** - AI must handle dialogs before continuing
## VISUAL INTERACTION WORKFLOW

OpenBrowser uses a visual-first approach where the AI sees elements before interacting:

### Workflow
```
1. highlight_elements(page=1) → Returns collision-free elements with IDs
2. screenshot → AI sees numbered overlays on elements (no overlap)
3. click_element(id="click-3") → Interact with specific element
4. highlight_elements(page=2) → Get next batch of non-colliding elements
```

### Collision-Aware Pagination (Single-Type Design)
Elements are paginated to ensure **no visual overlap** in each screenshot:
- **One element type per call** for stable, predictable pagination
- Each page returns a maximal set of non-colliding elements
- Collision detection includes label area (26px above element)
- AI calls `page=1, page=2, page=3...` to see all elements of that type
- No offset/limit - pages are determined by collision geometry

```
# Highlight clickable elements (default)
highlight_elements()                  → Page 1 of clickable elements
highlight_elements(page=2)             → Page 2 of clickable elements

# Highlight other types (one at a time)
highlight_elements(element_type="inputable")   → Input fields
highlight_elements(element_type="scrollable")  → Scrollable areas
highlight_elements(element_type="hoverable")   → Hoverable elements
```

### Element ID Format
Elements are identified by a 6-character hash string:
- Format: `[a-z0-9]{6}` (e.g., "a3f2b1", "9z8x7c")
- Algorithm: FNV-1a hash of CSS selector, encoded in base36
- Deterministic: Same element always gets same ID across page reloads
- Example IDs: "a3f2b1", "k9m4p2", "7x3n1q"
| `hover_element` | Hover by element ID | `{element_id: "9z8x7c"}` |
| `scroll_element` | Scroll by element ID | `{element_id: "m5k2p8", direction: "down"}` |
| `keyboard_input` | Type into element | `{element_id: "j4n7q1", text: "hello"}` |

### Tool Mapping (5-Tool Architecture)
The visual interaction workflow is implemented across 5 focused tools:

| Tool | Commands | Purpose |
|------|----------|---------|
| `tab` | `tab init`, `tab open`, `tab close`, `tab switch`, `tab list`, `tab refresh`, `tab view` | Session and tab management |
| `highlight` | `highlight_elements` | Element discovery with blue overlays |
| `element_interaction` | `click_element`, `confirm_click_element`, `hover_element`, `confirm_hover_element`, `scroll_element`, `confirm_scroll_element`, `keyboard_input`, `confirm_keyboard_input` | Element interaction with orange 2PC confirmations |
| `dialog` | `handle_dialog` | Dialog handling (accept/dismiss) |
| `javascript` | `javascript_execute` | JavaScript fallback execution |

## UNIQUE PATTERNS

### JavaScript-First Automation (Fallback)
For complex interactions not covered by visual commands:
```javascript
// Click by visible text (universal pattern)
(() => {
    const text = 'YOUR_TEXT';
    const leaf = Array.from(document.querySelectorAll('*'))
        .find(el => el.children.length === 0 && el.textContent.includes(text));
    if (!leaf) return 'not found';
    const target = leaf.closest('a, button, [role="button"]') || leaf;
    target.click();
    return 'clicked: ' + target.tagName;
})()
```

### Multi-Session Tab Isolation
- `tab init <url>` creates managed session with tab group
- `conversation_id` ties all commands to session
- Tab groups provide visual isolation ("OpenBrowser" group)

### 2-Strike Rule
If operation fails twice:
1. Try full event sequence (pointerdown → mousedown → click)
2. Inspect DOM structure
3. Consider direct URL navigation

## SISYPHUS MODE

Automated looping mode for repetitive testing and monitoring.

### Configuration
1. Click the "🔄 Sisyphus" button in the status bar (next to Settings)
2. Configure prompts in the Prompts tab (add/remove/edit)
3. Enable Sisyphus mode in the Settings tab
4. Save configuration

### Behavior
- When enabled, the command input field is replaced with START/STOP buttons
- Click START to begin the Sisyphus loop:
  1. Creates a new conversation session (fresh UUID)
  2. Sends prompts in configured order
  3. Waits for each conversation to complete before sending next prompt
  4. After all prompts, repeats from step 1 with a new session
- Loop continues indefinitely until STOP is clicked

### Use Cases
- Automated testing of multi-step workflows
- Continuous monitoring of dynamic web pages
- Repetitive data collection tasks
- Stress testing browser interactions

### Storage
Configuration is saved to `localStorage` (key: `openbrowser_sisyphus_config`).

## COMMANDS

```bash
# Start server
uv run local-chrome-server serve

# Build extension
cd extension && npm run build

# CLI interactive mode
uv run chrome-cli interactive

# CLI tab management
uv run chrome-cli tabs init https://example.com
uv run chrome-cli tabs list
uv run chrome-cli javascript execute "document.title"
```

## SCREENSHOT BEHAVIOR

OpenBrowser has explicit screenshot control for maximum flexibility:

### Commands That Return Screenshots

| Command | Auto-Screenshot | Notes |
|---------|------------------|-------|
| `tab init` | Yes | Verify page load |
| `tab open` | Yes | Verify new tab |
| `tab switch` | Yes | Verify tab switch |
| `tab refresh` | Yes | Verify refresh result |
|---------|------------------|-------|
| `highlight_elements` | Yes | Visual overlay for element selection |
| `click_element` | Yes | Verify interaction result |
| `hover_element` | Yes | Verify hover state |
| `scroll_element` | Yes | Verify scroll position |
| `keyboard_input` | Yes | Verify input result |
| `handle_dialog` | Yes | Verify dialog handling result |
| `screenshot` | Yes | Explicit screenshot request |

### Commands That Do NOT Return Screenshots

| Command | Behavior | How to Get Screenshot |
|---------|----------|----------------------|
| `tab list` | Returns tab list only | N/A |
| `tab close` | Returns close result only | N/A |
| `javascript_execute` | Returns JS result only | Call `screenshot` after |
|---------|----------|----------------------|
| `tab init` | Returns tab info only | Call `screenshot` after |
| `tab open` | Returns tab info only | Call `screenshot` after |
| `tab switch` | Returns tab info only | Call `screenshot` after |
| `tab refresh` | Returns tab info only | Call `screenshot` after |
| `javascript_execute` | Returns JS result only | Call `screenshot` after |

### Best Practice

When you need visual feedback after JavaScript execution:
```
1. javascript_execute "document.querySelector('#button').click()"  # No screenshot
2. screenshot                                                # Explicit request for visual feedback
```
1. tab init https://example.com    # No screenshot
2. screenshot                      # Explicit request for visual feedback
3. highlight_elements()            # Get interactive elements
```

This explicit approach gives the AI full control over when visual feedback is needed.

---


## EVALUATION SYSTEM

Automated testing framework for evaluating AI agent performance on browser automation tasks.

### Structure
```
OpenBrowser/eval/
├── evaluate_browser_agent.py    # Main evaluation entry point
├── dataset/                     # YAML test case definitions
│   ├── techforum.yaml          # TechForum upvote test
│   ├── gbr.yaml                # GBR search test
│   └── cloudstack.yaml         # CloudStack DAS agent test
├── output/                      # Generated results and images
├── server.py                    # Mock websites server with tracking API
└── (existing mock websites directories)
```

### Key Features
- **Automated test execution**: Creates isolated OpenBrowser conversations for each test
- **Event tracking**: Captures browser interaction events via `/api/track` endpoint
- **SSE monitoring**: Records all SSE events from OpenBrowser agent (including images)
- **Image storage**: Extracts and saves screenshots in sequential order
- **Criteria-based scoring**: Evaluates performance against YAML-defined criteria
- **Service management**: Automatically starts/stops OpenBrowser and eval servers

### Usage
```bash
# List available tests
python eval/evaluate_browser_agent.py --list

# Run single test
python eval/evaluate_browser_agent.py --test techforum

# Run all tests (with service management)
python eval/evaluate_browser_agent.py

# Run without starting services (assumes servers already running)
python eval/evaluate_browser_agent.py --no-services
```

### Test Case Definition
Tests are defined in YAML format with:
- `id`, `name`, `description`, `difficulty`
- `start_url`: Initial URL to load
- `instruction`: Task description for AI agent
- `criteria`: List of scoring criteria with expected event patterns

### Event Tracking
Mock websites include tracking JavaScript (`js/tracker.js`) that sends events to `/api/track`. Events include:
- `page_view`, `click`, `input`, `scroll`, `hover`, `submit`
- Custom event types for specific interactions (e.g., `answer_action` for upvotes)

### Evaluation Criteria
Criteria match tracked events using flexible pattern matching:
- Event type, element IDs, classes, text content
- Page URLs, input values, custom fields
- Alternative conditions for flexible scoring

## NOTES

- **Git dependencies:** `openhands-sdk` and `openhands-tools` from git subdirectories
- **CDP required:** Extension uses Chrome DevTools Protocol for screenshots/JS execution
- **Preset coordinates:** Screenshots at 1280x720, mouse in 0-1280/0-720 coordinate system
- **Config storage:** LLM config in `~/.openbrowser/llm_config.json`
