/**
 * Pixel-level mouse and keyboard dispatch via CDP.
 *
 * Used by the live agent path: the model emits Qwen-VL [0,1000] coordinates,
 * the server denormalizes them to CSS pixels, and these helpers turn the CSS
 * pixels into `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` calls.
 *
 * All entry points clamp coordinates to the live viewport before dispatch
 * (defense-in-depth) and refresh the in-DOM virtual cursor on every call.
 *
 * Coordinates are CSS viewport pixels — same space CDP `Input.*` consumes.
 */

import { CdpCommander } from './cdp-commander';
import { debuggerSessionManager } from './debugger-manager';
import { dialogManager } from './dialog';
import {
  buildCursorInjectScript,
  setCursorPosition,
  getCursorPosition,
  resolveCursorOrCenter,
  buildViewportProbeScript,
} from './virtual-cursor';

/**
 * Common pre-flight: ensure CDP debugger is attached AND dialog tracking is
 * enabled for this tab. Without dialog tracking, a click that opens a
 * confirm/prompt would block subsequent CDP calls without surfacing a
 * `dialog_opened` state to the agent.
 */
async function attachWithDialogTracking(
  tabId: number,
  conversationId: string,
): Promise<void> {
  await debuggerSessionManager.attachDebugger(tabId, conversationId);
  try {
    await dialogManager.enableForTab(tabId);
  } catch (err) {
    console.warn(
      `⚠️ [PixelActions] dialogManager.enableForTab failed on tab ${tabId}:`,
      err,
    );
  }
}

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

function modifiersBitmask(modifiers: string[] | undefined | null): number {
  if (!modifiers || modifiers.length === 0) return 0;
  let mask = 0;
  for (const m of modifiers) {
    const bit = MODIFIER_BITS[m.toLowerCase()];
    if (bit) mask |= bit;
  }
  return mask;
}

async function getViewport(
  cdp: CdpCommander,
): Promise<{ width: number; height: number }> {
  try {
    const probe = await cdp.sendCommand<{
      result?: { value?: { width?: number; height?: number } };
    }>(
      'Runtime.evaluate',
      {
        expression: buildViewportProbeScript(),
        returnByValue: true,
      },
      8000,
      0,
    );
    const value = probe?.result?.value;
    const w = typeof value?.width === 'number' && value.width > 0
      ? value.width
      : 1280;
    const h = typeof value?.height === 'number' && value.height > 0
      ? value.height
      : 720;
    return { width: w, height: h };
  } catch {
    return { width: 1280, height: 720 };
  }
}

function clampToViewport(
  x: number,
  y: number,
  vw: number,
  vh: number,
): { x: number; y: number; warning?: string } {
  let warning: string | undefined;
  let cx = Math.round(x);
  let cy = Math.round(y);
  if (cx < 0 || cx > vw || cy < 0 || cy > vh) {
    warning = `(${cx}, ${cy}) outside viewport ${vw}x${vh}; clamped`;
  }
  cx = Math.max(0, Math.min(vw, cx));
  cy = Math.max(0, Math.min(vh, cy));
  return { x: cx, y: cy, warning };
}

async function refreshCursor(
  cdp: CdpCommander,
  tabId: number,
  x: number,
  y: number,
): Promise<void> {
  setCursorPosition(tabId, x, y);
  try {
    await cdp.sendCommand(
      'Runtime.evaluate',
      {
        expression: buildCursorInjectScript(x, y),
        returnByValue: true,
      },
      8000,
      0,
    );
  } catch (err) {
    console.warn(
      `⚠️ [PixelActions] Cursor refresh failed on tab ${tabId}:`,
      err,
    );
  }
}

// Cubic ease-in-out — slow start, fast middle, slow stop. Mimics a real
// human reach instead of teleporting between two points.
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function performMouseMove(
  tabId: number,
  conversationId: string,
  x: number,
  y: number,
): Promise<{ x: number; y: number; warning?: string }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const { width: vw, height: vh } = await getViewport(cdp);
  const target = clampToViewport(x, y, vw, vh);

  // Lerp the cursor from its last position to the target with eased
  // intermediate `mouseMoved` events. This makes the move look like a
  // real human stroke: hover/mouseenter events fire in order along the
  // path, and live observers see the cursor sprite glide instead of
  // teleporting. The CSS transition on the cursor div smooths the
  // visible sprite; the CDP step-through smooths the input-event side.
  const start = getCursorPosition(tabId) ?? { x: target.x, y: target.y };
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(2, Math.min(30, Math.round(distance / 24)));
  // Total move duration scales with distance (≈ 1.5 ms / px) and is
  // capped so even cross-screen sweeps complete in well under a second.
  const totalMs = Math.max(60, Math.min(450, distance * 1.5));
  const stepDelay = steps > 1 ? totalMs / (steps - 1) : 0;

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const ix = Math.round(start.x + dx * t);
    const iy = Math.round(start.y + dy * t);
    await cdp.sendCommand(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: ix,
        y: iy,
        button: 'none',
        buttons: 0,
      },
      8000,
      0,
    );
    if (stepDelay > 4 && i < steps) {
      await sleep(stepDelay);
    }
  }

  await refreshCursor(cdp, tabId, target.x, target.y);
  return target;
}

export async function performMouseClick(
  tabId: number,
  conversationId: string,
  // `click` is an in-place action. `_x` and `_y` are kept on the wire
  // schema for compatibility but are intentionally ignored: if the
  // agent wants to click somewhere new, it must `move` there first.
  // This makes the cursor's visible position load-bearing — the click
  // commits exactly where the agent (and any human observer) sees it.
  _x: number | undefined,
  _y: number | undefined,
  button: 'left' | 'right' | 'middle' = 'left',
  count: number = 1,
): Promise<{ x: number; y: number; button: string; warning?: string }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const { width: vw, height: vh } = await getViewport(cdp);

  // Click happens at the cursor's last known position. On the very
  // first action of a tab, fall back to viewport center — same default
  // the cursor sprite uses on first inject.
  const cursor =
    getCursorPosition(tabId) ??
    (await resolveCursorOrCenter(tabId, conversationId));
  const clamped = clampToViewport(cursor.x, cursor.y, vw, vh);

  const cdpButton: 'left' | 'right' | 'middle' = button;
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
  const safeCount = Math.max(1, Math.min(3, count | 0));

  // CDP convention: emit one press/release pair per click and increment
  // `clickCount` (1, 2, 3) so Chrome interprets it as a single → double →
  // triple click sequence. Sending N pairs each with `clickCount:N` produces
  // N independent N-clicks, which is wrong for double-click semantics.
  for (let i = 1; i <= safeCount; i++) {
    await cdp.sendCommand(
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        x: clamped.x,
        y: clamped.y,
        button: cdpButton,
        buttons,
        clickCount: i,
      },
      8000,
      0,
    );
    await cdp.sendCommand(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        x: clamped.x,
        y: clamped.y,
        button: cdpButton,
        buttons,
        clickCount: i,
      },
      8000,
      0,
    );
  }

  await refreshCursor(cdp, tabId, clamped.x, clamped.y);
  return { x: clamped.x, y: clamped.y, button, warning: clamped.warning };
}

export async function performMouseDrag(
  tabId: number,
  conversationId: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  button: 'left' | 'right' | 'middle' = 'left',
  steps: number = 10,
): Promise<{
  start: { x: number; y: number };
  end: { x: number; y: number };
  warning?: string;
}> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const { width: vw, height: vh } = await getViewport(cdp);
  const start = clampToViewport(startX, startY, vw, vh);
  const end = clampToViewport(endX, endY, vw, vh);
  const safeSteps = Math.max(2, Math.min(40, steps | 0));
  const cdpButton: 'left' | 'right' | 'middle' = button;
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
  const warning = start.warning || end.warning;

  // Pre-move to start
  await cdp.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x: start.x,
      y: start.y,
      button: 'none',
      buttons: 0,
    },
    8000,
    0,
  );
  // Press
  await cdp.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: cdpButton,
      buttons,
      clickCount: 1,
    },
    8000,
    0,
  );
  // Lerp moves
  for (let i = 1; i <= safeSteps; i++) {
    const t = i / safeSteps;
    const ix = Math.round(start.x + (end.x - start.x) * t);
    const iy = Math.round(start.y + (end.y - start.y) * t);
    await cdp.sendCommand(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: ix,
        y: iy,
        button: cdpButton,
        buttons,
      },
      8000,
      0,
    );
  }
  // Release
  await cdp.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x: end.x,
      y: end.y,
      button: cdpButton,
      buttons,
      clickCount: 1,
    },
    8000,
    0,
  );

  await refreshCursor(cdp, tabId, end.x, end.y);
  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    warning,
  };
}

export async function performMouseScroll(
  tabId: number,
  conversationId: string,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
): Promise<{ x: number; y: number; deltaX: number; deltaY: number }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const cursor =
    getCursorPosition(tabId) ??
    (await resolveCursorOrCenter(tabId, conversationId));
  const safeAmount = Math.max(1, Math.min(2000, amount | 0));
  let deltaX = 0;
  let deltaY = 0;
  switch (direction) {
    case 'down':
      deltaY = safeAmount;
      break;
    case 'up':
      deltaY = -safeAmount;
      break;
    case 'right':
      deltaX = safeAmount;
      break;
    case 'left':
      deltaX = -safeAmount;
      break;
  }
  await cdp.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseWheel',
      x: cursor.x,
      y: cursor.y,
      deltaX,
      deltaY,
    },
    8000,
    0,
  );
  await refreshCursor(cdp, tabId, cursor.x, cursor.y);
  return { x: cursor.x, y: cursor.y, deltaX, deltaY };
}

// Per-character US-keyboard mapping for plain ASCII printables. Used by
// `performKeyboardType` to dispatch real keyDown/keyUp events one char at
// a time — feels like a human typing and lets per-character JS handlers
// (autocomplete, validation) react in order. Anything outside this map
// (CJK, emoji, accented Latin, etc.) falls through to `Input.insertText`.
const SHIFT_PUNCT: Record<string, { key: string; code: string; keyCode: number }> = {
  '!': { key: '!', code: 'Digit1', keyCode: 49 },
  '@': { key: '@', code: 'Digit2', keyCode: 50 },
  '#': { key: '#', code: 'Digit3', keyCode: 51 },
  $: { key: '$', code: 'Digit4', keyCode: 52 },
  '%': { key: '%', code: 'Digit5', keyCode: 53 },
  '^': { key: '^', code: 'Digit6', keyCode: 54 },
  '&': { key: '&', code: 'Digit7', keyCode: 55 },
  '*': { key: '*', code: 'Digit8', keyCode: 56 },
  '(': { key: '(', code: 'Digit9', keyCode: 57 },
  ')': { key: ')', code: 'Digit0', keyCode: 48 },
  _: { key: '_', code: 'Minus', keyCode: 189 },
  '+': { key: '+', code: 'Equal', keyCode: 187 },
  '{': { key: '{', code: 'BracketLeft', keyCode: 219 },
  '}': { key: '}', code: 'BracketRight', keyCode: 221 },
  '|': { key: '|', code: 'Backslash', keyCode: 220 },
  ':': { key: ':', code: 'Semicolon', keyCode: 186 },
  '"': { key: '"', code: 'Quote', keyCode: 222 },
  '<': { key: '<', code: 'Comma', keyCode: 188 },
  '>': { key: '>', code: 'Period', keyCode: 190 },
  '?': { key: '?', code: 'Slash', keyCode: 191 },
  '~': { key: '~', code: 'Backquote', keyCode: 192 },
};
const PLAIN_PUNCT: Record<string, { key: string; code: string; keyCode: number }> = {
  '`': { key: '`', code: 'Backquote', keyCode: 192 },
  '-': { key: '-', code: 'Minus', keyCode: 189 },
  '=': { key: '=', code: 'Equal', keyCode: 187 },
  '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
  ']': { key: ']', code: 'BracketRight', keyCode: 221 },
  '\\': { key: '\\', code: 'Backslash', keyCode: 220 },
  ';': { key: ';', code: 'Semicolon', keyCode: 186 },
  "'": { key: "'", code: 'Quote', keyCode: 222 },
  ',': { key: ',', code: 'Comma', keyCode: 188 },
  '.': { key: '.', code: 'Period', keyCode: 190 },
  '/': { key: '/', code: 'Slash', keyCode: 191 },
};

function keyParamsForChar(
  ch: string,
): { key: string; code: string; keyCode: number; shift: boolean } | null {
  if (ch.length !== 1) return null;
  const code = ch.charCodeAt(0);
  if (code > 0x7e || code < 0x20) return null;
  if (ch >= 'a' && ch <= 'z') {
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      shift: false,
    };
  }
  if (ch >= 'A' && ch <= 'Z') {
    return {
      key: ch,
      code: `Key${ch}`,
      keyCode: ch.charCodeAt(0),
      shift: true,
    };
  }
  if (ch >= '0' && ch <= '9') {
    return {
      key: ch,
      code: `Digit${ch}`,
      keyCode: ch.charCodeAt(0),
      shift: false,
    };
  }
  if (ch === ' ') return { key: ' ', code: 'Space', keyCode: 32, shift: false };
  if (PLAIN_PUNCT[ch]) return { ...PLAIN_PUNCT[ch], shift: false };
  if (SHIFT_PUNCT[ch]) return { ...SHIFT_PUNCT[ch], shift: true };
  return null;
}

export async function performKeyboardType(
  tabId: number,
  conversationId: string,
  text: string,
): Promise<{ length: number }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);

  // Type one character at a time so the page sees real `keydown` →
  // `keypress` → `input` → `keyup` events for each char. This matches
  // what a human keyboard produces and lets per-char JS handlers
  // (autocomplete dropdowns, live validation, debounced search) react
  // in order. Small inter-char delays keep the cadence human-paced.
  // Non-ASCII characters (CJK, emoji, accented Latin) fall back to
  // `Input.insertText` because they don't have a clean US-keyboard
  // representation.
  const PER_CHAR_DELAY_MS = 28;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const params = keyParamsForChar(ch);
    if (params) {
      const modifiers = params.shift ? 8 : 0;
      // keyDown with `text` fires keypress + input as well as keydown.
      await cdp.sendCommand(
        'Input.dispatchKeyEvent',
        {
          type: 'keyDown',
          key: params.key,
          code: params.code,
          windowsVirtualKeyCode: params.keyCode,
          text: params.key,
          unmodifiedText: params.key,
          modifiers,
        },
        8000,
        0,
      );
      await cdp.sendCommand(
        'Input.dispatchKeyEvent',
        {
          type: 'keyUp',
          key: params.key,
          code: params.code,
          windowsVirtualKeyCode: params.keyCode,
          modifiers,
        },
        8000,
        0,
      );
    } else {
      // Non-ASCII: insert as raw text. Fires `input` but not keydown.
      await cdp.sendCommand('Input.insertText', { text: ch }, 8000, 0);
    }
    if (PER_CHAR_DELAY_MS > 0 && i < text.length - 1) {
      await sleep(PER_CHAR_DELAY_MS);
    }
  }
  return { length: text.length };
}

const NAMED_KEY_MAP: Record<
  string,
  { key: string; code: string; keyCode?: number }
> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  return: { key: 'Enter', code: 'Enter', keyCode: 13 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
};

function resolveNamedKey(rawKey: string): {
  key: string;
  code: string;
  keyCode?: number;
} {
  const direct = NAMED_KEY_MAP[rawKey.toLowerCase()];
  if (direct) return direct;
  if (rawKey.length === 1) {
    const ch = rawKey;
    if (ch >= 'a' && ch <= 'z') {
      return {
        key: ch,
        code: `Key${ch.toUpperCase()}`,
        keyCode: ch.toUpperCase().charCodeAt(0),
      };
    }
    if (ch >= 'A' && ch <= 'Z') {
      return { key: ch, code: `Key${ch}`, keyCode: ch.charCodeAt(0) };
    }
    if (ch >= '0' && ch <= '9') {
      return {
        key: ch,
        code: `Digit${ch}`,
        keyCode: ch.charCodeAt(0),
      };
    }
  }
  // Unknown: pass through verbatim.
  return { key: rawKey, code: rawKey };
}

// Keys that produce a character — these need a `text` field on the
// keyDown so Chrome fires `keypress` (which is what most form-submit
// handlers and search shortcuts listen for). Without the text, keypress
// never fires and pressing Enter looks like nothing happened.
const KEY_TEXT: Record<string, string> = {
  Enter: '\r',
  Tab: '\t',
  Space: ' ',
};

export async function performKeyboardPress(
  tabId: number,
  conversationId: string,
  rawKey: string,
  modifiers: string[] | undefined,
): Promise<{ key: string; modifiers: number }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const resolved = resolveNamedKey(rawKey);
  const mod = modifiersBitmask(modifiers);

  // For single printable characters with no modifiers, attach `text` so
  // the keypress event fires. Pure shortcuts (Ctrl+A, Cmd+K) intentionally
  // omit text — keypress shouldn't fire there.
  let text: string | undefined;
  if (KEY_TEXT[resolved.key]) {
    text = KEY_TEXT[resolved.key];
  } else if (resolved.key.length === 1 && mod === 0) {
    text = resolved.key;
  }

  const downParams: Record<string, unknown> = {
    type: 'keyDown',
    key: resolved.key,
    code: resolved.code,
    modifiers: mod,
  };
  if (resolved.keyCode !== undefined) {
    downParams.windowsVirtualKeyCode = resolved.keyCode;
  }
  if (text !== undefined) {
    downParams.text = text;
    downParams.unmodifiedText = text;
  }

  await cdp.sendCommand('Input.dispatchKeyEvent', downParams, 8000, 0);
  await cdp.sendCommand(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: resolved.key,
      code: resolved.code,
      ...(resolved.keyCode !== undefined
        ? { windowsVirtualKeyCode: resolved.keyCode }
        : {}),
      modifiers: mod,
    },
    8000,
    0,
  );
  return { key: resolved.key, modifiers: mod };
}

/**
 * Clear the currently focused input by selecting all then deleting.
 * Convenience wrapper so the agent doesn't have to chain Ctrl+A →
 * Backspace as two separate `press` calls.
 */
export async function performKeyboardClear(
  tabId: number,
  conversationId: string,
): Promise<{ cleared: true }> {
  // Select all (Ctrl+A — works on macOS in browser inputs too).
  await performKeyboardPress(tabId, conversationId, 'a', ['Control']);
  await sleep(20);
  await performKeyboardPress(tabId, conversationId, 'Backspace', undefined);
  return { cleared: true };
}

export async function performResetMouse(
  tabId: number,
  conversationId: string,
): Promise<{ x: number; y: number }> {
  await attachWithDialogTracking(tabId, conversationId);
  const cdp = new CdpCommander(tabId);
  const { width: vw, height: vh } = await getViewport(cdp);
  const cx = Math.round(vw / 2);
  const cy = Math.round(vh / 2);
  await cdp.sendCommand(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x: cx,
      y: cy,
      button: 'none',
      buttons: 0,
    },
    8000,
    0,
  );
  await refreshCursor(cdp, tabId, cx, cy);
  return { x: cx, y: cy };
}
