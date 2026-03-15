# Server Module (FastAPI Backend)

**Stack:** Python 3.12+ | FastAPI | Pydantic | WebSocket | SQLite

## OVERVIEW

FastAPI backend handling REST API, WebSocket communication with Chrome extension, and AI agent orchestration via OpenHands SDK. Multi-session isolation with SQLite persistence.

## WHERE TO LOOK

| Task | File | Key Symbols |
|------|------|-------------|
| Server entry | `main.py` | `cli()`, `serve()` |
| FastAPI app | `api/main.py` | `app`, lifespan, routers |
| Agent manager | `agent/manager.py` | `OpenBrowserAgentManager` |
| Command processor | `core/processor.py` | `CommandProcessor`, `_execute_*` |
| Session state | `core/session_manager.py` | `SessionManager`, SQLite |
| WebSocket | `websocket/manager.py` | `ws_manager`, `send_command()` |
| LLM config | `core/llm_config.py` | `llm_config_manager` |
| Command models | `models/commands.py` | `Command`, `HandleDialogCommand`, `DialogAction` |
| Tab tool | `agent/tools/tab_tool.py` | `TabTool`, `TabAction` |
| Highlight tool | `agent/tools/highlight_tool.py` | `HighlightTool`, `HighlightAction` |
| Element interaction | `agent/tools/element_interaction_tool.py` | `ElementInteractionTool`, `ElementInteractionAction` |
| Dialog tool | `agent/tools/dialog_tool.py` | `DialogTool`, `DialogHandleAction` |
| JavaScript tool | `agent/tools/javascript_tool.py` | `JavaScriptTool`, `JavaScriptAction` |
| ToolSet aggregator | `agent/tools/toolset.py` | `OpenBrowserToolSet` |
## STRUCTURE

```
server/
├── main.py              # CLI entry (serve, check, execute)
├── api/
│   ├── main.py          # FastAPI app + lifespan
│   ├── sse.py           # SSE event streaming
│   └── routes/          # REST endpoints (health, commands, agent, config)
├── agent/
│   ├── manager.py       # OpenBrowserAgentManager singleton
│   ├── conversation.py  # ConversationState, message handling
│   └── tools/           # OpenHands tool integrations
├── core/
│   ├── processor.py     # Command routing, per-conversation tab tracking
│   ├── session_manager.py  # SQLite persistence (SessionMetadata)
│   ├── config.py        # Server config (ports, host)
│   └── llm_config.py    # LLM API settings storage
├── websocket/
│   └── manager.py       # Extension communication, command_id futures
└── models/
    └── commands.py      # Pydantic command types (MouseMove, Tab, etc.)
```

## KEY CLASSES

| Class | Location | Role |
|-------|----------|------|
| `OpenBrowserAgentManager` | `agent/manager.py` | Singleton; creates/manages conversations, LLM init, tool provisioning |
| `CommandProcessor` | `core/processor.py` | Routes commands to extension; tracks `current_tab_id` per conversation |
| `SessionManager` | `core/session_manager.py` | SQLite-backed session CRUD, history, events |
| `WebSocketManager` | `websocket/manager.py` | Extension connections, command/response correlation via futures |

## CONVENTIONS

- **Strict typing:** All functions must have type hints
- **Async:** All I/O operations are async
- **Singletons:** Global instances (`command_processor`, `ws_manager`, `agent_manager`)
- **Conversation ID:** Required for all browser commands (multi-session isolation)

## COMMAND TYPES

| Type | Model | Handler |
|------|-------|---------|
| `javascript_execute` | `JavascriptExecuteCommand` | Extension CDP |
| `screenshot` | `ScreenshotCommand` | Extension CDP |
| `tab` | `TabCommand` | Extension tab API |
| `get_tabs` | `GetTabsCommand` | Extension tab API |
| `highlight_single_element` | `HighlightSingleElementCommand` | Extension 2PC flow |
| `get_element_html` | `GetElementHtmlCommand` | Extension element cache |
| `keyboard_input` | `KeyboardInputCommand` | Extension element actions |
| `scroll_element` | `ScrollElementCommand` | Extension element actions |
| `hover_element` | `HoverElementCommand` | Extension element actions |
| `click_element` | `ClickElementCommand` | Extension element actions |
| `highlight_elements` | `HighlightElementsCommand` | Extension element detection |
| `highlight_single_element` | `HighlightSingleElementCommand` | Extension 2PC flow |
| `get_element_html` | `GetElementHtmlCommand` | Extension element cache |
| `keyboard_input` | `KeyboardInputCommand` | Extension element actions |
| `scroll_element` | `ScrollElementCommand` | Extension element actions |
| `hover_element` | `HoverElementCommand` | Extension element actions |
| `click_element` | `ClickElementCommand` | Extension element actions |
| `highlight_elements` | `HighlightElementsCommand` | Extension element detection |
| `handle_dialog` | `HandleDialogCommand` | Extension CDP |
| `get_accessibility_tree` | `GetAccessibilityTreeCommand` | Extension CDP |

## DIALOG HANDLING

When JavaScript triggers a dialog (alert/confirm/prompt), the browser pauses.
OpenBrowser detects dialogs and handles them gracefully.

### Key Components
| Component | File | Role |
|-----------|------|------|
| `HandleDialogCommand` | models/commands.py | `action` (accept/dismiss), `prompt_text` |
| `CommandProcessor` | core/processor.py | Routes handle_dialog to extension |

### Dialog Types
| Type | Needs Decision | AI Action |
|------|----------------|----------|
| alert | No | Auto-accepted |
| confirm | Yes | Must call handle_dialog |
| prompt | Yes | Must call handle_dialog with text |
| beforeunload | Yes | Must call handle_dialog |

### Flow
1. `javascript_execute` triggers dialog
2. Extension returns `dialog_opened: true` with dialog info
3. AI sees "Dialog Opened" in observation
4. AI calls `handle_dialog` with `accept` or `dismiss`
5. Extension handles, checks for cascade, returns result

### Cascading Dialogs
After handling one dialog, another may open (e.g., confirm → alert).
The extension:
- Auto-accepts alerts
- Returns info for new confirm/prompt


## VISUAL INTERACTION COMMANDS

OpenBrowser uses a visual-first approach where elements are highlighted with numbered overlays before interaction.

### Key Commands
| Command | Purpose | Parameters |
|---------|---------|-----------|
| `highlight_elements` | Detect and highlight interactive elements | `element_type?: string`, `page?: number` |
| `click_element` | Click a highlighted element by ID | `element_id: string`, `tab_id: number` |
| `hover_element` | Hover over a highlighted element | `element_id: string`, `tab_id: number` |
| `scroll_element` | Scroll an element or the page | `element_id?: string`, `direction: string`, `tab_id: number` |
| `keyboard_input` | Type text into an element | `element_id: string`, `text: string`, `tab_id: number` |
| `get_element_html` | Get HTML of a cached element | `element_id: string`, `tab_id?: number` |
| `highlight_single_element` | Highlight single element for 2PC | `element_id: string`, `tab_id?: number` |

### Element Types
- `clickable` - Buttons, links, clickable elements
- `scrollable` - Scrollable containers
- `inputable` - Input fields, textareas
- `hoverable` - Hoverable elements

### tab_id Auto-Resolution
All visual interaction commands require `tab_id` in Python models, However, the TypeScript extension
can auto-resolve `tab_id` from the conversation context if not provided explicitly. This allows for cleaner
API usage in most cases where the active tab is implied.

For cross-reference, see root AGENTS.md "VISUAL INTERACTION WORKFLOW" section for complete workflow details.


## ACCESSIBILITY CONTEXT

The system provides a list of accessible interactive elements to help the AI agent
understand page structure and select elements.

### How It Works
1. After each `javascript_execute`, `tab init/open/switch`, the system fetches the accessibility tree
2. Returns list of interactive elements with selectors in `a11y_elements` field

### Key Components
| Component | File | Role |
|-----------|------|------|
| `GetAccessibilityTreeCommand` | models/commands.py | `max_elements` parameter |
| `_get_a11y_elements_for_conversation()` | core/processor.py | Fetch accessibility tree |

### Elements Format
```python
[
    {"role": "button", "name": "Submit", "selector": "#submit-btn", "index": 0},
    {"role": "textbox", "name": "Email", "selector": "[name='email']", "index": 0},
    ...
]
```


## SCREENSHOT BEHAVIOR

The screenshot logic is controlled by the Extension layer. The server layer routes commands while the Extension layer decides when to capture screenshots.

### Commands That Return Screenshots

| Command | Returns Screenshot | Notes |
|---------|--------------------|-------|
| `screenshot` | Yes | Explicit screenshot request |
| `highlight_elements` | Yes | Visual overlay for element selection |
| `highlight_single_element` | Yes | 2PC confirmation overlay |
| `click_element` | Yes | Verify interaction result |
| `hover_element` | Yes | Verify hover state |
| `scroll_element` | Yes | Verify scroll position |
| `keyboard_input` | Yes | Verify input result |
| `handle_dialog` | Yes | Verify dialog handling result |

### Commands That Do NOT Return Screenshots

| Command | Behavior | How to Get Screenshot |
|---------|----------|----------------------|
| `tab init` | Returns tab info only | Call `screenshot` after |
| `tab open` | Returns tab info only | Call `screenshot` after |
| `tab switch` | Returns tab info only | Call `screenshot` after |
| `tab refresh` | Returns tab info only | Call `screenshot` after |
| `javascript_execute` | Returns JS result only | Call `screenshot` after |

### Implementation Note

After the screenshot refactor, the server layer no longer proactively triggers screenshots in tab and javascript_execute commands. All screenshot decisions are made by the Extension layer.

**Best Practice:** Use explicit `screenshot` command when visual feedback is needed after navigation or JavaScript execution.

## 5-TOOL ARCHITECTURE

OpenBrowser now uses 5 focused tools instead of a single monolithic tool:

### 1. Tab Tool (`tab`)
- **Purpose**: Browser tab management with session isolation
- **Actions**: `init`, `open`, `close`, `switch`, `list`, `refresh`, `view`
- **Session isolation**: Each conversation has its own tab group

### 2. Highlight Tool (`highlight`)
- **Purpose**: Element discovery with collision-free visual overlays
- **Element types**: `clickable` (default), `inputable`, `scrollable`, `hoverable`
- **Visual coding**: BLUE stage - safe identification before interaction
- **Pagination**: Collision-aware pages for non-overlapping element display

### 3. Element Interaction Tool (`element_interaction`)
- **Purpose**: Click, hover, scroll, keyboard input with Two-Phase Commit (2PC)
- **Visual coding**: ORANGE stage - confirmation before execution
- **2PC flow**: `click_element` → orange highlight → `confirm_click_element`
- **Commands**: `click`, `hover`, `scroll`, `keyboard_input` with confirmation variants

### 4. Dialog Tool (`dialog`)
- **Purpose**: Browser dialog (alert/confirm/prompt) handling
- **Dialog types**: `alert` (auto-accepted), `confirm`, `prompt`, `beforeunload`
- **Required**: Handle dialogs before continuing browser operations

### 5. JavaScript Tool (`javascript`)
- **Purpose**: Custom JavaScript execution as fallback mechanism
- **When to use**: When visual commands fail (2-Strike Rule) or for complex DOM manipulation
- **Guidelines**: Return JSON-serializable values, 30-second timeout

### Shared Architecture
- **Shared executor**: All 5 tools share executor for 2PC state management
- **Conversation isolation**: Each conversation has isolated state
- **Backward compatibility**: `OpenBrowserTool` still available with deprecation warning
- **ToolSet**: `OpenBrowserToolSet` aggregates all 5 tools for registration

## NOTES

- WebSocket runs on port 8766, HTTP on 8765
- `conversation_id` links all commands to session context
- Agent uses OpenHands SDK with 5 focused tools (tab, highlight, element_interaction, dialog, javascript)
- Dialogs block screenshot/JS until handled

## ANTI-PATTERNS

- **NEVER skip conversation_id** - Required for multi-session isolation
- **NEVER suppress type errors** - `disallow_untyped_defs = true` enforced
- **NEVER access WebSocket directly** - Use `ws_manager` singleton
- **NEVER hardcode ports** - Use `config.port` / `config.websocket_port`
- **NEVER ignore dialog_opened** - AI must handle dialogs before continuing
