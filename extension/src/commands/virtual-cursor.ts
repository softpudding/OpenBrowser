/**
 * Virtual on-screen cursor — DOM overlay rendered into the page so the agent
 * can see where the pointer is in every screenshot.
 *
 * Why an in-page DOM overlay instead of the native OS cursor: CDP
 * `Page.captureScreenshot` does not include the OS cursor (see
 * `screenshot.ts` includeCursor docstring). So the live agent path renders a
 * 24×24 SVG arrow into the document with `position:fixed; pointer-events:none;
 * z-index: 2147483646` (one below the highlight overlay's z-index).
 *
 * The cursor is **always** injected via `preCaptureScript` immediately before
 * `Page.captureScreenshot` runs, so it appears fresh on whatever DOM exists at
 * the moment of capture. This sidesteps races against navigation / async
 * layout that a `chrome.webNavigation.onCommitted` listener would have.
 *
 * The hotspot (click point) is the upper-left tip of the arrow (pixel (2, 2)
 * inside the 24×24 sprite), matching OS cursor convention. The agent's `(x,
 * y)` coordinate aligns with the arrow's tip — the body extends down-right
 * away from the target.
 */

import { CdpCommander } from './cdp-commander';
import { debuggerSessionManager } from './debugger-manager';

const CURSOR_OVERLAY_ID = '__ob_cursor_overlay__';
const CURSOR_Z_INDEX = 2147483646;
// Cursor sprite size in CSS pixels. Hotspot stays at (2, 2) inside the
// sprite so the agent's `(x, y)` aligns with the upper-left tip of the arrow.
const CURSOR_SIZE = 36;

/**
 * Build a JS source string that creates or updates the virtual cursor at
 * (x, y) and returns viewport metadata. Designed to be passed as the
 * `preCaptureScript` argument to `captureScreenshot` so the cursor lands in
 * the captured image.
 *
 * Coordinates are CSS viewport pixels. The script is idempotent: it creates
 * the overlay div once per page load and only repositions on subsequent
 * calls. Position uses `transform: translate()` (cheaper than left/top
 * reflow) and writes are batched in a single style assignment.
 */
export function buildCursorInjectScript(x: number, y: number): string {
  const safeX = Math.max(0, Math.round(x));
  const safeY = Math.max(0, Math.round(y));
  return `
    (() => {
      try {
        const ID = ${JSON.stringify(CURSOR_OVERLAY_ID)};
        const Z = ${CURSOR_Z_INDEX};
        const SZ = ${CURSOR_SIZE};
        let host = document.getElementById(ID);
        if (!host) {
          host = document.createElement('div');
          host.id = ID;
          host.setAttribute('data-ob-virtual-cursor', '1');
          host.style.cssText = [
            'position:fixed',
            'top:0',
            'left:0',
            'width:' + SZ + 'px',
            'height:' + SZ + 'px',
            'pointer-events:none',
            'z-index:' + Z,
            'will-change:transform',
            'contain:layout style paint',
            // Smooth interpolation between consecutive position updates so
            // the cursor visibly glides instead of teleporting when watched
            // live. CDP screenshots capture whatever frame is current at
            // capture time, so this also makes mid-animation captures less
            // jarring during navigation.
            'transition:transform 120ms cubic-bezier(.25,.46,.45,.94)',
          ].join(';');
          // Layered sprite:
          // 1. A red ring + dot at the click hotspot (top-left, hotspot 2,2).
          //    The ring pulses subtly so the agent can spot it even on busy
          //    or low-contrast pages.
          // 2. A white arrow with a thick black outline and strong drop
          //    shadow on top. The arrow's tip aligns with the dot so the
          //    intended click point is unambiguous in screenshots.
          host.innerHTML = [
            '<style>',
            '  @keyframes __ob_cursor_pulse {',
            '    0%   { transform: scale(1);   opacity: 0.85; }',
            '    50%  { transform: scale(1.45); opacity: 0.4; }',
            '    100% { transform: scale(1);   opacity: 0.85; }',
            '  }',
            '  .__ob_cursor_ring {',
            '    position:absolute; left:-5px; top:-5px;',
            '    width:14px; height:14px; border-radius:50%;',
            '    background: rgba(220, 38, 38, 0.55);',
            '    box-shadow: 0 0 0 2px #fff, 0 0 8px rgba(0,0,0,0.55);',
            '    transform-origin: center;',
            '    animation: __ob_cursor_pulse 1.4s ease-in-out infinite;',
            '  }',
            '  .__ob_cursor_dot {',
            '    position:absolute; left:-2px; top:-2px;',
            '    width:8px; height:8px; border-radius:50%;',
            '    background:#dc2626;',
            '    box-shadow: 0 0 0 1.5px #fff;',
            '  }',
            '</style>',
            '<div class="__ob_cursor_ring"></div>',
            '<div class="__ob_cursor_dot"></div>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + SZ + '" height="' + SZ + '"',
            ' viewBox="0 0 36 36"',
            ' style="display:block;position:relative;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6))">',
            '  <path d="M2 2 L2 28 L10 20 L15 31 L20 29 L15 18 L26 18 Z"',
            '   fill="#ffffff" stroke="#000000" stroke-width="2"',
            '   stroke-linejoin="round" />',
            '</svg>',
          ].join('');
          (document.documentElement || document.body || document).appendChild(host);
        }
        host.style.transform = 'translate(' + ${safeX} + 'px,' + ${safeY} + 'px)';
        return {
          ok: true,
          x: ${safeX},
          y: ${safeY},
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    })()
  `;
}

/**
 * Build a JS source string that returns the current viewport size in CSS
 * pixels. Used to place the cursor at the viewport center on first injection
 * before any pixel action has been issued.
 */
export function buildViewportProbeScript(): string {
  return `({ width: window.innerWidth, height: window.innerHeight })`;
}

/**
 * Track the virtual cursor position per tab. The position is updated every
 * time the agent issues a pixel action; the next screenshot's
 * `preCaptureScript` reads from here.
 *
 * Default position on first read is (0, 0) — callers should resolve to
 * viewport center via `resolveCursorOrCenter()` before injecting.
 */
const cursorByTab = new Map<number, { x: number; y: number }>();

export function setCursorPosition(tabId: number, x: number, y: number): void {
  cursorByTab.set(tabId, {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
  });
}

export function getCursorPosition(
  tabId: number,
): { x: number; y: number } | undefined {
  return cursorByTab.get(tabId);
}

export function clearCursorPosition(tabId: number): void {
  cursorByTab.delete(tabId);
}

/**
 * Resolve the cursor position for a tab, defaulting to viewport center on
 * first call. Queries the page for `window.innerWidth/innerHeight` via CDP
 * Runtime.evaluate so we use the real viewport even when the extension has
 * no other source of truth yet.
 *
 * Returns CSS pixel coordinates suitable for `buildCursorInjectScript`.
 */
export async function resolveCursorOrCenter(
  tabId: number,
  conversationId: string,
): Promise<{ x: number; y: number }> {
  const known = cursorByTab.get(tabId);
  if (known) return known;
  try {
    await debuggerSessionManager.attachDebugger(tabId, conversationId);
    const cdp = new CdpCommander(tabId);
    const probe = await cdp.sendCommand(
      'Runtime.evaluate',
      {
        expression: buildViewportProbeScript(),
        returnByValue: true,
      },
      3000,
      0,
    );
    const value = (probe as { result?: { value?: unknown } } | undefined)
      ?.result?.value as
      | { width?: number; height?: number }
      | undefined;
    const w =
      typeof value?.width === 'number' && value.width > 0 ? value.width : 1280;
    const h =
      typeof value?.height === 'number' && value.height > 0
        ? value.height
        : 720;
    const center = { x: Math.round(w / 2), y: Math.round(h / 2) };
    cursorByTab.set(tabId, center);
    return center;
  } catch (err) {
    console.warn(
      `⚠️ [VirtualCursor] resolveCursorOrCenter failed on tab ${tabId}:`,
      err,
    );
    // Conservative default — clamps to a typical viewport.
    const fallback = { x: 640, y: 360 };
    cursorByTab.set(tabId, fallback);
    return fallback;
  }
}
