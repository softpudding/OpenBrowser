import type { ElementActionResult } from '../types';
/**
 * Element Actions - Element-based interaction commands
 *
 * Provides element-based click and interaction commands that use cached
 * element selectors instead of pixel coordinates.
 *
 * DESIGN:
 * - Looks up elements from cache by element_id
 * - Executes JavaScript with full event sequence for React/Vue compatibility
 * - Handles dialog events using the same pattern as javascript.ts
 */

import { CdpCommander } from './cdp-commander';
import { buildElementCacheMissMessage, elementCache } from './element-cache';
import { executeJavaScript, type JavaScriptResult } from './javascript';
import { buildHitTestVisibilityHelpersScript } from '../utils/hit-test-visibility';
import { moveTo, moveToElement } from './mock-mouse';

function escapeForDoubleQuotedJavaScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ============================================================
// Keyboard typing helpers
//
// Sites such as zhihu.com run hot-topic carousels that overwrite
// the search input's value on a timer, pausing only when they see
// real keystroke events (keydown/keyup). A bulk `el.value = text`
// from content-script JS never fires those, so the rotator keeps
// ticking over typed text.
//
// `typeTextViaCdp` below uses CDP `Input.dispatchKeyEvent` so each
// character flows through Chromium's native input pipeline — the
// same path a human keyboard uses — firing keydown, keypress (when
// applicable), input, and keyup in the correct order.
// ============================================================

interface CdpKeyParams {
  key: string;
  code: string;
  keyCode: number;
  modifiers: number;
}

// US keyboard layout map for ASCII punctuation and shifted symbols.
// Each entry gives the DOM `code`, the unshifted Windows virtual key
// code, and whether Shift is required to produce the character.
// Without this table, symbols would emit a keydown with `code: ''`
// and a raw ASCII code point, which breaks sites that listen for
// `event.code === 'Period'` / `event.key === '@'` semantics.
const US_SYMBOL_KEYS: Record<
  string,
  { code: string; keyCode: number; shift: boolean; key: string }
> = {
  '`': { code: 'Backquote', keyCode: 192, shift: false, key: '`' },
  '~': { code: 'Backquote', keyCode: 192, shift: true, key: '~' },
  '-': { code: 'Minus', keyCode: 189, shift: false, key: '-' },
  _: { code: 'Minus', keyCode: 189, shift: true, key: '_' },
  '=': { code: 'Equal', keyCode: 187, shift: false, key: '=' },
  '+': { code: 'Equal', keyCode: 187, shift: true, key: '+' },
  '[': { code: 'BracketLeft', keyCode: 219, shift: false, key: '[' },
  '{': { code: 'BracketLeft', keyCode: 219, shift: true, key: '{' },
  ']': { code: 'BracketRight', keyCode: 221, shift: false, key: ']' },
  '}': { code: 'BracketRight', keyCode: 221, shift: true, key: '}' },
  '\\': { code: 'Backslash', keyCode: 220, shift: false, key: '\\' },
  '|': { code: 'Backslash', keyCode: 220, shift: true, key: '|' },
  ';': { code: 'Semicolon', keyCode: 186, shift: false, key: ';' },
  ':': { code: 'Semicolon', keyCode: 186, shift: true, key: ':' },
  "'": { code: 'Quote', keyCode: 222, shift: false, key: "'" },
  '"': { code: 'Quote', keyCode: 222, shift: true, key: '"' },
  ',': { code: 'Comma', keyCode: 188, shift: false, key: ',' },
  '<': { code: 'Comma', keyCode: 188, shift: true, key: '<' },
  '.': { code: 'Period', keyCode: 190, shift: false, key: '.' },
  '>': { code: 'Period', keyCode: 190, shift: true, key: '>' },
  '/': { code: 'Slash', keyCode: 191, shift: false, key: '/' },
  '?': { code: 'Slash', keyCode: 191, shift: true, key: '?' },
  '!': { code: 'Digit1', keyCode: 49, shift: true, key: '!' },
  '@': { code: 'Digit2', keyCode: 50, shift: true, key: '@' },
  '#': { code: 'Digit3', keyCode: 51, shift: true, key: '#' },
  $: { code: 'Digit4', keyCode: 52, shift: true, key: '$' },
  '%': { code: 'Digit5', keyCode: 53, shift: true, key: '%' },
  '^': { code: 'Digit6', keyCode: 54, shift: true, key: '^' },
  '&': { code: 'Digit7', keyCode: 55, shift: true, key: '&' },
  '*': { code: 'Digit8', keyCode: 56, shift: true, key: '*' },
  '(': { code: 'Digit9', keyCode: 57, shift: true, key: '(' },
  ')': { code: 'Digit0', keyCode: 48, shift: true, key: ')' },
};

function keyParamsForChar(ch: string): CdpKeyParams | null {
  if (ch.length !== 1) return null;
  const codePoint = ch.charCodeAt(0);
  // Only map plain ASCII printable to full key events. Non-ASCII
  // (CJK, emoji, etc.) is inserted via keyDown+text without a
  // meaningful virtual key code.
  if (codePoint > 0x7e || codePoint < 0x20) return null;

  if (ch >= 'a' && ch <= 'z') {
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: 0,
    };
  }
  if (ch >= 'A' && ch <= 'Z') {
    return {
      key: ch,
      code: `Key${ch}`,
      keyCode: ch.charCodeAt(0),
      modifiers: 8, // Shift
    };
  }
  if (ch >= '0' && ch <= '9') {
    return {
      key: ch,
      code: `Digit${ch}`,
      keyCode: ch.charCodeAt(0),
      modifiers: 0,
    };
  }
  if (ch === ' ') {
    return { key: ' ', code: 'Space', keyCode: 32, modifiers: 0 };
  }
  const sym = US_SYMBOL_KEYS[ch];
  if (sym) {
    return {
      key: sym.key,
      code: sym.code,
      keyCode: sym.keyCode,
      modifiers: sym.shift ? 8 : 0,
    };
  }
  // Unknown printable ASCII (tab etc.) — let the browser insert via
  // `text` but skip the key-code metadata.
  return null;
}

async function typeTextViaCdp(cdp: CdpCommander, text: string): Promise<void> {
  // Iterate by Unicode code points so surrogate pairs (emoji etc.)
  // go through as single `char` inserts instead of two lone halves.
  for (const ch of text) {
    const params = keyParamsForChar(ch);
    if (params) {
      await cdp.sendCommand(
        'Input.dispatchKeyEvent',
        {
          type: 'keyDown',
          key: params.key,
          code: params.code,
          text: ch,
          unmodifiedText: ch,
          windowsVirtualKeyCode: params.keyCode,
          nativeVirtualKeyCode: params.keyCode,
          modifiers: params.modifiers,
        },
        3000,
        0,
      );
      await cdp.sendCommand(
        'Input.dispatchKeyEvent',
        {
          type: 'keyUp',
          key: params.key,
          code: params.code,
          windowsVirtualKeyCode: params.keyCode,
          nativeVirtualKeyCode: params.keyCode,
          modifiers: params.modifiers,
        },
        3000,
        0,
      );
    } else {
      // Non-ASCII / composed chars: use `char` type which inserts
      // via the text input pipeline without a virtual key.
      await cdp.sendCommand(
        'Input.dispatchKeyEvent',
        { type: 'char', text: ch, key: ch, unmodifiedText: ch },
        3000,
        0,
      );
    }
  }
}

// ============================================================
// Hover State Store — remembers the last hovered element per
// conversation+tab so hover-revealed UI can be re-activated
// before confirmation screenshots.
// ============================================================
interface HoverState {
  selector: string;
  documentId: string;
  bbox: { x: number; y: number; width: number; height: number };
}

const hoverStateStore = new Map<string, HoverState>();

function hoverKey(conversationId: string, tabId: number): string {
  return `${conversationId}:${tabId}`;
}

/**
 * Re-fire hover events on the last-hovered element for a given
 * conversation + tab. This restores hover-dependent UI (e.g. video
 * player controls) that would otherwise disappear between the hover
 * action and a subsequent click confirmation screenshot.
 *
 * Silently no-ops if there is no stored hover state or the element
 * is gone/stale.
 */
export async function replayHoverState(
  conversationId: string,
  tabId: number,
  timeout: number = 3000,
): Promise<void> {
  const key = hoverKey(conversationId, tabId);
  const state = hoverStateStore.get(key);
  if (!state) return;

  // Move CDP virtual mouse to stored bbox center for CSS :hover persistence
  const bboxCenterX = state.bbox.x + state.bbox.width / 2;
  const bboxCenterY = state.bbox.y + state.bbox.height / 2;
  await moveTo(tabId, conversationId, bboxCenterX, bboxCenterY);

  const escapedSelector = escapeForDoubleQuotedJavaScriptString(state.selector);
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    state.documentId,
  );

  const script = `
    (function() {
      // Quick document-identity check
      const currentDocId = \`\${Math.trunc(performance.timeOrigin)}|\${location.href}\`;
      if ("${escapedDocumentId}" && currentDocId !== "${escapedDocumentId}") {
        return { replayed: false, reason: "document changed" };
      }

      const el = document.querySelector("${escapedSelector}");
      if (!el) {
        return { replayed: false, reason: "element gone" };
      }

      // Walk up to the element and re-fire the full hover event sequence
      // on both the element and its ancestors, to trigger CSS :hover
      // and framework listeners (React onMouseEnter, etc.)
      const targets = [el];
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        targets.push(parent);
        parent = parent.parentElement;
      }

      // Fire from outermost to innermost (mimics real mouse entry path)
      for (let i = targets.length - 1; i >= 0; i--) {
        const target = targets[i];
        target.dispatchEvent(new PointerEvent('pointerenter', {
          bubbles: false, cancelable: false, view: window,
          pointerType: 'mouse', isPrimary: true,
        }));
        target.dispatchEvent(new MouseEvent('mouseenter', {
          bubbles: false, cancelable: false, view: window,
        }));
      }

      // pointerover / mouseover bubble, so fire on the leaf only
      el.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true, cancelable: true, view: window,
        pointerType: 'mouse', isPrimary: true,
      }));
      el.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true, cancelable: true, view: window,
      }));

      return { replayed: true };
    })();
  `;

  try {
    const result = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      false,
      timeout,
    );
    const value = result.result?.value as
      | { replayed: boolean; reason?: string }
      | undefined;
    if (value?.replayed) {
      console.log(
        `🔄 [HoverReplay] Re-fired hover events on "${state.selector}"`,
      );
    } else {
      console.log(`🔄 [HoverReplay] Skipped: ${value?.reason || 'unknown'}`);
      // Clear stale hover state
      if (
        value?.reason === 'document changed' ||
        value?.reason === 'element gone'
      ) {
        hoverStateStore.delete(key);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [HoverReplay] Failed to replay hover:`, err);
  }
}

/**
 * Clear hover state for a conversation (optionally limited to a specific tab).
 */
export function clearHoverState(conversationId: string, tabId?: number): void {
  if (tabId !== undefined) {
    hoverStateStore.delete(hoverKey(conversationId, tabId));
  } else {
    // Clear all tabs for this conversation
    for (const key of hoverStateStore.keys()) {
      if (key.startsWith(`${conversationId}:`)) {
        hoverStateStore.delete(key);
      }
    }
  }
}

function buildResolvedElementResultFields(
  requestedElementId: string,
  resolvedElementId: string,
): Pick<
  ElementActionResult,
  | 'elementId'
  | 'requestedElementId'
  | 'resolvedElementId'
  | 'elementIdCorrected'
> {
  return {
    elementId: resolvedElementId,
    requestedElementId,
    resolvedElementId,
    elementIdCorrected: requestedElementId !== resolvedElementId,
  };
}

function buildCachedElementIdentityHelpersScript(): string {
  return `
    function normalizeIdentityWhitespace(value, maxLength = 240) {
      const normalized = String(value ?? '')
        .replace(/\\s+/g, ' ')
        .trim();
      return normalized.slice(0, maxLength).toLowerCase();
    }

    function getIdentityAttributeTokens(el, attributeNames) {
      const tokens = [];

      for (const attributeName of attributeNames) {
        const value = el.getAttribute(attributeName);
        if (!value) {
          continue;
        }

        const normalized = normalizeIdentityWhitespace(value, 80);
        if (normalized) {
          tokens.push(normalized);
        }
      }

      return tokens;
    }

    function getIdentityClassTokens(el) {
      return Array.from(el.classList)
        .filter(
          (token) =>
            token.length > 1 &&
            token.length <= 40 &&
            /^[a-z0-9_-]+$/i.test(token),
        )
        .slice(0, 4)
        .map((token) => token.toLowerCase());
    }

    function getElementTextForIdentity(el) {
      if (el instanceof HTMLInputElement) {
        const inputType = (el.type || '').toLowerCase();
        if (
          inputType === 'button' ||
          inputType === 'submit' ||
          inputType === 'reset'
        ) {
          return normalizeIdentityWhitespace(el.value, 120);
        }
      }

      return normalizeIdentityWhitespace(el.textContent || '', 160);
    }

    function getCurrentDocumentId() {
      return \`\${Math.trunc(performance.timeOrigin)}|\${location.href}\`;
    }

    function getElementFingerprint(el) {
      const tokens = [
        el.tagName.toLowerCase(),
        ...getIdentityAttributeTokens(el, [
          'role',
          'type',
          'name',
          'id',
          'aria-label',
          'title',
          'placeholder',
          'data-testid',
          'data-test-id',
        ]),
        ...getIdentityClassTokens(el),
      ];

      const text = getElementTextForIdentity(el);
      if (text) {
        tokens.push(text);
      }

      return normalizeIdentityWhitespace(tokens.join(' | '), 240);
    }

    function splitFingerprintTokens(value) {
      return Array.from(
        new Set(
          String(value ?? '')
            .toLowerCase()
            .split(/[^a-z0-9]+/i)
            .filter((token) => token.length > 1),
        ),
      );
    }

    function fingerprintsLookCompatible(expected, current) {
      if (!expected || !current) {
        return true;
      }

      if (expected === current) {
        return true;
      }

      const expectedTokens = splitFingerprintTokens(expected);
      const currentTokens = new Set(splitFingerprintTokens(current));
      if (expectedTokens.length === 0) {
        return true;
      }

      let overlap = 0;
      for (const token of expectedTokens) {
        if (currentTokens.has(token)) {
          overlap += 1;
        }
      }

      return overlap >= Math.max(2, Math.min(4, Math.ceil(expectedTokens.length * 0.5)));
    }

    function validateCachedElement(expectedDocumentId, expectedFingerprint, el) {
      const currentDocumentId = getCurrentDocumentId();
      if (expectedDocumentId && currentDocumentId !== expectedDocumentId) {
        return {
          ok: false,
          stale: true,
          error:
            'The cached element is stale because the document changed. Call highlight_elements() again.',
        };
      }

      const currentFingerprint = getElementFingerprint(el);
      if (!fingerprintsLookCompatible(expectedFingerprint, currentFingerprint)) {
        return {
          ok: false,
          stale: true,
          error:
            'The cached element is stale because the target no longer matches the cached identity. Call highlight_elements() again.',
        };
      }

      return {
        ok: true,
        stale: false,
        currentFingerprint,
      };
    }
  `;
}

function buildEditableActivationHelpersScript(): string {
  return `
    ${buildCachedElementIdentityHelpersScript()}
    ${buildHitTestVisibilityHelpersScript()}

    function getInteractiveActivationTarget(target) {
      if (!(target instanceof Element)) {
        return { target: null, point: null };
      }

      const rect = target.getBoundingClientRect();
      const samplePoints = getHitTestSamplePoints(rect);

      for (const point of samplePoints) {
        const stack = document.elementsFromPoint(point.x, point.y);
        for (const candidate of stack) {
          const normalized = normalizeHitTestElement(candidate);
          if (isRelatedHitTarget(normalized, target)) {
            return { target: normalized || target, point };
          }
        }
      }

      const fallbackPoint =
        samplePoints[0] || {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };

      return { target, point: fallbackPoint };
    }

    function resolveActivationDispatchTarget(target, activationTarget) {
      if (!(target instanceof Element)) {
        return activationTarget instanceof Element ? activationTarget : null;
      }

      if (!(activationTarget instanceof Element)) {
        return target;
      }

      // Placeholder covers for text inputs need the visible overlay surface.
      if (isPlaceholderCoverForInput(activationTarget, target)) {
        return activationTarget;
      }

      // If highlight selected a structured interactive element such as <a> or <button>,
      // keep dispatch on that exact element instead of drifting to a non-interactive ancestor.
      if (isStructuredInteractiveElement(target)) {
        return target;
      }

      if (isStructuredInteractiveElement(activationTarget)) {
        return activationTarget;
      }

      return activationTarget;
    }

    function getActivationEventPoint(target, point) {
      if (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      ) {
        return point;
      }

      const rect = target.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    function dispatchPointerEventForActivation(target, type, point) {
      if (!(target instanceof Element) || typeof PointerEvent !== 'function') {
        return;
      }

      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: point.x,
          clientY: point.y,
          view: window,
        }),
      );
    }

    function dispatchMouseEventForActivation(target, type, point) {
      if (!(target instanceof Element)) {
        return;
      }

      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
          clientX: point.x,
          clientY: point.y,
          view: window,
        }),
      );
    }

    function dispatchActivationPress(target, point) {
      if (!(target instanceof Element)) {
        return;
      }

      const eventPoint = getActivationEventPoint(target, point);
      dispatchPointerEventForActivation(target, 'pointerdown', eventPoint);
      dispatchMouseEventForActivation(target, 'mousedown', eventPoint);
    }

    function dispatchActivationRelease(target, point) {
      if (!(target instanceof Element)) {
        return;
      }

      const eventPoint = getActivationEventPoint(target, point);
      dispatchPointerEventForActivation(target, 'pointerup', eventPoint);
      dispatchMouseEventForActivation(target, 'mouseup', eventPoint);
      dispatchMouseEventForActivation(target, 'click', eventPoint);
    }

    function focusInteractionTarget(target) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      try {
        target.focus({ preventScroll: true });
      } catch (focusWithOptionsError) {
        try {
          target.focus();
        } catch (focusError) {
          return false;
        }
      }

      if (target.isContentEditable) {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }

      return (
        document.activeElement === target ||
        target.contains(document.activeElement)
      );
    }
  `;
}

/**
 * Result type for element click operation
 */
export interface ClickResult extends ElementActionResult {
  clicked: boolean;
  staleElement?: boolean;
  error?: string;
}

/**
 * Result type for element hover operation
 */
export interface HoverResult extends ElementActionResult {
  hovered: boolean;
  staleElement?: boolean;
  error?: string;
}

/**
 * Result type for file upload operation
 */
export interface UploadResult extends ElementActionResult {
  uploaded: boolean;
  staleElement?: boolean;
  error?: string;
}

/**
 * Result type for element select operation
 */
export interface SelectResult extends ElementActionResult {
  selected: boolean;
  staleElement?: boolean;
  error?: string;
  selectedValues?: string[];
  selectedLabels?: string[];
  selectedIndices?: number[];
}

/**
 * Perform a click on an element identified by its cached element_id
 *
 * Flow:
 * 1. Look up element from cache
 * 2. Build JavaScript to click with full event sequence
 * 3. Execute with dialog detection
 * 4. Return result with dialog info if applicable
 *
 * @param conversationId Session ID for element cache lookup
 * @param elementId Cached element ID from the latest highlight cache (for example, "A1H")
 * @param tabId Target tab ID
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Click result with success status and dialog info
 */
export async function performElementClick(
  conversationId: string,
  elementId: string,
  tabId: number,
  timeout: number = 30000,
): Promise<ClickResult> {
  console.log(
    `👆 [ElementClick] Clicking element ${elementId} in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Look up element from cache
  // ============================================================
  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [ElementClick] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      clicked: false,
      staleElement: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  console.log(
    `✅ [ElementClick] Found element: selector="${element.selector}"`,
  );

  // Move CDP virtual mouse to element center for CSS :hover persistence
  await moveToElement(tabId, conversationId, elementId);

  // ============================================================
  // STEP 2: Build JavaScript to click with full event sequence
  // ============================================================
  // Escape quotes in selector for safe injection
  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );

  const script = `
    (async function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      ${buildEditableActivationHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { clicked: false, error: "Element not found in DOM", stale: true };
      }

      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          clicked: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      // Check if element is still visible
      let rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { clicked: false, error: "Element is not visible", stale: false };
      }

      // Scroll element into view if needed
      if (rect.top < 0 || rect.bottom > window.innerHeight ||
          rect.left < 0 || rect.right > window.innerWidth) {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        rect = el.getBoundingClientRect();
      }

      const activeTopLayerRoot = getActiveTopLayerRoot();
      if (!isElementInActiveTopLayer(el, activeTopLayerRoot)) {
        return {
          clicked: false,
          error: "Element is outside the active top layer: " + describeElement(activeTopLayerRoot),
          stale: false
        };
      }

      const hitTestVisibility = getElementHitTestVisibility(el);
      if (!hitTestVisibility.visible) {
        return {
          clicked: false,
          error: "Element is occluded by " + (hitTestVisibility.occludedBy || "another element"),
          stale: false
        };
      }

      try {
        const activation = getInteractiveActivationTarget(el);
        const activationTarget =
          resolveActivationDispatchTarget(
            el,
            activation.target instanceof Element ? activation.target : el,
          ) || el;

        dispatchActivationPress(activationTarget, activation.point);
        const focused = focusInteractionTarget(
          el instanceof HTMLElement ? el : activationTarget,
        );
        dispatchActivationRelease(activationTarget, activation.point);

        return {
          clicked: true,
          focused,
          activationTarget: describeElement(activationTarget),
        };
      } catch (e) {
        return { clicked: false, error: e.message || String(e) };
      }
    })();
  `;

  // ============================================================
  // STEP 3: Execute JavaScript with dialog detection
  // ============================================================
  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      true,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementClick] JavaScript execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      clicked: false,
      staleElement: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // ============================================================
  // STEP 4: Process result (dialog handling deferred to screenshot)
  // ============================================================

  // Note: If dialog opened, we don't handle it here - it will be handled by captureScreenshot
  // We just return the JavaScript result as-is

  // Check for execution errors
  if (!jsResult.success) {
    console.log(`❌ [ElementClick] Click execution failed: ${jsResult.error}`);
    return {
      success: false,
      ...resolvedElementFields,
      clicked: false,
      staleElement: false,
      error: jsResult.error || 'Click JavaScript execution failed',
    };
  }

  // Debug: Log JavaScript result for diagnosis
  console.log(
    `🔍 [ElementClick] JavaScript result.value:`,
    JSON.stringify(jsResult.result?.value, null, 2),
  );
  console.log(`🔍 [ElementClick] Full JavaScript result:`, jsResult);

  // If a dialog opened during execution, treat as success with dialog info
  if (jsResult.dialog_opened) {
    console.log(
      `💬 [ElementClick] Dialog opened during click: ${jsResult.dialog?.type} - treating as successful click with dialog`,
    );
    const result: ClickResult = {
      success: true,
      ...resolvedElementFields,
      clicked: true,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  // Check the result from the script (only if no dialog opened)
  const clickResult = jsResult.result?.value as
    | { clicked: boolean; error?: string; stale?: boolean }
    | undefined;

  // Check result structure
  if (!jsResult.result?.value || typeof jsResult.result.value !== 'object') {
    const invalidResultError =
      jsResult.result?.subtype === 'promise'
        ? 'Click JavaScript returned an unresolved Promise instead of a resolved result'
        : 'Click JavaScript returned an invalid result structure';
    console.error(
      `❌ [ElementClick] Invalid JavaScript result.value structure:`,
      jsResult.result?.value,
    );
    return {
      success: false,
      ...resolvedElementFields,
      clicked: false,
      staleElement: false,
      error: invalidResultError,
    };
  }

  if (!clickResult?.clicked) {
    const isStale = clickResult?.stale === true;
    console.log(
      `❌ [ElementClick] Click failed: ${clickResult?.error || 'Unknown error'}, stale=${isStale}`,
    );

    return {
      success: false,
      ...resolvedElementFields,
      clicked: false,
      staleElement: isStale,
      error: clickResult?.error,
    };
  }

  console.log(`✅ [ElementClick] Click executed successfully`);

  // If dialog opened during click, propagate dialog info
  const result: ClickResult = {
    success: true,
    ...resolvedElementFields,
    clicked: true,
    new_tabs_created: jsResult.new_tabs_created,
  };

  if (jsResult.dialog_opened && jsResult.dialog) {
    result.dialogOpened = true;
    result.dialog = {
      type: jsResult.dialog.type as
        | 'alert'
        | 'confirm'
        | 'prompt'
        | 'beforeunload',
      message: jsResult.dialog.message,
    };
    console.log(
      `💬 [ElementClick] Propagating dialog info to screenshot: ${jsResult.dialog.type}`,
    );
  }

  return result;
}

/**
 * Perform a hover on an element identified by its cached element_id
 *
 * Flow:
 * 1. Look up element from cache
 * 2. Build JavaScript to dispatch hover events
 * 3. Execute JavaScript
 * 4. Return result
 *
 * @param conversationId Session ID for element cache lookup
 * @param elementId Cached element ID from the latest highlight cache (for example, "A1H")
 * @param tabId Target tab ID
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Hover result with success status
 */
export async function performElementHover(
  conversationId: string,
  elementId: string,
  tabId: number,
  timeout: number = 30000,
): Promise<HoverResult> {
  console.log(
    `🖱️ [ElementHover] Hovering element ${elementId} in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Look up element from cache
  // ============================================================
  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [ElementHover] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      hovered: false,
      staleElement: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  console.log(
    `✅ [ElementHover] Found element: selector="${element.selector}"`,
  );

  // Move CDP virtual mouse to element center for CSS :hover activation
  await moveToElement(tabId, conversationId, elementId);

  // ============================================================
  // STEP 2: Build JavaScript to dispatch hover events
  // ============================================================
  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );

  const script = `
    (function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      ${buildCachedElementIdentityHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { hovered: false, error: "Element not found in DOM", stale: true };
      }

      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          hovered: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      // Check if element is still visible
      const style = window.getComputedStyle(el);

      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { hovered: false, error: "Element is not visible", stale: false };
      }

      // Hover event sequence for React/Vue compatibility
      try {
        // Pointer events (enter/over)
        const pointerEnterEvents = ['pointerenter', 'pointerover'];
        for (const eventType of pointerEnterEvents) {
          const event = new PointerEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerType: 'mouse',
            isPrimary: true,
          });
          el.dispatchEvent(event);
        }

        // Mouse events (enter/over)
        const mouseEnterEvents = ['mouseenter', 'mouseover'];
        for (const eventType of mouseEnterEvents) {
          const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
          });
          el.dispatchEvent(event);
        }

        return { hovered: true };
      } catch (e) {
        return { hovered: false, error: e.message || String(e) };
      }
    })();
  `;

  // ============================================================
  // STEP 3: Execute JavaScript
  // ============================================================
  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementHover] JavaScript execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      hovered: false,
      staleElement: false,
    };
  }

  // ============================================================
  // STEP 4: Process result
  // ============================================================
  if (!jsResult.success) {
    console.log(`❌ [ElementHover] Hover execution failed: ${jsResult.error}`);
    return {
      success: false,
      ...resolvedElementFields,
      hovered: false,
      staleElement: false,
    };
  }

  // Debug: Log JavaScript result for diagnosis
  console.log(
    `🔍 [ElementHover] JavaScript result.value:`,
    JSON.stringify(jsResult.result?.value, null, 2),
  );
  console.log(`🔍 [ElementHover] Full JavaScript result:`, jsResult);

  // If a dialog opened during execution, treat as success with dialog info
  if (jsResult.dialog_opened) {
    console.log(
      `💬 [ElementHover] Dialog opened during hover: ${jsResult.dialog?.type} - treating as successful hover with dialog`,
    );
    const result: HoverResult = {
      success: true,
      ...resolvedElementFields,
      hovered: true,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  // Check the result from the script (only if no dialog opened)
  const hoverResult = jsResult.result?.value as
    | { hovered: boolean; error?: string; stale?: boolean }
    | undefined;

  if (!hoverResult?.hovered) {
    const isStale = hoverResult?.stale === true;
    console.log(
      `❌ [ElementHover] Hover failed: ${hoverResult?.error || 'Unknown error'}, stale=${isStale}`,
    );

    return {
      success: false,
      ...resolvedElementFields,
      hovered: false,
      staleElement: isStale,
    };
  }

  console.log(`✅ [ElementHover] Hover executed successfully`);

  // Store hover state so it can be replayed before confirmation screenshots
  hoverStateStore.set(hoverKey(conversationId, tabId), {
    selector: element.selector,
    documentId: cachedElement.documentId,
    bbox: { ...element.bbox },
  });

  // If dialog opened during hover, propagate dialog info
  const result: HoverResult = {
    success: true,
    ...resolvedElementFields,
    hovered: true,
  };

  if (jsResult.dialog_opened && jsResult.dialog) {
    result.dialogOpened = true;
    result.dialog = {
      type: jsResult.dialog.type as
        | 'alert'
        | 'confirm'
        | 'prompt'
        | 'beforeunload',
      message: jsResult.dialog.message,
    };
    console.log(
      `💬 [ElementHover] Propagating dialog info to screenshot: ${jsResult.dialog.type}`,
    );
  }

  return result;
}

/**
 * Scroll direction type
 */
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type SwipeDirection = 'next' | 'prev' | 'left' | 'right' | 'up' | 'down';

/**
 * Result type for element scroll operation
 */
export interface ScrollResult extends ElementActionResult {
  scrolled: boolean;
  /** Whether the scroll position actually changed */
  scrollEffective?: boolean;
  /** Warning message if scroll had no effect */
  warning?: string;
  scrollPosition?: { x: number; y: number };
  /** Scroll position before the scroll attempt */
  scrollPositionBefore?: { x: number; y: number };
  staleElement?: boolean;
  error?: string;
}

export interface SwipeResult extends ElementActionResult {
  swiped: boolean;
  swipeEffective?: boolean;
  warning?: string;
  method?: string;
  staleElement?: boolean;
  error?: string;
}

/**
 * Perform a scroll on an element identified by its cached element_id
 *
 * Flow:
 * 1. If elementId provided, look up element from cache
 * 2. Build JavaScript to scroll element or page
 * 3. Execute and return result
 *
 * @param conversationId Session ID for element cache lookup
 * @param elementId Cached element ID from the latest highlight cache. Optional - if not provided, scrolls the entire page
 * @param direction Swipe direction ('next' or 'prev')
 * @param tabId Target tab ID
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Scroll result with success status and scroll position
 */
export async function performElementScroll(
  conversationId: string,
  elementId: string | undefined,
  direction: ScrollDirection,
  tabId: number,
  scrollAmount: number = 0.5,
  timeout: number = 30000,
): Promise<ScrollResult> {
  console.log(
    `📜 [ElementScroll] Scrolling ${elementId ? `element ${elementId}` : 'entire page'} ${direction} (amount factor: ${scrollAmount}x current scroll target) in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Build JavaScript to scroll
  // ============================================================

  // Calculate scroll multipliers based on direction
  // scrollAmount is relative to the current scroll target's visible size.
  // For vertical scroll we use clientHeight; for horizontal scroll we use clientWidth.
  const scrollMultipliers: Record<ScrollDirection, { x: number; y: number }> = {
    up: { x: 0, y: -scrollAmount },
    down: { x: 0, y: scrollAmount },
    left: { x: -scrollAmount, y: 0 },
    right: { x: scrollAmount, y: 0 },
  };

  const { x: xMultiplier, y: yMultiplier } = scrollMultipliers[direction];

  let script: string;
  let resolvedElementFields:
    | ReturnType<typeof buildResolvedElementResultFields>
    | undefined;

  if (elementId) {
    // Scroll a specific element
    const cachedElement = elementCache.getElementById(
      conversationId,
      tabId,
      elementId,
    );
    if (!cachedElement) {
      console.log(`❌ [ElementScroll] Element ${elementId} not found in cache`);
      return {
        success: false,
        ...buildResolvedElementResultFields(elementId, elementId),
        scrolled: false,
        error: buildElementCacheMissMessage({
          conversationId,
          tabId,
          elementId,
        }),
      };
    }
    const element = cachedElement.element;
    resolvedElementFields = buildResolvedElementResultFields(
      cachedElement.requestedElementId,
      cachedElement.resolvedElementId,
    );

    console.log(
      `✅ [ElementScroll] Found element: selector="${element.selector}"`,
    );
    const escapedSelector = escapeForDoubleQuotedJavaScriptString(
      element.selector,
    );
    const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
      cachedElement.documentId,
    );
    const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
      element.fingerprint || '',
    );

    script = `
      (function() {
        const selector = "${escapedSelector}";
        const expectedDocumentId = "${escapedDocumentId}";
        const expectedFingerprint = "${escapedFingerprint}";
        const el = document.querySelector(selector);
        const xMultiplier = ${xMultiplier};
        const yMultiplier = ${yMultiplier};
        ${buildCachedElementIdentityHelpersScript()}

        if (!el) {
          return { scrolled: false, error: "Element not found in DOM", stale: true };
        }

        const snapshotValidation = validateCachedElement(
          expectedDocumentId,
          expectedFingerprint,
          el,
        );
        if (!snapshotValidation.ok) {
          return {
            scrolled: false,
            error: snapshotValidation.error,
            stale: snapshotValidation.stale,
          };
        }

        // Determine the scrollable element
        // For page-level elements, use document.scrollingElement
        // For containers, use the element itself if it's scrollable
        let scrollTarget = el;

        // Check if this is a page-level selector (html, body, or document)
        const isPageLevel = selector === 'html' || selector === 'body' ||
                            selector.includes('document.scrollingElement');

        if (isPageLevel) {
          scrollTarget = document.scrollingElement || document.documentElement;
        } else {
          // Check if element itself is scrollable (包括overflow:hidden但实际可滚动的元素)
          const style = window.getComputedStyle(el);
          const overflow = style.overflow + style.overflowY + style.overflowX;
          const hasScrollStyle = overflow.includes('auto') || overflow.includes('scroll');
          const isHiddenButScrollable = style.overflow === 'hidden' &&
            (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
          const isScrollable = (hasScrollStyle || isHiddenButScrollable) &&
            (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);

          // If not scrollable, try to find a scrollable parent or use page
          if (!isScrollable) {
            scrollTarget = document.scrollingElement || document.documentElement;
          }
        }

        try {
          // Calculate scroll amount based on element/viewport dimensions
          const scrollHeight = scrollTarget.clientHeight || window.innerHeight;
          const scrollWidth = scrollTarget.clientWidth || window.innerWidth;
          
          const scrollX = Math.round(scrollWidth * xMultiplier);
          const scrollY = Math.round(scrollHeight * yMultiplier);
          
          // Capture scroll position BEFORE scrolling
          const beforeX = scrollTarget.scrollLeft;
          const beforeY = scrollTarget.scrollTop;
          
          // Use scrollBy for smooth relative scrolling
          scrollTarget.scrollBy({
            left: scrollX,
            top: scrollY,
            behavior: 'instant'
          });

          // Capture scroll position AFTER scrolling
          const afterX = scrollTarget.scrollLeft;
          const afterY = scrollTarget.scrollTop;
          
          // Verify if scroll actually happened
          const scrollEffective = (afterX !== beforeX) || (afterY !== beforeY);

          return {
            scrolled: true,
            scrollEffective,
            scrollPosition: { x: afterX, y: afterY },
            scrollPositionBefore: { x: beforeX, y: beforeY },
            scrollAmount: {
              x: scrollX,
              y: scrollY,
              viewportHeight: scrollHeight,
              viewportWidth: scrollWidth
            },
            ...(scrollEffective ? {} : { reason: "Scroll had no effect - may already be at boundary" })
          };
        } catch (e) {
          return { scrolled: false, error: e.message || String(e) };
        }
      })();
    `;
  } else {
    // Scroll the entire page (no element_id provided)
    script = `
      (function() {
        // Use document.scrollingElement for cross-browser compatibility
        const scrollTarget = document.scrollingElement || document.documentElement;
        const xMultiplier = ${xMultiplier};
        const yMultiplier = ${yMultiplier};

        try {
          // Calculate scroll amount based on viewport dimensions
          const scrollHeight = scrollTarget.clientHeight || window.innerHeight;
          const scrollWidth = scrollTarget.clientWidth || window.innerWidth;
          
          const scrollX = Math.round(scrollWidth * xMultiplier);
          const scrollY = Math.round(scrollHeight * yMultiplier);
          
          // Capture scroll position BEFORE scrolling
          const beforeX = scrollTarget.scrollLeft;
          const beforeY = scrollTarget.scrollTop;
          
          scrollTarget.scrollBy({
            left: scrollX,
            top: scrollY,
            behavior: 'instant'
          });

          // Capture scroll position AFTER scrolling
          const afterX = scrollTarget.scrollLeft;
          const afterY = scrollTarget.scrollTop;
          
          // Verify if scroll actually happened
          const scrollEffective = (afterX !== beforeX) || (afterY !== beforeY);

          return {
            scrolled: true,
            scrollEffective,
            scrollPosition: { x: afterX, y: afterY },
            scrollPositionBefore: { x: beforeX, y: beforeY },
            scrollAmount: {
              x: scrollX,
              y: scrollY,
              viewportHeight: scrollHeight,
              viewportWidth: scrollWidth
            },
            ...(scrollEffective ? {} : { reason: "Page scroll had no effect - may already be at boundary" })
          };
        } catch (e) {
          return { scrolled: false, error: e.message || String(e) };
        }
      })();
    `;
  }

  // ============================================================
  // STEP 2: Execute JavaScript
  // ============================================================
  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementScroll] JavaScript execution error:`, error);
    return {
      success: false,
      ...(resolvedElementFields ??
        (elementId
          ? buildResolvedElementResultFields(elementId, elementId)
          : {})),
      scrolled: false,
    };
  }

  // Check for execution errors
  if (!jsResult.success) {
    console.log(
      `❌ [ElementScroll] Scroll execution failed: ${jsResult.error}`,
    );
    return {
      success: false,
      ...(resolvedElementFields ??
        (elementId
          ? buildResolvedElementResultFields(elementId, elementId)
          : {})),
      scrolled: false,
    };
  }

  // Debug: Log JavaScript result for diagnosis
  console.log(
    `🔍 [ElementScroll] JavaScript result.value:`,
    JSON.stringify(jsResult.result?.value, null, 2),
  );
  console.log(`🔍 [ElementScroll] Full JavaScript result:`, jsResult);

  // If a dialog opened during execution, treat as success with dialog info
  if (jsResult.dialog_opened) {
    console.log(
      `💬 [ElementScroll] Dialog opened during scroll: ${jsResult.dialog?.type} - treating as successful scroll with dialog`,
    );
    const result: ScrollResult = {
      success: true,
      ...(resolvedElementFields ??
        (elementId
          ? buildResolvedElementResultFields(elementId, elementId)
          : {})),
      scrolled: true,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  // Check the result from the script (only if no dialog opened)
  const scrollResult = jsResult.result?.value as
    | {
        scrolled: boolean;
        scrollEffective?: boolean;
        reason?: string;
        error?: string;
        stale?: boolean;
        scrollPosition?: { x: number; y: number };
        scrollPositionBefore?: { x: number; y: number };
      }
    | undefined;

  if (!scrollResult?.scrolled) {
    const isStale = scrollResult?.stale === true;
    console.log(
      `❌ [ElementScroll] Scroll failed: ${scrollResult?.error || 'Unknown error'}, stale=${isStale}`,
    );

    return {
      success: false,
      ...(resolvedElementFields ??
        (elementId
          ? buildResolvedElementResultFields(elementId, elementId)
          : {})),
      scrolled: false,
      staleElement: isStale,
    };
  }

  const scrollEffective = scrollResult.scrollEffective !== false;
  const warning = scrollResult.reason;

  if (!scrollEffective) {
    console.log(
      `⚠️ [ElementScroll] Scroll executed but had no effect: ${warning}`,
    );
  } else {
    console.log(`✅ [ElementScroll] Scroll executed successfully`);
  }

  const result: ScrollResult = {
    success: true,
    ...(resolvedElementFields ??
      (elementId
        ? buildResolvedElementResultFields(elementId, elementId)
        : {})),
    scrolled: true,
    scrollEffective,
    ...(warning ? { warning } : {}),
    scrollPosition: scrollResult.scrollPosition,
    scrollPositionBefore: scrollResult.scrollPositionBefore,
  };

  if (jsResult.dialog_opened && jsResult.dialog) {
    result.dialogOpened = true;
    result.dialog = {
      type: jsResult.dialog.type as
        | 'alert'
        | 'confirm'
        | 'prompt'
        | 'beforeunload',
      message: jsResult.dialog.message,
    };
    console.log(
      `💬 [ElementScroll] Propagating dialog info to screenshot: ${jsResult.dialog.type}`,
    );
  }

  return result;
}

/**
 * Perform a swipe on an element identified by its cached element_id.
 *
 * This is designed for carousel / swiper / slider style regions. It first tries
 * framework APIs (Swiper/Embla/Splide/etc.), then next/prev buttons, then a
 * scrollBy fallback for scroll-snap style containers.
 */
export async function performElementSwipe(
  conversationId: string,
  elementId: string,
  direction: SwipeDirection,
  tabId: number,
  swipeCount: number = 1,
  timeout: number = 30000,
): Promise<SwipeResult> {
  console.log(
    `🫳 [ElementSwipe] Swiping element ${elementId} ${direction} (count: ${swipeCount}) in conversation ${conversationId} on tab ${tabId}`,
  );

  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [ElementSwipe] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      swiped: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  console.log(
    `✅ [ElementSwipe] Found element: selector="${element.selector}"`,
  );

  // Move CDP virtual mouse to element center for CSS :hover persistence
  await moveToElement(tabId, conversationId, elementId);

  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );

  const script = `
    (async function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      const direction = "${direction}";
      const swipeCount = ${swipeCount};
      ${buildCachedElementIdentityHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { swiped: false, error: "Element not found in DOM", stale: true };
      }

      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          swiped: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      const SWIPE_LIBRARY_REGEX =
        /\\b(swiper|carousel|slider|slides?|embla|splide|slick|flickity|glide|keen-slider|tns)\\b/i;

      function hasCallableMethod(value, methodNames) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
          return false;
        }

        return methodNames.some((methodName) => typeof value[methodName] === 'function');
      }

      function isVisible(node) {
        if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) {
          return false;
        }

        const style = window.getComputedStyle(node);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function getClassTokens(node) {
        if (!(node instanceof HTMLElement)) {
          return [];
        }

        return Array.from(node.classList)
          .filter((token) => token.length > 1 && token.length <= 40)
          .slice(0, 8);
      }

      function getAttributeTextTokens(node, attributeNames) {
        const tokens = [];

        for (const attributeName of attributeNames) {
          const value = node.getAttribute(attributeName);
          if (value) {
            tokens.push(String(value));
          }
        }

        return tokens;
      }

      function getMarkerText(node) {
        if (!(node instanceof HTMLElement)) {
          return '';
        }

        return [
          node.tagName.toLowerCase(),
          node.id || '',
          ...getClassTokens(node),
          ...getAttributeTextTokens(node, [
            'role',
            'aria-label',
            'aria-roledescription',
            'data-swiper',
            'data-carousel',
            'data-slider',
            'data-testid',
          ]),
        ].join(' ').toLowerCase();
      }

      function getSwipeApi(node) {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const candidates = [
          node.swiper,
          node.__swiper__,
          node.embla,
          node._splide,
          node.flickity,
          node.keenSlider,
          node.glide,
        ];

        return candidates.find((candidate) =>
          hasCallableMethod(candidate, [
            'slideNext',
            'slidePrev',
            'slideTo',
            'next',
            'prev',
            'scrollNext',
            'scrollPrev',
            'scrollTo',
            'go',
            'moveToIdx',
          ]),
        ) || null;
      }

      async function waitForMicrotaskCheckpoint() {
        await Promise.resolve();
        await Promise.resolve();
      }

      function hasSwipeLikeLayout(node, axis) {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 80) {
          return false;
        }

        const style = window.getComputedStyle(node);
        const overflowAxis =
          axis === 'x'
            ? \`\${style.overflow} \${style.overflowX}\`.toLowerCase()
            : \`\${style.overflow} \${style.overflowY}\`.toLowerCase();
        const constrainsOverflow =
          overflowAxis.includes('hidden') ||
          overflowAxis.includes('clip') ||
          overflowAxis.includes('scroll') ||
          overflowAxis.includes('auto');

        const visibleChildren = Array.from(node.children).filter(
          (child) => child instanceof HTMLElement && isVisible(child),
        );
        if (visibleChildren.length < 1) {
          return false;
        }

        const primaryTrack =
          visibleChildren.find((child) => {
            if (!(child instanceof HTMLElement)) {
              return false;
            }
            const childStyle = window.getComputedStyle(child);
            return (
              childStyle.transform !== 'none' ||
              childStyle.display.includes('flex') ||
              childStyle.whiteSpace === 'nowrap'
            );
          }) || (visibleChildren[0] instanceof HTMLElement ? visibleChildren[0] : null);

        if (!(primaryTrack instanceof HTMLElement)) {
          return false;
        }

        const trackChildren = Array.from(primaryTrack.children).filter(
          (child) => child instanceof HTMLElement && isVisible(child),
        );
        if (trackChildren.length < 2) {
          return false;
        }

        let progression = 0;
        let aligned = 0;
        let previousRect = null;

        for (const child of trackChildren.slice(0, 6)) {
          if (!(child instanceof HTMLElement)) {
            continue;
          }

          const childRect = child.getBoundingClientRect();
          if (previousRect) {
            if (axis === 'x') {
              if (childRect.left > previousRect.left + 12) {
                progression += 1;
              }
              if (Math.abs(childRect.top - previousRect.top) <= Math.max(24, rect.height * 0.2)) {
                aligned += 1;
              }
            } else {
              if (childRect.top > previousRect.top + 12) {
                progression += 1;
              }
              if (Math.abs(childRect.left - previousRect.left) <= Math.max(24, rect.width * 0.2)) {
                aligned += 1;
              }
            }
          }
          previousRect = childRect;
        }

        const canScrollAxis =
          axis === 'x'
            ? primaryTrack.scrollWidth > node.clientWidth + 24
            : primaryTrack.scrollHeight > node.clientHeight + 24;

        return constrainsOverflow && canScrollAxis && progression >= 1 && aligned >= 1;
      }

      function findSwipeDescendant(root, axis, maxDepth = 3, maxNodes = 60) {
        if (!(root instanceof HTMLElement)) {
          return null;
        }

        const queue = Array.from(root.children).map((child) => ({
          node: child,
          depth: 1,
        }));
        let visited = 0;

        while (queue.length > 0 && visited < maxNodes) {
          const current = queue.shift();
          if (!current || current.depth > maxDepth) {
            continue;
          }

          const node = current.node;
          if (!(node instanceof HTMLElement) || !isVisible(node)) {
            continue;
          }

          visited += 1;

          const api = getSwipeApi(node);
          if (api) {
            return { container: node, api };
          }

          const markerText = getMarkerText(node);
          if (
            SWIPE_LIBRARY_REGEX.test(markerText) &&
            (hasSwipeLikeLayout(node, axis) || markerText.includes('swiper'))
          ) {
            return { container: node, api: null };
          }

          if (hasSwipeLikeLayout(node, axis)) {
            return { container: node, api: null };
          }

          for (const child of Array.from(node.children)) {
            queue.push({ node: child, depth: current.depth + 1 });
          }
        }

        return null;
      }

      function findSwipeContext(start, axis, maxDepth = 4) {
        let current =
          start instanceof HTMLElement
            ? start
            : start instanceof SVGElement
              ? start.parentElement
              : null;
        let depth = 0;

        while (current && current !== document.body && depth <= maxDepth) {
          const api = getSwipeApi(current);
          if (api) {
            return { container: current, api };
          }

          const markerText = getMarkerText(current);
          if (
            SWIPE_LIBRARY_REGEX.test(markerText) &&
            (hasSwipeLikeLayout(current, axis) || markerText.includes('swiper'))
          ) {
            return { container: current, api: null };
          }

          if (hasSwipeLikeLayout(current, axis)) {
            return { container: current, api: null };
          }

          const descendantMatch = findSwipeDescendant(current, axis);
          if (descendantMatch) {
            return descendantMatch;
          }

          current = current.parentElement;
          depth += 1;
        }

        return null;
      }

      function getIndex(api) {
        if (!api) {
          return null;
        }
        if (typeof api.activeIndex === 'number') {
          return api.activeIndex;
        }
        if (typeof api.selectedScrollSnap === 'function') {
          return api.selectedScrollSnap();
        }
        if (typeof api.index === 'number') {
          return api.index;
        }
        if (api.track && typeof api.track.details?.rel === 'number') {
          return api.track.details.rel;
        }
        return null;
      }

      function isNavigationControl(node, forward, axis) {
        if (!(node instanceof HTMLElement) || !isVisible(node)) {
          return false;
        }

        const markerText = getMarkerText(node);
        if (
          markerText.includes('swiper-slide-next') ||
          markerText.includes('swiper-slide-prev') ||
          markerText.includes('swiper-slide-duplicate')
        ) {
          return false;
        }

        const directionTokens = forward
          ? axis === 'x'
            ? ['next', 'right', 'forward']
            : ['next', 'down', 'forward']
          : axis === 'x'
            ? ['prev', 'previous', 'left', 'back']
            : ['prev', 'previous', 'up', 'back'];

        const hasDirectionToken = directionTokens.some((token) =>
          markerText.includes(token),
        );
        if (!hasDirectionToken) {
          return false;
        }

        const style = window.getComputedStyle(node);
        const semanticControl =
          node.tagName === 'BUTTON' ||
          node.getAttribute('role') === 'button' ||
          node.tabIndex >= 0 ||
          style.cursor === 'pointer';
        const explicitControlMarker =
          markerText.includes('arrow') ||
          markerText.includes('btn') ||
          markerText.includes('button') ||
          markerText.includes('controller');

        return semanticControl || explicitControlMarker;
      }

      function getNavButton(container, forward, axis) {
        const candidates = container.querySelectorAll(
          '.swiper-button-next, .swiper-button-prev, .arrow-controller, .btn-wrapper, button, [role="button"], [aria-label], [class*="arrow" i], [class*="btn" i]',
        );

        for (const candidate of candidates) {
          if (
            candidate instanceof HTMLElement &&
            isNavigationControl(candidate, forward, axis)
          ) {
            return candidate;
          }
        }

        return null;
      }

      const axis = 'x';
      const forward = direction === 'next';
      const context = findSwipeContext(el, axis) || {
        container: el instanceof HTMLElement ? el : el.parentElement,
        api: null,
      };

      if (!context || !(context.container instanceof HTMLElement)) {
        return {
          swiped: false,
          error: "No swipeable container found for element",
          stale: false,
        };
      }

      const container = context.container;
      const api = context.api;

      const fallbackScrollTarget =
        axis === 'x'
          ? container.scrollWidth > container.clientWidth
            ? container
            : container.parentElement && container.parentElement.scrollWidth > container.parentElement.clientWidth
              ? container.parentElement
              : container
          : container.scrollHeight > container.clientHeight
            ? container
            : container.parentElement && container.parentElement.scrollHeight > container.parentElement.clientHeight
              ? container.parentElement
              : container;
      const containerMarkerText = getMarkerText(container);
      const fallbackMarkerText =
        fallbackScrollTarget instanceof HTMLElement
          ? getMarkerText(fallbackScrollTarget)
          : '';
      const canUseScrollFallback =
        hasSwipeLikeLayout(container, axis) ||
        (fallbackScrollTarget instanceof HTMLElement &&
          hasSwipeLikeLayout(fallbackScrollTarget, axis)) ||
        SWIPE_LIBRARY_REGEX.test(containerMarkerText) ||
        SWIPE_LIBRARY_REGEX.test(fallbackMarkerText);

      function getActiveSlideSignature(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return null;
        }

        const activeSlide = currentContainer.querySelector(
          '.swiper-slide-active, [aria-current="true"], .is-active, .active',
        );
        if (!(activeSlide instanceof HTMLElement)) {
          return null;
        }

        return (
          activeSlide.getAttribute('data-swiper-slide-index') ||
          activeSlide.getAttribute('data-index') ||
          activeSlide.getAttribute('aria-label') ||
          activeSlide.textContent?.trim().slice(0, 80) ||
          null
        );
      }

      function getFractionText(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return null;
        }

        const fractionNode = currentContainer.querySelector('.fraction, .swiper-pagination-fraction');
        if (!(fractionNode instanceof HTMLElement)) {
          return null;
        }

        return fractionNode.textContent?.trim() || null;
      }

      function getTrackTransform(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return null;
        }

        const wrapper = currentContainer.querySelector('.swiper-wrapper');
        if (!(wrapper instanceof HTMLElement)) {
          return null;
        }

        return wrapper.style.transform || window.getComputedStyle(wrapper).transform || null;
      }

      function captureVisualState(currentContainer, currentApi, currentFallbackTarget) {
        return {
          apiIndex: getIndex(currentApi),
          scrollLeft: currentFallbackTarget.scrollLeft,
          scrollTop: currentFallbackTarget.scrollTop,
          activeSlide: getActiveSlideSignature(currentContainer),
          fractionText: getFractionText(currentContainer),
          trackTransform: getTrackTransform(currentContainer),
        };
      }

      function hasVisualStateChanged(previousState, nextState) {
        return (
          (previousState.apiIndex !== null &&
            nextState.apiIndex !== null &&
            previousState.apiIndex !== nextState.apiIndex) ||
          previousState.scrollLeft !== nextState.scrollLeft ||
          previousState.scrollTop !== nextState.scrollTop ||
          previousState.activeSlide !== nextState.activeSlide ||
          previousState.fractionText !== nextState.fractionText ||
          previousState.trackTransform !== nextState.trackTransform
        );
      }

      function isRectInViewport(rect) {
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth
        );
      }

      function countPendingMedia(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return 0;
        }

        let pending = 0;
        for (const media of currentContainer.querySelectorAll('img, video')) {
          if (!(media instanceof HTMLElement)) {
            continue;
          }

          const rect = media.getBoundingClientRect();
          if (!isRectInViewport(rect) || !isVisible(media)) {
            continue;
          }

          if (media.tagName === 'IMG') {
            const image = media;
            if ('complete' in image && !image.complete) {
              pending += 1;
              continue;
            }
            if ('naturalWidth' in image && image.naturalWidth === 0) {
              pending += 1;
              continue;
            }
          }

          if (media.tagName === 'VIDEO' && 'readyState' in media && media.readyState < 2) {
            pending += 1;
          }
        }

        return pending;
      }

      function countLoadingPlaceholders(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return 0;
        }

        return currentContainer.querySelectorAll(
          '[class*="skeleton" i], [class*="shimmer" i], [class*="placeholder" i], [class*="loading" i], [data-loading="true"]',
        ).length;
      }

      async function waitForSwipeToSettle(
        previousState,
        currentContainer,
        currentApi,
        currentFallbackTarget,
      ) {
        await waitForMicrotaskCheckpoint();

        let currentState = captureVisualState(
          currentContainer,
          currentApi,
          currentFallbackTarget,
        );
        let pendingMedia = countPendingMedia(currentContainer);
        let placeholders = countLoadingPlaceholders(currentContainer);

        if (
          !hasVisualStateChanged(previousState, currentState) ||
          pendingMedia > 0 ||
          placeholders > 0
        ) {
          await waitForMicrotaskCheckpoint();
          currentState = captureVisualState(
            currentContainer,
            currentApi,
            currentFallbackTarget,
          );
          pendingMedia = countPendingMedia(currentContainer);
          placeholders = countLoadingPlaceholders(currentContainer);
        }

        return currentState;
      }

      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function dispatchPointerEvent(target, type, clientX, clientY, pointerId) {
        if (!(target instanceof Element) || typeof PointerEvent !== 'function') {
          return false;
        }

        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          }),
        );
        return true;
      }

      function dispatchMouseEvent(target, type, clientX, clientY) {
        if (!(target instanceof Element)) {
          return false;
        }

        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            buttons: type === 'mouseup' ? 0 : 1,
            button: 0,
            clientX,
            clientY,
          }),
        );
        return true;
      }

      function dispatchTouchEvent(target, type, clientX, clientY) {
        if (
          !(target instanceof Element) ||
          typeof Touch !== 'function' ||
          typeof TouchEvent !== 'function'
        ) {
          return false;
        }

        const touch = new Touch({
          identifier: 1,
          target,
          clientX,
          clientY,
          pageX: clientX + window.scrollX,
          pageY: clientY + window.scrollY,
          screenX: window.screenX + clientX,
          screenY: window.screenY + clientY,
          radiusX: 12,
          radiusY: 12,
          rotationAngle: 0,
          force: type === 'touchend' ? 0 : 0.5,
        });

        const activeTouches = type === 'touchend' ? [] : [touch];
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            touches: activeTouches,
            targetTouches: activeTouches,
            changedTouches: [touch],
          }),
        );
        return true;
      }

      function getGestureTarget(currentContainer) {
        if (!(currentContainer instanceof HTMLElement)) {
          return null;
        }

        const explicitTrack = currentContainer.querySelector(
          '.swiper-wrapper, .swiper, [class*="track" i], [class*="slider" i], [class*="carousel" i]',
        );
        if (explicitTrack instanceof HTMLElement && isVisible(explicitTrack)) {
          return explicitTrack;
        }

        return currentContainer;
      }

      async function performGestureSwipe(target, moveForward, axis) {
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        const rect = target.getBoundingClientRect();
        if (!isRectInViewport(rect) || rect.width < 60 || rect.height < 60) {
          return false;
        }

        const pointerId = 1;
        const horizontal = axis === 'x';
        const travelDistance = Math.round(
          clamp(
            (horizontal ? rect.width : rect.height) * 0.42,
            72,
            horizontal ? Math.min(rect.width - 24, 320) : Math.min(rect.height - 24, 240),
          ),
        );

        const centerX = clamp(rect.left + rect.width / 2, 12, window.innerWidth - 12);
        const centerY = clamp(rect.top + rect.height / 2, 12, window.innerHeight - 12);

        const startX = horizontal
          ? clamp(
              centerX + (moveForward ? travelDistance / 2 : -travelDistance / 2),
              12,
              window.innerWidth - 12,
            )
          : centerX;
        const endX = horizontal
          ? clamp(
              centerX + (moveForward ? -travelDistance / 2 : travelDistance / 2),
              12,
              window.innerWidth - 12,
            )
          : centerX;
        const startY = horizontal
          ? centerY
          : clamp(
              centerY + (moveForward ? travelDistance / 2 : -travelDistance / 2),
              12,
              window.innerHeight - 12,
            );
        const endY = horizontal
          ? centerY
          : clamp(
              centerY + (moveForward ? -travelDistance / 2 : travelDistance / 2),
              12,
              window.innerHeight - 12,
            );

        const startTarget = document.elementFromPoint(startX, startY);
        const initialTarget = startTarget instanceof Element ? startTarget : target;
        dispatchPointerEvent(initialTarget, 'pointerdown', startX, startY, pointerId);
        dispatchMouseEvent(initialTarget, 'mousedown', startX, startY);
        dispatchTouchEvent(initialTarget, 'touchstart', startX, startY);

        const steps = 6;
        for (let step = 1; step <= steps; step++) {
          const progress = step / steps;
          const x = startX + (endX - startX) * progress;
          const y = startY + (endY - startY) * progress;
          const moveTarget = document.elementFromPoint(x, y);
          const activeTarget = moveTarget instanceof Element ? moveTarget : target;

          dispatchPointerEvent(activeTarget, 'pointermove', x, y, pointerId);
          dispatchMouseEvent(activeTarget, 'mousemove', x, y);
          dispatchTouchEvent(activeTarget, 'touchmove', x, y);
          await waitForMicrotaskCheckpoint();
        }

        const endTarget = document.elementFromPoint(endX, endY);
        const finalTarget = endTarget instanceof Element ? endTarget : target;
        dispatchPointerEvent(finalTarget, 'pointerup', endX, endY, pointerId);
        dispatchMouseEvent(finalTarget, 'mouseup', endX, endY);
        dispatchTouchEvent(finalTarget, 'touchend', endX, endY);

        await waitForMicrotaskCheckpoint();
        return true;
      }

      const beforeState = captureVisualState(container, api, fallbackScrollTarget);

      let invoked = 0;
      let effectiveSteps = 0;
      let method = 'none';
      let error = null;

      function tryInvoke(method) {
        try {
          method();
          return true;
        } catch (_error) {
          return false;
        }
      }

      function invokeSwipeApiStep(currentApi, moveForward) {
        if (!currentApi) {
          return null;
        }

        if (moveForward) {
          if (typeof currentApi.slideNext === 'function') {
            if (!tryInvoke(() => currentApi.slideNext(0))) {
              currentApi.slideNext();
            }
            return 'slideNext';
          }
          if (typeof currentApi.scrollNext === 'function') {
            if (!tryInvoke(() => currentApi.scrollNext(true))) {
              currentApi.scrollNext();
            }
            return 'scrollNext';
          }
          if (typeof currentApi.next === 'function') {
            currentApi.next();
            return 'next';
          }
        } else {
          if (typeof currentApi.slidePrev === 'function') {
            if (!tryInvoke(() => currentApi.slidePrev(0))) {
              currentApi.slidePrev();
            }
            return 'slidePrev';
          }
          if (typeof currentApi.scrollPrev === 'function') {
            if (!tryInvoke(() => currentApi.scrollPrev(true))) {
              currentApi.scrollPrev();
            }
            return 'scrollPrev';
          }
          if (typeof currentApi.prev === 'function') {
            currentApi.prev();
            return 'prev';
          }
        }

        const currentIndex = getIndex(currentApi);
        if (typeof currentApi.slideTo === 'function' && typeof currentIndex === 'number') {
          const targetIndex = Math.max(0, currentIndex + (moveForward ? 1 : -1));
          if (!tryInvoke(() => currentApi.slideTo(targetIndex, 0))) {
            currentApi.slideTo(targetIndex);
          }
          return 'slideTo';
        }
        if (typeof currentApi.scrollTo === 'function' && typeof currentIndex === 'number') {
          const targetIndex = Math.max(0, currentIndex + (moveForward ? 1 : -1));
          if (!tryInvoke(() => currentApi.scrollTo(targetIndex, true))) {
            currentApi.scrollTo(targetIndex);
          }
          return 'scrollTo';
        }
        if (typeof currentApi.moveToIdx === 'function' && typeof currentIndex === 'number') {
          currentApi.moveToIdx(Math.max(0, currentIndex + (moveForward ? 1 : -1)));
          return 'moveToIdx';
        }
        if (typeof currentApi.go === 'function') {
          currentApi.go(moveForward ? '>' : '<');
          return 'go';
        }

        return null;
      }

      for (let i = 0; i < swipeCount; i++) {
        const stepBeforeState = captureVisualState(container, api, fallbackScrollTarget);
        let stepMethod = null;
        let stepChanged = false;

        const apiMethod = invokeSwipeApiStep(api, forward);
        if (apiMethod) {
          stepMethod = apiMethod;
          const settledState = await waitForSwipeToSettle(
            stepBeforeState,
            container,
            api,
            fallbackScrollTarget,
          );
          stepChanged = hasVisualStateChanged(stepBeforeState, settledState);
        }

        if (!stepChanged) {
          const navButton = getNavButton(container, forward, axis);
          if (navButton) {
            navButton.click();
            stepMethod = 'navButton';
            const settledState = await waitForSwipeToSettle(
              stepBeforeState,
              container,
              api,
              fallbackScrollTarget,
            );
            stepChanged = hasVisualStateChanged(stepBeforeState, settledState);
          }
        }

        if (!stepChanged) {
          const gestureTarget = getGestureTarget(container);
          const gestureInvoked = await performGestureSwipe(
            gestureTarget,
            forward,
            axis,
          );
          if (gestureInvoked) {
            stepMethod = 'gesture';
            const settledState = await waitForSwipeToSettle(
              stepBeforeState,
              container,
              api,
              fallbackScrollTarget,
            );
            stepChanged = hasVisualStateChanged(stepBeforeState, settledState);
          }
        }

        if (
          !stepChanged &&
          canUseScrollFallback &&
          typeof fallbackScrollTarget.scrollBy === 'function'
        ) {
          const distance =
            axis === 'x'
              ? Math.round((fallbackScrollTarget.clientWidth || window.innerWidth) * 0.85)
              : Math.round((fallbackScrollTarget.clientHeight || window.innerHeight) * 0.85);
          fallbackScrollTarget.scrollBy({
            left: axis === 'x' ? distance * (forward ? 1 : -1) : 0,
            top: axis === 'y' ? distance * (forward ? 1 : -1) : 0,
            behavior: 'instant',
          });
          stepMethod = axis === 'x' ? 'scrollBy-x' : 'scrollBy-y';
          const settledState = await waitForSwipeToSettle(
            stepBeforeState,
            container,
            api,
            fallbackScrollTarget,
          );
          stepChanged = hasVisualStateChanged(stepBeforeState, settledState);
        }

        if (!stepMethod) {
          error = canUseScrollFallback
            ? 'No swipe API, navigation button, gesture fallback, or swipe fallback found'
            : 'Selected element does not appear to be a swipeable carousel; use scroll_element or re-highlight a swipable region';
          break;
        }

        method = stepMethod;
        invoked += 1;
        if (stepChanged) {
          effectiveSteps += 1;
        }
      }

      function isBoundaryControl(node) {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        const markerText = getMarkerText(node);
        return (
          node.classList.contains('forbidden') ||
          node.classList.contains('disabled') ||
          node.getAttribute('aria-disabled') === 'true' ||
          markerText.includes('forbidden') ||
          markerText.includes('disabled')
        );
      }

      const navButton = getNavButton(container, forward, axis);
      const afterState = captureVisualState(container, api, fallbackScrollTarget);

      const swipeEffective =
        invoked > 0 &&
        (effectiveSteps > 0 || hasVisualStateChanged(beforeState, afterState));

      if (invoked === 0) {
        return {
          swiped: false,
          error: error || 'Swipe could not be performed',
          stale: false,
        };
      }

      return {
        swiped: true,
        swipeEffective,
        method,
        ...(swipeEffective
          ? {}
          : {
              reason:
                error ||
                (method === 'navButton' && navButton && isBoundaryControl(navButton)
                  ? 'Swipe reached the carousel boundary'
                  : 'Swipe executed but no visible slide movement was detected'),
            }),
      };
    })();
  `;

  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      true,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementSwipe] JavaScript execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      swiped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!jsResult.success) {
    console.log(`❌ [ElementSwipe] Swipe execution failed: ${jsResult.error}`);
    return {
      success: false,
      ...resolvedElementFields,
      swiped: false,
      error: jsResult.error || 'Swipe JavaScript execution failed',
    };
  }

  if (jsResult.dialog_opened) {
    console.log(
      `💬 [ElementSwipe] Dialog opened during swipe: ${jsResult.dialog?.type} - treating as successful swipe with dialog`,
    );
    const result: SwipeResult = {
      success: true,
      ...resolvedElementFields,
      swiped: true,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  const swipeResult = jsResult.result?.value as
    | {
        swiped: boolean;
        swipeEffective?: boolean;
        reason?: string;
        method?: string;
        error?: string;
        stale?: boolean;
      }
    | undefined;

  if (!swipeResult?.swiped) {
    const isStale = swipeResult?.stale === true;
    const error = swipeResult?.error || 'Swipe could not be performed';
    console.log(`❌ [ElementSwipe] Swipe failed: ${error}, stale=${isStale}`);
    return {
      success: false,
      ...resolvedElementFields,
      swiped: false,
      staleElement: isStale,
      error,
    };
  }

  const swipeEffective = swipeResult.swipeEffective !== false;
  const warning = swipeResult.reason;

  if (!swipeEffective) {
    console.log(
      `⚠️ [ElementSwipe] Swipe executed via ${swipeResult.method || 'unknown'} but had no immediate effect: ${warning}`,
    );
  } else {
    console.log(
      `✅ [ElementSwipe] Swipe executed successfully via ${swipeResult.method || 'unknown'}`,
    );
  }

  return {
    success: true,
    ...resolvedElementFields,
    swiped: true,
    swipeEffective,
    ...(warning ? { warning } : {}),
    ...(swipeResult.method ? { method: swipeResult.method } : {}),
  };
}

/**
 * Result type for drag_and_drop operation
 */
export interface DragAndDropResult extends ElementActionResult {
  dragged: boolean;
  staleElement?: boolean;
  error?: string;
}

export interface DragAndDropOptions {
  targetElementId?: string;
  position?: 'before' | 'after';
  offsetX?: number;
  offsetY?: number;
  steps?: number;
}

/**
 * Perform a drag-and-drop gesture from a cached source element to either
 * another cached target element or a pixel offset from the source center.
 *
 * Fires both the low-level pointer/mouse sequence (so native browser hit
 * tests react) and HTML5 drag events (so `draggable="true"` sources work).
 */
export async function performElementDragAndDrop(
  conversationId: string,
  sourceElementId: string,
  tabId: number,
  options: DragAndDropOptions,
  timeout: number = 30000,
): Promise<DragAndDropResult> {
  console.log(
    `🫳 [DragAndDrop] source=${sourceElementId} target=${options.targetElementId ?? ''} offset=(${options.offsetX ?? 0},${options.offsetY ?? 0}) tab=${tabId}`,
  );

  const hasTarget = Boolean(options.targetElementId);
  const hasOffset =
    typeof options.offsetX === 'number' && typeof options.offsetY === 'number';
  if (hasTarget === hasOffset) {
    return {
      success: false,
      ...buildResolvedElementResultFields(sourceElementId, sourceElementId),
      dragged: false,
      error:
        'drag_and_drop requires exactly one of target_element_id or (offset_x, offset_y).',
    };
  }

  const cachedSource = elementCache.getElementById(
    conversationId,
    tabId,
    sourceElementId,
  );
  if (!cachedSource) {
    return {
      success: false,
      ...buildResolvedElementResultFields(sourceElementId, sourceElementId),
      dragged: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId: sourceElementId,
      }),
    };
  }
  const sourceElement = cachedSource.element;
  const resolvedSourceFields = buildResolvedElementResultFields(
    cachedSource.requestedElementId,
    cachedSource.resolvedElementId,
  );

  // Move CDP virtual mouse to source element center for CSS :hover persistence
  await moveToElement(tabId, conversationId, sourceElementId);

  let cachedTarget: ReturnType<typeof elementCache.getElementById> | null =
    null;
  if (hasTarget) {
    cachedTarget = elementCache.getElementById(
      conversationId,
      tabId,
      options.targetElementId as string,
    );
    if (!cachedTarget) {
      return {
        success: false,
        ...resolvedSourceFields,
        dragged: false,
        error: buildElementCacheMissMessage({
          conversationId,
          tabId,
          elementId: options.targetElementId as string,
        }),
      };
    }
  }

  const escapedSourceSelector = escapeForDoubleQuotedJavaScriptString(
    sourceElement.selector,
  );
  const escapedSourceDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedSource.documentId,
  );
  const escapedSourceFingerprint = escapeForDoubleQuotedJavaScriptString(
    sourceElement.fingerprint || '',
  );
  const escapedTargetSelector = cachedTarget
    ? escapeForDoubleQuotedJavaScriptString(cachedTarget.element.selector)
    : '';
  const escapedTargetDocumentId = cachedTarget
    ? escapeForDoubleQuotedJavaScriptString(cachedTarget.documentId)
    : '';
  const escapedTargetFingerprint = cachedTarget
    ? escapeForDoubleQuotedJavaScriptString(
        cachedTarget.element.fingerprint || '',
      )
    : '';

  const steps = Math.max(2, Math.min(40, options.steps ?? 10));
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  const hasTargetLiteral = hasTarget ? 'true' : 'false';
  const positionLiteral = options.position || 'before';

  const script = `
    (async function() {
      const sourceSelector = "${escapedSourceSelector}";
      const sourceDocumentId = "${escapedSourceDocumentId}";
      const sourceFingerprint = "${escapedSourceFingerprint}";
      const targetSelector = "${escapedTargetSelector}";
      const targetDocumentId = "${escapedTargetDocumentId}";
      const targetFingerprint = "${escapedTargetFingerprint}";
      const hasTarget = ${hasTargetLiteral};
      const offsetX = ${offsetX};
      const offsetY = ${offsetY};
      const steps = ${steps};
      const dropPosition = "${positionLiteral}";
      ${buildCachedElementIdentityHelpersScript()}

      const sourceEl = document.querySelector(sourceSelector);
      if (!sourceEl) {
        return { dragged: false, error: "Source element not found in DOM", stale: true };
      }
      const sourceValidation = validateCachedElement(
        sourceDocumentId,
        sourceFingerprint,
        sourceEl,
      );
      if (!sourceValidation.ok) {
        return { dragged: false, error: sourceValidation.error, stale: sourceValidation.stale };
      }

      let targetEl = null;
      if (hasTarget) {
        targetEl = document.querySelector(targetSelector);
        if (!targetEl) {
          return { dragged: false, error: "Target element not found in DOM", stale: true };
        }
        const targetValidation = validateCachedElement(
          targetDocumentId,
          targetFingerprint,
          targetEl,
        );
        if (!targetValidation.ok) {
          return { dragged: false, error: targetValidation.error, stale: targetValidation.stale };
        }
      }

      function centerOf(el) {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }

      const sourceRect = sourceEl.getBoundingClientRect();
      const sourceStyle = window.getComputedStyle(sourceEl);
      if (
        sourceStyle.display === 'none' ||
        sourceStyle.visibility === 'hidden' ||
        sourceStyle.opacity === '0'
      ) {
        return { dragged: false, error: "Source element is not visible", stale: false };
      }
      if (sourceRect.width === 0 || sourceRect.height === 0) {
        return { dragged: false, error: "Source element has zero size", stale: false };
      }

      if (
        sourceRect.top < 0 ||
        sourceRect.bottom > window.innerHeight ||
        sourceRect.left < 0 ||
        sourceRect.right > window.innerWidth
      ) {
        sourceEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      }

      const start = centerOf(sourceEl);
      let end;
      if (hasTarget && targetEl) {
        const targetStyle = window.getComputedStyle(targetEl);
        if (
          targetStyle.display === 'none' ||
          targetStyle.visibility === 'hidden' ||
          targetStyle.opacity === '0'
        ) {
          return { dragged: false, error: "Target element is not visible", stale: false };
        }
        let targetRect = targetEl.getBoundingClientRect();
        if (
          targetRect.top < 0 ||
          targetRect.bottom > window.innerHeight ||
          targetRect.left < 0 ||
          targetRect.right > window.innerWidth
        ) {
          targetEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          // Source rect may shift after the scroll; recompute start too.
          const refreshedSourceRect = sourceEl.getBoundingClientRect();
          start.x = refreshedSourceRect.left + refreshedSourceRect.width / 2;
          start.y = refreshedSourceRect.top + refreshedSourceRect.height / 2;
          targetRect = targetEl.getBoundingClientRect();
        }
        if (
          targetRect.bottom <= 0 ||
          targetRect.top >= window.innerHeight ||
          targetRect.right <= 0 ||
          targetRect.left >= window.innerWidth
        ) {
          return {
            dragged: false,
            error: "Target element is off-screen after scroll-into-view",
            stale: false,
          };
        }
        // Position the drop point relative to the target.
        // "before" = above the target's midpoint (so DnD libraries insert before)
        // "after"  = below the target's midpoint (so DnD libraries insert after)
        // Default is "before" — "drag X to Y" naturally means "place X where Y is".
        const pos = dropPosition;
        const midX = targetRect.left + targetRect.width / 2;
        const midY = targetRect.top + targetRect.height / 2;
        // Nudge 25% of height above or below the midpoint
        const nudge = targetRect.height * 0.25;
        end = {
          x: midX,
          y: pos === 'before' ? midY - nudge : midY + nudge,
        };
      } else {
        end = { x: start.x + offsetX, y: start.y + offsetY };
        // Clamp to viewport so elementFromPoint doesn't return null
        end.x = Math.max(0, Math.min(end.x, window.innerWidth - 1));
        end.y = Math.max(0, Math.min(end.y, window.innerHeight - 1));
      }

      function makeDataTransfer() {
        try {
          return new DataTransfer();
        } catch (e) {
          return null;
        }
      }
      const dataTransfer = makeDataTransfer();

      function fire(el, type, x, y, extra) {
        if (!el) return;
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0,
          buttons: type === 'mouseup' || type === 'pointerup' ? 0 : 1,
          ...(extra || {}),
        };
        let event;
        if (type.startsWith('pointer')) {
          event = new PointerEvent(type, {
            ...init,
            pointerType: 'mouse',
            pointerId: 1,
            isPrimary: true,
          });
        } else if (type.startsWith('drag') || type === 'drop') {
          event = new DragEvent(type, {
            ...init,
            dataTransfer: dataTransfer,
          });
        } else {
          event = new MouseEvent(type, init);
        }
        el.dispatchEvent(event);
      }

      function topElementAt(x, y) {
        const el = document.elementFromPoint(x, y);
        return el || document.body;
      }

      async function waitFrame() {
        await new Promise((resolve) => {
          // requestAnimationFrame doesn't fire when the tab is hidden;
          // race it against a short setTimeout to avoid hanging.
          let done = false;
          requestAnimationFrame(() => { if (!done) { done = true; resolve(null); } });
          setTimeout(() => { if (!done) { done = true; resolve(null); } }, 32);
        });
      }

      try {
        fire(sourceEl, 'pointerover', start.x, start.y);
        fire(sourceEl, 'pointerenter', start.x, start.y);
        fire(sourceEl, 'mouseover', start.x, start.y);
        fire(sourceEl, 'mouseenter', start.x, start.y);
        fire(sourceEl, 'pointermove', start.x, start.y);
        fire(sourceEl, 'mousemove', start.x, start.y);

        fire(sourceEl, 'pointerdown', start.x, start.y);
        fire(sourceEl, 'mousedown', start.x, start.y);

        const draggable = sourceEl instanceof HTMLElement && sourceEl.draggable;
        if (draggable) {
          fire(sourceEl, 'dragstart', start.x, start.y);
        }

        let lastUnderPointer = sourceEl;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const x = start.x + (end.x - start.x) * t;
          const y = start.y + (end.y - start.y) * t;
          const underPointer = topElementAt(x, y);
          fire(underPointer, 'pointermove', x, y);
          fire(underPointer, 'mousemove', x, y);
          if (draggable) {
            if (underPointer !== lastUnderPointer) {
              // Emit pairing dragleave on the previous element before
              // dragenter on the new one — HTML5 DnD zones rely on this
              // to clean up hover state.
              fire(lastUnderPointer, 'dragleave', x, y);
              fire(underPointer, 'dragenter', x, y);
            }
            fire(underPointer, 'dragover', x, y);
          }
          lastUnderPointer = underPointer;
          await waitFrame();
        }

        // Fire drop/mouseup on whatever element is under the cursor.
        // The DOM may have been rearranged during the drag (DnD libraries
        // respond to mousemove in real-time), so we don't check occlusion
        // here — the pre-drag visibility checks already ensured the target
        // was reachable before the drag started.
        const dropEl = topElementAt(end.x, end.y);
        if (draggable) {
          fire(dropEl, 'drop', end.x, end.y);
          fire(sourceEl, 'dragend', end.x, end.y);
        }
        fire(dropEl, 'pointerup', end.x, end.y);
        fire(dropEl, 'mouseup', end.x, end.y);

        return {
          dragged: true,
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          steps,
          viaDragEvents: draggable,
        };
      } catch (e) {
        return { dragged: false, error: e && e.message ? e.message : String(e), stale: false };
      }
    })();
  `;

  let jsResult: JavaScriptResult;
  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      true,
      timeout,
    );
  } catch (error) {
    return {
      success: false,
      ...resolvedSourceFields,
      dragged: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!jsResult.success) {
    return {
      success: false,
      ...resolvedSourceFields,
      dragged: false,
      error: jsResult.error || 'Drag JavaScript execution failed',
    };
  }

  const inner = jsResult.result?.value as
    | { dragged: boolean; error?: string; stale?: boolean }
    | undefined;
  if (!inner || typeof inner !== 'object') {
    return {
      success: false,
      ...resolvedSourceFields,
      dragged: false,
      error: 'Drag JavaScript returned an invalid result structure',
    };
  }
  if (!inner.dragged) {
    return {
      success: false,
      ...resolvedSourceFields,
      dragged: false,
      staleElement: inner.stale === true,
      error: inner.error,
    };
  }

  return {
    success: true,
    ...resolvedSourceFields,
    dragged: true,
  };
}

/**
 * Result type for set_slider operation
 */
export interface SetSliderResult extends ElementActionResult {
  sliderSet: boolean;
  previousValue?: string;
  newValue?: string;
  min?: number;
  max?: number;
  staleElement?: boolean;
  error?: string;
}

/**
 * Set a slider to a target value. Supports two kinds of slider:
 *
 * 1. **Native** `<input type=range>` — writes the value property and
 *    dispatches `input` + `change` events.
 * 2. **ARIA custom sliders** — elements with `role="slider"` and
 *    `aria-valuemin` / `aria-valuemax`. Computes the target click
 *    coordinate on the track and dispatches pointer/mouse/click events
 *    at that position so the site's JS updates the slider.
 */
export async function performElementSetSlider(
  conversationId: string,
  elementId: string,
  value: number | string,
  tabId: number,
  timeout: number = 30000,
): Promise<SetSliderResult> {
  console.log(
    `🎚️  [SetSlider] Setting slider ${elementId} to ${value} on tab ${tabId}`,
  );

  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      sliderSet: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  // Move CDP virtual mouse to element center for CSS :hover persistence
  await moveToElement(tabId, conversationId, elementId);

  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );
  const escapedValue = escapeForDoubleQuotedJavaScriptString(String(value));

  const script = `
    (async function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      const requestedValue = "${escapedValue}";
      ${buildCachedElementIdentityHelpersScript()}

      const el = document.querySelector(selector);
      if (!el) {
        return { sliderSet: false, error: "Element not found in DOM", stale: true };
      }
      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          sliderSet: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      // ---- Determine slider type ----
      const isNativeRange = (el instanceof HTMLInputElement) && el.type === 'range';
      const ariaRole = (el.getAttribute('role') || '').toLowerCase();
      const isAriaSlider = ariaRole === 'slider';
      // Generic: any other element (custom progress bar detected by slidable hint)
      const isGeneric = !isNativeRange && !isAriaSlider;

      // ---- Parse min / max / step ----
      let min, max, step;
      if (isNativeRange) {
        min = Number(el.min === '' ? 0 : el.min);
        max = Number(el.max === '' ? 100 : el.max);
        step = Number(el.step === '' || el.step === 'any' ? 0 : el.step);
      } else if (isAriaSlider) {
        min = Number(el.getAttribute('aria-valuemin') ?? 0);
        max = Number(el.getAttribute('aria-valuemax') ?? 100);
        step = 0;
      } else {
        // Generic: treat as 0–100 percentage range
        min = 0;
        max = 100;
        step = 0;
      }
      if (!isFinite(min) || !isFinite(max) || max <= min) {
        return { sliderSet: false, error: "Slider min/max are not a valid numeric range", stale: false };
      }

      // ---- Resolve target value ----
      let numeric;
      const trimmed = requestedValue.trim();
      if (trimmed.endsWith('%')) {
        const pct = Number(trimmed.slice(0, -1));
        if (!isFinite(pct)) {
          return { sliderSet: false, error: "Percentage value is not numeric", stale: false };
        }
        numeric = min + ((max - min) * pct) / 100;
      } else {
        numeric = Number(trimmed);
        if (!isFinite(numeric)) {
          return { sliderSet: false, error: "Value is not numeric", stale: false };
        }
      }
      if (numeric < min) numeric = min;
      if (numeric > max) numeric = max;
      if (step > 0) {
        const quantized = min + Math.round((numeric - min) / step) * step;
        numeric = Math.max(min, Math.min(max, quantized));
      }

      // ============================================================
      // NATIVE RANGE PATH: write value + dispatch events
      // ============================================================
      if (isNativeRange) {
        const previousValue = el.value;
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        );
        const setter = descriptor && descriptor.set;
        if (setter) {
          setter.call(el, String(numeric));
        } else {
          el.value = String(numeric);
        }
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: false }));

        return {
          sliderSet: true,
          previousValue,
          newValue: el.value,
          min,
          max,
        };
      }

      // ============================================================
      // POSITION-CLICK PATH: ARIA slider + generic custom sliders
      // Compute target (x,y) on the element and dispatch click events.
      //
      // For generic sliders, the cached element may be a leaf inside the
      // slider container (e.g. progress-buffered inside progress-area).
      // Walk up to find the full-width container for position calculation,
      // but dispatch events on the original element so they bubble to the
      // container's click handler.
      // ============================================================
      const previousValue = isAriaSlider
        ? (el.getAttribute('aria-valuenow') || '')
        : '';

      // Find the slider track/container for position calculation
      let trackEl = el;
      if (isGeneric) {
        // Walk up to find a parent whose width represents the full slider range.
        // The container is typically the widest ancestor with a slider-related class.
        const SLIDER_RE = /\\b(progress|slider|seek|scrub|range|timeline|playback)\\b/i;
        let ancestor = el.parentElement;
        for (let d = 0; ancestor && d < 4; d++, ancestor = ancestor.parentElement) {
          if (ancestor === document.body || ancestor === document.documentElement) break;
          const ancIdClass = (ancestor.id || '') + ' ' + Array.from(ancestor.classList).join(' ');
          if (SLIDER_RE.test(ancIdClass)) {
            const ancRect = ancestor.getBoundingClientRect();
            if (ancRect.width > trackEl.getBoundingClientRect().width) {
              trackEl = ancestor;
            }
          }
        }
      }

      const rect = trackEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { sliderSet: false, error: "Slider element has zero size", stale: false };
      }

      // Determine orientation
      const orientation = trackEl.getAttribute('aria-orientation');
      const isVertical = orientation === 'vertical' || (!orientation && rect.height > rect.width * 2);
      const fraction = (numeric - min) / (max - min);

      let clickX, clickY;
      if (isVertical) {
        clickX = rect.left + rect.width / 2;
        clickY = rect.bottom - fraction * rect.height;
      } else {
        clickX = rect.left + fraction * rect.width;
        clickY = rect.top + rect.height / 2;
      }

      // Dispatch full pointer → mouse → click sequence at the computed position
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clickX,
        clientY: clickY,
        button: 0,
        buttons: 1,
      };

      // Dispatch on trackEl (the slider container) so the click handler fires
      // directly, rather than relying on bubbling from a leaf child.
      const dispatchTarget = isGeneric ? trackEl : el;
      dispatchTarget.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerType: 'mouse', isPrimary: true }));
      dispatchTarget.dispatchEvent(new MouseEvent('mousedown', eventInit));
      dispatchTarget.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
      dispatchTarget.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
      dispatchTarget.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

      dispatchTarget.dispatchEvent(new Event('input', { bubbles: true }));
      dispatchTarget.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(r => setTimeout(r, 100));

      const newValue = isAriaSlider
        ? (el.getAttribute('aria-valuenow') || '')
        : String(numeric);
      return {
        sliderSet: true,
        previousValue,
        newValue,
        min,
        max,
      };
    })();
  `;

  let jsResult: JavaScriptResult;
  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      true,
      timeout,
    );
  } catch (error) {
    return {
      success: false,
      ...resolvedFields,
      sliderSet: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!jsResult.success) {
    return {
      success: false,
      ...resolvedFields,
      sliderSet: false,
      error: jsResult.error || 'set_slider JavaScript execution failed',
    };
  }

  const inner = jsResult.result?.value as
    | {
        sliderSet: boolean;
        error?: string;
        stale?: boolean;
        previousValue?: string;
        newValue?: string;
        min?: number;
        max?: number;
      }
    | undefined;
  if (!inner || typeof inner !== 'object') {
    return {
      success: false,
      ...resolvedFields,
      sliderSet: false,
      error: 'set_slider JavaScript returned an invalid result structure',
    };
  }
  if (!inner.sliderSet) {
    return {
      success: false,
      ...resolvedFields,
      sliderSet: false,
      staleElement: inner.stale === true,
      error: inner.error,
    };
  }

  return {
    success: true,
    ...resolvedFields,
    sliderSet: true,
    previousValue: inner.previousValue,
    newValue: inner.newValue,
    min: inner.min,
    max: inner.max,
  };
}

/**
 * Result type for keyboard input operation
 */
export interface InputResult extends ElementActionResult {
  input: boolean;
  value?: string;
  staleElement?: boolean;
  error?: string;
}

/**
 * Perform keyboard input on an element identified by its cached element_id
 *
 * Flow:
 * 1. Look up element from cache
 * 2. Build JavaScript to focus, set value, and dispatch events
 * 3. Execute with dialog detection
 * 4. Return result with input value
 *
 * @param conversationId Session ID for element cache lookup
 * @param elementId Cached element ID from the latest highlight cache
 * @param text Text to input into the element
 * @param tabId Target tab ID
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Input result with success status and input value
 */
export async function performKeyboardInput(
  conversationId: string,
  elementId: string,
  text: string,
  tabId: number,
  timeout: number = 30000,
): Promise<InputResult> {
  console.log(
    `⌨️ [KeyboardInput] Inputting text to element ${elementId} in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Look up element from cache
  // ============================================================
  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [KeyboardInput] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      input: false,
      staleElement: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  console.log(
    `✅ [KeyboardInput] Found element: selector="${element.selector}"`,
  );

  // ============================================================
  // STEP 2: Build JavaScript to input text
  // ============================================================
  // Escape quotes and backslashes in selector and text for safe injection
  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );

  // ============================================================
  // STEP 2a: Focus the element and clear existing content via JS.
  // We keep this in JS (not CDP) because activation/focus semantics
  // depend on element-specific helpers (labels, shadow roots, etc.)
  // that already live in content-script space.
  // ============================================================
  const focusScript = `
    (function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      ${buildEditableActivationHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { prepared: false, error: "Element not found in DOM", stale: true };
      }

      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          prepared: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { prepared: false, error: "Element is not visible", stale: false };
      }

      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight ||
          rect.left < 0 || rect.right > window.innerWidth) {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      }

      try {
        const activation = getInteractiveActivationTarget(el);
        const activationTarget =
          resolveActivationDispatchTarget(
            el,
            activation.target instanceof Element ? activation.target : el,
          ) || el;
        const alreadyFocused =
          (el instanceof HTMLElement && document.activeElement === el) ||
          (el instanceof HTMLElement &&
            document.activeElement instanceof Element &&
            el.contains(document.activeElement));

        if (!alreadyFocused) {
          dispatchActivationPress(activationTarget, activation.point);
        }
        focusInteractionTarget(
          el instanceof HTMLElement ? el : activationTarget,
        );
        if (!alreadyFocused) {
          dispatchActivationRelease(activationTarget, activation.point);
        }

        const tagName = el.tagName.toLowerCase();
        const isContentEditable = el.isContentEditable || el.contentEditable === 'true';
        const isTextField = tagName === 'input' || tagName === 'textarea';
        if (!isTextField && !isContentEditable) {
          return { prepared: false, error: "Element is not an input, textarea, or contenteditable" };
        }

        // CDP keystrokes route to document.activeElement, so if focus
        // didn't land on (or inside) the target we'd silently type
        // into whatever else had focus. Verify before handing off.
        const focused = document.activeElement;
        const focusOk =
          focused === el ||
          (el instanceof Element && el.contains(focused)) ||
          (focused instanceof Element && focused.contains(el));
        if (!focusOk) {
          return {
            prepared: false,
            error: "Failed to focus target editable; document.activeElement is " + (focused ? focused.tagName : 'null'),
          };
        }

        // Clear existing content so the subsequent CDP keystrokes
        // produce the requested value (not appended to whatever was
        // already there). We notify frameworks via input event so
        // their reactive bindings stay in sync.
        const hadContent =
          (isTextField && el.value.length > 0) ||
          (isContentEditable && el.textContent && el.textContent.length > 0);
        if (hadContent) {
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
            data: '',
          }));
          if (isTextField) {
            el.value = '';
          } else {
            el.textContent = '';
          }
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
            data: null,
          }));
        }

        return {
          prepared: true,
          isTextField,
          isContentEditable,
        };
      } catch (e) {
        return { prepared: false, error: e.message || String(e) };
      }
    })();
  `;

  // ============================================================
  // STEP 2b: Execute focus/clear script
  // ============================================================
  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      focusScript,
      true,
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [KeyboardInput] Focus script execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: false,
    };
  }

  // Bail out before the CDP typing loop if focus/clear failed.
  const focusResult = jsResult.result?.value as
    | {
        prepared: boolean;
        error?: string;
        stale?: boolean;
        isTextField?: boolean;
        isContentEditable?: boolean;
      }
    | undefined;

  if (!jsResult.success || !focusResult?.prepared) {
    const isStale = focusResult?.stale === true;
    console.log(
      `❌ [KeyboardInput] Focus/clear failed: ${focusResult?.error || jsResult.error || 'Unknown error'}, stale=${isStale}`,
    );
    if (jsResult.dialog_opened && jsResult.dialog) {
      const result: InputResult = {
        success: true,
        ...resolvedElementFields,
        input: true,
        value: undefined,
        new_tabs_created: jsResult.new_tabs_created,
        dialogOpened: true,
        dialog: {
          type: jsResult.dialog.type as
            | 'alert'
            | 'confirm'
            | 'prompt'
            | 'beforeunload',
          message: jsResult.dialog.message,
        },
      };
      return result;
    }
    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: isStale,
    };
  }

  // ============================================================
  // STEP 2c: Type each character via CDP Input.dispatchKeyEvent so
  // keydown/keyup fire through the native pipeline. This is what
  // lets sites with "user is typing" guards (e.g. Zhihu's hot-topic
  // rotator) pause their timers correctly.
  // ============================================================
  const cdp = new CdpCommander(tabId);
  try {
    await typeTextViaCdp(cdp, text);
  } catch (error) {
    console.error(`❌ [KeyboardInput] CDP typing error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: false,
    };
  }

  // ============================================================
  // STEP 2d: Fire `change` and read back the final value. CDP
  // keystrokes naturally fire input events, but `change` only fires
  // on blur for text inputs — surface it eagerly for framework
  // listeners expecting it right after typing.
  // ============================================================
  const readbackScript = `
    (function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      ${buildEditableActivationHelpersScript()}
      const el = document.querySelector(selector);
      if (!el) {
        return { input: false, error: "Element disappeared after typing", stale: true };
      }
      // Re-run cached-element validation. If the input was rerendered
      // into a new DOM node mid-type, the selector may still match but
      // the identity is different — surface that as stale rather than
      // reporting a phantom success.
      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          input: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }
      try {
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      } catch (_) {}
      const tagName = el.tagName.toLowerCase();
      const isTextField = tagName === 'input' || tagName === 'textarea';
      const value = isTextField ? el.value : (el.textContent || '');
      return { input: true, value };
    })();
  `;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      readbackScript,
      true,
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [KeyboardInput] Readback script execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: false,
    };
  }

  // ============================================================
  // STEP 4: Process result (dialog handling deferred to screenshot)
  // ============================================================

  // Note: If dialog opened, we don't handle it here - it will be handled by captureScreenshot
  // We just return the JavaScript result as-is

  // Check for execution errors
  if (!jsResult.success) {
    console.log(`❌ [KeyboardInput] Input execution failed: ${jsResult.error}`);
    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: false,
    };
  }

  // Debug: Log JavaScript result for diagnosis
  console.log(
    `🔍 [KeyboardInput] JavaScript result.value:`,
    JSON.stringify(jsResult.result?.value, null, 2),
  );
  console.log(`🔍 [KeyboardInput] Full JavaScript result:`, jsResult);

  // If a dialog opened during execution, treat as success with dialog info
  if (jsResult.dialog_opened) {
    console.log(
      `💬 [KeyboardInput] Dialog opened during input: ${jsResult.dialog?.type} - treating as successful input with dialog`,
    );
    const result: InputResult = {
      success: true,
      ...resolvedElementFields,
      input: true,
      value: undefined,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  // Check the result from the script (only if no dialog opened)
  const inputResult = jsResult.result?.value as
    | { input: boolean; error?: string; stale?: boolean; value?: string }
    | undefined;

  if (!inputResult?.input) {
    const isStale = inputResult?.stale === true;
    console.log(
      `❌ [KeyboardInput] Input failed: ${inputResult?.error || 'Unknown error'}, stale=${isStale}`,
    );

    return {
      success: false,
      ...resolvedElementFields,
      input: false,
      staleElement: isStale,
    };
  }

  console.log(
    `✅ [KeyboardInput] Input executed successfully, value="${inputResult.value}"`,
  );

  // If dialog opened during input, propagate dialog info
  const result: InputResult = {
    success: true,
    ...resolvedElementFields,
    input: true,
    value: inputResult.value,
  };

  if (jsResult.dialog_opened && jsResult.dialog) {
    result.dialogOpened = true;
    result.dialog = {
      type: jsResult.dialog.type as
        | 'alert'
        | 'confirm'
        | 'prompt'
        | 'beforeunload',
      message: jsResult.dialog.message,
    };
    console.log(
      `💬 [KeyboardInput] Propagating dialog info to screenshot: ${jsResult.dialog.type}`,
    );
  }

  return result;
}

/**
 * Perform a select on a <select> element identified by its cached element_id
 *
 * Flow:
 * 1. Look up element from cache
 * 2. Build JavaScript to select option(s) by value
 * 3. Execute with dialog detection
 * 4. Return result with selected values/labels/indices
 *
 * @param conversationId Session ID for element cache lookup
 * @param elementId Cached element ID from the latest highlight cache (for example, "A1H")
 * @param tabId Target tab ID
 * @param value Option value(s) to select. Use string for single select, array for multi-select
 * @param timeout Maximum execution time in milliseconds (default: 30000)
 * @returns Select result with success status and selected values
 */
export async function performElementSelect(
  conversationId: string,
  elementId: string,
  tabId: number,
  value: string | string[],
  timeout: number = 30000,
): Promise<SelectResult> {
  console.log(
    `📋 [ElementSelect] Selecting element ${elementId} in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Look up element from cache
  // ============================================================
  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [ElementSelect] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      selected: false,
      staleElement: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }
  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );

  console.log(
    `✅ [ElementSelect] Found element: selector="${element.selector}"`,
  );

  // Move CDP virtual mouse to element center for CSS :hover persistence
  await moveToElement(tabId, conversationId, elementId);

  // ============================================================
  // STEP 2: Build JavaScript to select option(s)
  // ============================================================
  // Escape quotes and backslashes in selector for safe injection
  const escapedSelector = escapeForDoubleQuotedJavaScriptString(
    element.selector,
  );
  const escapedDocumentId = escapeForDoubleQuotedJavaScriptString(
    cachedElement.documentId,
  );
  const escapedFingerprint = escapeForDoubleQuotedJavaScriptString(
    element.fingerprint || '',
  );

  // Serialize value for JavaScript injection
  const valueJson = JSON.stringify(value);

  const script = `
    (function() {
      const selector = "${escapedSelector}";
      const expectedDocumentId = "${escapedDocumentId}";
      const expectedFingerprint = "${escapedFingerprint}";
      const value = ${valueJson};
      ${buildCachedElementIdentityHelpersScript()}

      const el = document.querySelector(selector);

      if (!el) {
        return { selected: false, error: "Element not found in DOM", stale: true };
      }

      const snapshotValidation = validateCachedElement(
        expectedDocumentId,
        expectedFingerprint,
        el,
      );
      if (!snapshotValidation.ok) {
        return {
          selected: false,
          error: snapshotValidation.error,
          stale: snapshotValidation.stale,
        };
      }

      // Verify it's a select element
      if (el.tagName.toLowerCase() !== 'select') {
        return { selected: false, error: "Element is not a <select> element" };
      }

      // Check if element is still visible
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { selected: false, error: "Element is not visible", stale: false };
      }

      // Scroll element into view if needed
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight ||
          rect.left < 0 || rect.right > window.innerWidth) {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      }

      try {
        // Focus the element first
        if (typeof el.focus === 'function') {
          el.focus();
        }

        const options = Array.from(el.options);
        let selectedOptions = [];

        // Resolve a single requested choice against the option list.
        // Match order (both exact — no substring fallback):
        //   1. exact option.value (the literal HTML attribute)
        //   2. exact option.text (the visible label, trimmed)
        // This matches commit b18824c's intent of teaching the compiler and
        // runtime that <select> matches by option value. A looser
        // substring fallback is intentionally NOT supported: on dropdowns
        // with overlapping labels (e.g. filters/screeners with several
        // "Large..." or "Over..." choices), a .includes()-based match
        // silently picks the first candidate and mutates page state without
        // surfacing the ambiguity. If an exact match is not found, return
        // null so the error path below reports the full inventory and the
        // caller can retry with the correct value.
        const resolveOption = (v) => {
          if (typeof v !== 'string') return null;
          const byValue = options.find(opt => opt.value === v);
          if (byValue) return byValue;
          const trimmed = v.trim();
          const byTextExact = options.find(
            opt => (opt.text || opt.textContent || '').trim() === trimmed
          );
          return byTextExact || null;
        };

        // Select by value
        if (Array.isArray(value)) {
          // Multi-select: clear all first, then select multiple
          el.selectedIndex = -1;
          for (const v of value) {
            const opt = resolveOption(v);
            if (opt) {
              opt.selected = true;
              selectedOptions.push(opt);
            }
          }
        } else {
          // Single select
          const opt = resolveOption(value);
          if (opt) {
            el.value = opt.value;
            selectedOptions.push(opt);
          }
        }

        // Check if any options were found
        if (selectedOptions.length === 0) {
          // Surface the available options in the error so the agent can
          // converge in one extra turn instead of guessing again.
          const inventory = options.map(opt => ({
            value: opt.value,
            text: (opt.text || opt.textContent || '').trim(),
          }));
          return {
            selected: false,
            error: \`Option not found for value: \${JSON.stringify(value)}. Available options: \${JSON.stringify(inventory)}\`,
            availableOptions: inventory,
          };
        }

        // Dispatch change event for React/Vue compatibility
        const changeEvent = new Event('change', {
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(changeEvent);

        // Also dispatch input event for good measure
        const inputEvent = new Event('input', {
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(inputEvent);

        // Return selected values, labels, and indices
        return {
          selected: true,
          selectedValues: selectedOptions.map(opt => opt.value),
          selectedLabels: selectedOptions.map(opt => opt.text || opt.textContent.trim()),
          selectedIndices: selectedOptions.map(opt => opt.index),
          isMultiple: el.multiple
        };
      } catch (e) {
        return { selected: false, error: e.message || String(e) };
      }
    })();
  `;

  // ============================================================
  // STEP 3: Execute JavaScript with dialog detection
  // ============================================================
  let jsResult: JavaScriptResult;

  try {
    jsResult = await executeJavaScript(
      tabId,
      conversationId,
      script,
      true,
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementSelect] JavaScript execution error:`, error);
    return {
      success: false,
      ...resolvedElementFields,
      selected: false,
      staleElement: false,
    };
  }

  // ============================================================
  // STEP 4: Process result
  // ============================================================

  // Check for execution errors
  if (!jsResult.success) {
    console.log(
      `❌ [ElementSelect] Select execution failed: ${jsResult.error}`,
    );
    return {
      success: false,
      ...resolvedElementFields,
      selected: false,
      staleElement: false,
    };
  }

  // Debug: Log JavaScript result for diagnosis
  console.log(
    `🔍 [ElementSelect] JavaScript result.value:`,
    JSON.stringify(jsResult.result?.value, null, 2),
  );
  console.log(`🔍 [ElementSelect] Full JavaScript result:`, jsResult);

  // If a dialog opened during execution, treat as success with dialog info
  if (jsResult.dialog_opened) {
    console.log(
      `💬 [ElementSelect] Dialog opened during select: ${jsResult.dialog?.type} - treating as successful select with dialog`,
    );
    const result: SelectResult = {
      success: true,
      ...resolvedElementFields,
      selected: true,
      new_tabs_created: jsResult.new_tabs_created,
    };
    if (jsResult.dialog) {
      result.dialogOpened = true;
      result.dialog = {
        type: jsResult.dialog.type as
          | 'alert'
          | 'confirm'
          | 'prompt'
          | 'beforeunload',
        message: jsResult.dialog.message,
      };
    }
    return result;
  }

  // Check the result from the script (only if no dialog opened)
  const selectResult = jsResult.result?.value as
    | {
        selected: boolean;
        error?: string;
        stale?: boolean;
        selectedValues?: string[];
        selectedLabels?: string[];
        selectedIndices?: number[];
        isMultiple?: boolean;
      }
    | undefined;

  if (!selectResult?.selected) {
    const isStale = selectResult?.stale === true;
    console.log(
      `❌ [ElementSelect] Select failed: ${selectResult?.error || 'Unknown error'}, stale=${isStale}`,
    );

    return {
      success: false,
      ...resolvedElementFields,
      selected: false,
      staleElement: isStale,
      error: selectResult?.error,
    };
  }

  console.log(
    `✅ [ElementSelect] Select executed successfully, values=${JSON.stringify(selectResult.selectedValues)}`,
  );

  // Build result with selected values
  const result: SelectResult = {
    success: true,
    ...resolvedElementFields,
    selected: true,
    selectedValues: selectResult.selectedValues,
    selectedLabels: selectResult.selectedLabels,
    selectedIndices: selectResult.selectedIndices,
  };

  if (jsResult.dialog_opened && jsResult.dialog) {
    result.dialogOpened = true;
    result.dialog = {
      type: jsResult.dialog.type as
        | 'alert'
        | 'confirm'
        | 'prompt'
        | 'beforeunload',
      message: jsResult.dialog.message,
    };
    console.log(
      `💬 [ElementSelect] Propagating dialog info to screenshot: ${jsResult.dialog.type}`,
    );
  }

  return result;
}

/**
 * Attach a local file (by absolute path on the host) to an <input type="file">
 * via CDP `DOM.setFileInputFiles`. This bypasses the native OS file picker —
 * attempting to click the input would pop the picker in front of the user,
 * which the agent cannot drive.
 *
 * The server validates the path before dispatching, so here we only need to
 * resolve the cached selector to a CDP `nodeId` and invoke setFileInputFiles.
 */
export async function performElementUpload(
  conversationId: string,
  elementId: string,
  tabId: number,
  filePath: string,
): Promise<UploadResult> {
  console.log(
    `📎 [ElementUpload] Uploading "${filePath}" to element ${elementId} on tab ${tabId}`,
  );

  const cachedElement = elementCache.getElementById(
    conversationId,
    tabId,
    elementId,
  );
  if (!cachedElement) {
    console.log(`❌ [ElementUpload] Element ${elementId} not found in cache`);
    return {
      success: false,
      ...buildResolvedElementResultFields(elementId, elementId),
      uploaded: false,
      staleElement: false,
      error: buildElementCacheMissMessage({
        conversationId,
        tabId,
        elementId,
      }),
    };
  }

  const element = cachedElement.element;
  const resolvedElementFields = buildResolvedElementResultFields(
    cachedElement.requestedElementId,
    cachedElement.resolvedElementId,
  );
  const cdp = new CdpCommander(tabId);

  try {
    // Resolve selector → CDP nodeId. DOM.getDocument returns the document root
    // node; DOM.querySelector is scoped to that root and accepts any CSS
    // selector. A nodeId of 0 indicates no match (selector went stale).
    const doc = (await cdp.sendCommand('DOM.getDocument', { depth: 0 })) as {
      root?: { nodeId: number };
    };
    if (!doc || !doc.root || typeof doc.root.nodeId !== 'number') {
      return {
        success: false,
        ...resolvedElementFields,
        uploaded: false,
        error: 'CDP DOM.getDocument returned no root node',
      };
    }

    const queryResult = (await cdp.sendCommand('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: element.selector,
    })) as { nodeId?: number };

    if (!queryResult || !queryResult.nodeId) {
      return {
        success: false,
        ...resolvedElementFields,
        uploaded: false,
        staleElement: true,
        error: `Selector "${element.selector}" no longer resolves to a DOM node (element became stale).`,
      };
    }

    await cdp.sendCommand('DOM.setFileInputFiles', {
      nodeId: queryResult.nodeId,
      files: [filePath],
    });

    console.log(
      `✅ [ElementUpload] DOM.setFileInputFiles succeeded for ${elementId} (${filePath})`,
    );

    return {
      success: true,
      ...resolvedElementFields,
      uploaded: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ [ElementUpload] failed: ${message}`);
    return {
      success: false,
      ...resolvedElementFields,
      uploaded: false,
      error: message,
    };
  }
}

/**
 * Export element actions module
 */
export const elementActions = {
  performElementClick,
  performElementHover,
  performElementScroll,
  performKeyboardInput,
  performElementSelect,
  performElementUpload,
};
