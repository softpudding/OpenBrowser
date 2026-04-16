/**
 * Global Mock Mouse — CDP-based virtual mouse for CSS :hover persistence.
 *
 * Sends `Input.dispatchMouseEvent` (type "mouseMoved") via CDP to make the
 * browser behave as if a real mouse cursor is present at given coordinates.
 * This triggers native CSS :hover, which JavaScript-dispatched MouseEvents
 * cannot do.
 *
 * All calls are best-effort: failures are logged but never thrown, so the
 * existing JS event path remains the primary interaction mechanism.
 */

import { CdpCommander } from './cdp-commander';
import { debuggerSessionManager } from './debugger-manager';
import { elementCache } from './element-cache';

const positionByTab = new Map<number, { x: number; y: number }>();

/**
 * Move the CDP virtual mouse to (x, y) in CSS viewport coordinates.
 */
export async function moveTo(
  tabId: number,
  conversationId: string,
  x: number,
  y: number,
): Promise<void> {
  try {
    await debuggerSessionManager.attachDebugger(tabId, conversationId);
    const cdp = new CdpCommander(tabId);
    await cdp.sendCommand(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x, y, button: 'none', buttons: 0 },
      3000,
      0,
    );
    positionByTab.set(tabId, { x, y });
  } catch (err) {
    console.warn(
      `⚠️ [MockMouse] moveTo(${x}, ${y}) failed on tab ${tabId}:`,
      err,
    );
  }
}

/**
 * Move the CDP virtual mouse to the center of a cached element.
 * Returns the computed coordinates, or null if the element is not in cache.
 */
export async function moveToElement(
  tabId: number,
  conversationId: string,
  elementId: string,
): Promise<{ x: number; y: number } | null> {
  const cached = elementCache.getElementById(conversationId, tabId, elementId);
  if (!cached) return null;

  const { bbox } = cached.element;
  const x = bbox.x + bbox.width / 2;
  const y = bbox.y + bbox.height / 2;
  await moveTo(tabId, conversationId, x, y);
  return { x, y };
}

/**
 * Move the CDP virtual mouse to the center of a known bounding box.
 */
export async function moveToCoords(
  tabId: number,
  conversationId: string,
  bbox: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await moveTo(
    tabId,
    conversationId,
    bbox.x + bbox.width / 2,
    bbox.y + bbox.height / 2,
  );
}

/**
 * Return the last known CDP mouse position for a tab.
 */
export function getPosition(
  tabId: number,
): { x: number; y: number } | undefined {
  return positionByTab.get(tabId);
}

/**
 * Clear tracked position (e.g. on tab close).
 */
export function clearPosition(tabId: number): void {
  positionByTab.delete(tabId);
}
