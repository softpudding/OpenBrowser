# Extension Module (Chrome MV3)

**Stack:** TypeScript 5.8+ | Vite | Chrome Extension MV3 | CDP

## OVERVIEW

Chrome extension providing browser control via Chrome DevTools Protocol. Handles JavaScript execution, screenshot capture, tab management with session isolation via tab groups.

## COMPLEXITY HOTSPOTS (>500 lines)

| File                            | Lines | Purpose                                  |
| ------------------------------- | ----- | ---------------------------------------- |
| `src/commands/tab-manager.ts`   | 1010  | Tab lifecycle, multi-session, tab groups |
| `src/commands/dialog.ts`        | 378   | Dialog event handling, cascading dialogs |
| `src/commands/javascript.ts`    | 429   | JS execution with dialog detection       |
| `src/commands/computer.ts`      | 817   | Computer/browser automation actions      |
| `src/background/index.ts`       | 890   | Command queue, CDP flow, dialog handling |
| `src/commands/screenshot.ts`    | 605   | CDP capture, image processing pipeline   |
| `src/workers/worker-manager.ts` | 635   | Web worker lifecycle, image resizing     |

## WHERE TO LOOK

| Task             | File                               | Key Exports                                |
| ---------------- | ---------------------------------- | ------------------------------------------ |
| Background entry | `src/background/index.ts`          | `handleCommand()`, `CommandQueueManager`   |
| Dialog handling  | `src/commands/dialog.ts`           | `dialogManager`, `DialogManager`           |
| Tab management   | `src/commands/tab-manager.ts`      | `tabManager`, `TabSessionManager`          |
| JavaScript exec  | `src/commands/javascript.ts`       | `executeJavaScript()` (with dialog racing) |
| Screenshot       | `src/commands/screenshot.ts`       | `captureScreenshot()`                      |
| CDP commands     | `src/commands/cdp-commander.ts`    | `CDPCommander`                             |
| Debugger         | `src/commands/debugger-manager.ts` | `debuggerSessionManager`                   |
| Types            | `src/types.ts`                     | `Command`, `HandleDialogCommand`           |
| WebSocket client | `src/websocket/client.ts`          | `wsClient`                                 |

## STRUCTURE

```
extension/
├── src/
│   ├── background/      # Service worker entry (746 lines)
│   ├── commands/        # Browser command handlers (6 files)
│   ├── content/         # Content script (visual feedback)
│   ├── websocket/       # Server communication
│   ├── workers/         # Web workers (image processing)
│   └── types.ts         # TypeScript interfaces
├── manifest.json        # MV3 manifest
├── vite.config.ts       # Build config (multi-entry)
└── dist/                # Built extension
```

## BUILD

```bash
npm install
npm run build        # Production
npm run dev          # Watch mode (with auto-reload)
npm run typecheck    # Type check only
```

### Auto-Reload (Dev Mode)

`npm run dev` starts Vite in watch mode **and** a WebSocket reload server on `ws://127.0.0.1:8767`. The extension's background script connects to this server in dev builds and calls `chrome.runtime.reload()` automatically whenever Vite rebuilds.

- **First load**: After installing/reloading the extension manually once with a dev build, all subsequent rebuilds auto-reload — no need to visit `chrome://extensions`.
- **Production builds** (`npm run build`): The reload code is tree-shaken out entirely via the `__DEV__` compile-time constant.
- **Key files**: `src/background/dev-reload.ts` (extension client), `vite.config.ts` (`devReloadPlugin`).

## CONVENTIONS

- **Strict mode:** TypeScript strict enabled
- **Path alias:** `@/*` maps to `src/*`
- **ES modules:** Native ES modules, no bundler runtime
- **CDP via debugger API:** Uses `chrome.debugger` for CDP commands

## COMMAND HANDLING

1. WebSocket receives command from server
2. `CommandQueueManager` enqueues with cooldown
3. `handleCommand()` routes to appropriate handler
4. Response sent back via WebSocket

## ANTI-PATTERNS

- **NEVER return DOM nodes** - Serialize to JSON first
- **NEVER skip conversation_id** - Required for isolation
- **NEVER use `.click()` directly on React** - Use full event sequence
- **NEVER skip tab management** - Always `ensureTabManaged()` before CDP
- **NEVER use captureVisibleTab** - DEPRECATED, use CDP screenshot
- Debugger sessions auto-detach on tab close

## KEY CLASSES

| Class                    | Location                     | Role                              |
| ------------------------ | ---------------------------- | --------------------------------- |
| `CommandQueueManager`    | background/index.ts:35       | Serializes command execution      |
| `WatchdogTimer`          | background/index.ts:254      | Detects main thread freezes       |
| `DialogManager`          | commands/dialog.ts           | Dialog event detection, cascading |
| `TabManager`             | commands/tab-manager.ts      | Session-to-tab mapping            |
| `DebuggerSessionManager` | commands/debugger-manager.ts | CDP session lifecycle             |

## DIALOG HANDLING

When JavaScript triggers a dialog (alert/confirm/prompt), the browser pauses execution.
The extension uses Promise.race to detect dialogs and handle them gracefully.

### Design Flow

```
1. executeJavaScript() enables Page domain for dialog events
2. Promise.race([
     jsExecutionPromise,    // CDP Runtime.evaluate
     dialogEventPromise,    // Page.javascriptDialogOpening
     timeoutPromise         // User timeout
   ])
3. If dialog wins:
   - Alert: Auto-accept, return result
   - Confirm/Prompt: Return dialog info, wait for handle_dialog
```

### Key Components

- **dialog.ts**: Listens to `Page.javascriptDialogOpening` CDP events
- **javascript.ts**: Races JS execution vs dialog detection
- **background/index.ts**: Handles `handle_dialog` command with cascade detection

### Dialog Types

| Type         | Needs Decision | Handling                                   |
| ------------ | -------------- | ------------------------------------------ |
| alert        | No             | Auto-accept                                |
| confirm      | Yes            | AI must use handle_dialog                  |
| prompt       | Yes            | AI must use handle_dialog with prompt_text |
| beforeunload | Yes            | AI must use handle_dialog                  |

### Cascading Dialogs

After handling one dialog, another may appear (e.g., confirm → alert).
The system:

1. Detects cascade via 150ms wait window
2. Auto-accepts alerts
3. Returns info for confirm/prompt requiring another handle_dialog

### Blocking State

During dialog state:

- `javascript_execute` returns error: "Dialog is open"
- `screenshot` returns error: "Dialog is open"
- Only `handle_dialog` works

## UNIQUE PATTERNS

### Click by Visible Text

```javascript
(() => {
  const text = 'YOUR_TEXT';
  const leaf = Array.from(document.querySelectorAll('*')).find(
    (el) => el.children.length === 0 && el.textContent.includes(text),
  );
  if (!leaf) return 'not found';
  const target = leaf.closest('a, button, [role="button"]') || leaf;
  target.click();
  return 'clicked: ' + target.tagName;
})();
```

### 2-Strike Rule

If operation fails twice:

1. Try full event sequence (pointerdown → mousedown → click)
2. Inspect DOM structure
3. Consider direct URL navigation
