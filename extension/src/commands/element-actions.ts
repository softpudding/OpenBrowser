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

import { ELEMENT_CACHE_TTL_DESCRIPTION, elementCache } from './element-cache';
import { executeJavaScript, type JavaScriptResult } from './javascript';
import { buildHitTestVisibilityHelpersScript } from '../utils/hit-test-visibility';

function buildElementCacheMissMessage(
  elementId: string,
  refreshHint: string = 'Call highlight_elements() first.',
): string {
  return `Element '${elementId}' not found in cache. Each new highlight invalidates the previous IDs, and unused cache entries still expire after ${ELEMENT_CACHE_TTL_DESCRIPTION}. ${refreshHint}`;
}

function buildEditableActivationHelpersScript(): string {
  return `
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
 * @param elementId Cached element ID from the latest highlight (for example, "1")
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
  const element = elementCache.getElementById(conversationId, tabId, elementId);
  if (!element) {
    console.log(`❌ [ElementClick] Element ${elementId} not found in cache`);
    return {
      success: false,
      elementId,
      clicked: false,
      staleElement: false,
      error: buildElementCacheMissMessage(
        elementId,
        'Call highlight_elements() first to refresh the cache and get updated element IDs.',
      ),
    };
  }

  console.log(
    `✅ [ElementClick] Found element: selector="${element.selector}"`,
  );

  // ============================================================
  // STEP 2: Build JavaScript to click with full event sequence
  // ============================================================
  // Escape quotes in selector for safe injection
  const escapedSelector = element.selector.replace(/"/g, '\\"');

  const script = `
    (async function() {
      const selector = "${escapedSelector}";
      ${buildEditableActivationHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { clicked: false, error: "Element not found in DOM", stale: true };
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
          activation.target instanceof Element ? activation.target : el;

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
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
      clicked: false,
      staleElement: isStale,
      error: clickResult?.error,
    };
  }

  console.log(`✅ [ElementClick] Click executed successfully`);

  // If dialog opened during click, propagate dialog info
  const result: ClickResult = {
    success: true,
    elementId,
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
 * @param elementId Cached element ID from the latest highlight (for example, "1")
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
  const element = elementCache.getElementById(conversationId, tabId, elementId);
  if (!element) {
    console.log(`❌ [ElementHover] Element ${elementId} not found in cache`);
    return {
      success: false,
      elementId,
      hovered: false,
      staleElement: false,
      error: buildElementCacheMissMessage(elementId),
    };
  }

  console.log(
    `✅ [ElementHover] Found element: selector="${element.selector}"`,
  );

  // ============================================================
  // STEP 2: Build JavaScript to dispatch hover events
  // ============================================================
  const escapedSelector = element.selector.replace(/"/g, '\\"');

  const script = `
    (function() {
      const selector = "${escapedSelector}";
      const el = document.querySelector(selector);

      if (!el) {
        return { hovered: false, error: "Element not found in DOM", stale: true };
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
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
      hovered: false,
      staleElement: isStale,
    };
  }

  console.log(`✅ [ElementHover] Hover executed successfully`);

  // If dialog opened during hover, propagate dialog info
  const result: HoverResult = {
    success: true,
    elementId,
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
 * @param elementId Cached element ID (e.g., "scroll-1"). Optional - if not provided, scrolls the entire page
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
    `📜 [ElementScroll] Scrolling ${elementId ? `element ${elementId}` : 'entire page'} ${direction} (amount: ${scrollAmount}x viewport) in conversation ${conversationId} on tab ${tabId}`,
  );

  // ============================================================
  // STEP 1: Build JavaScript to scroll
  // ============================================================

  // Calculate scroll multipliers based on direction
  // scrollAmount is relative to viewport height (0.5 = half page, 1.0 = full page)
  // For horizontal scroll, we use viewport width
  const scrollMultipliers: Record<ScrollDirection, { x: number; y: number }> = {
    up: { x: 0, y: -scrollAmount },
    down: { x: 0, y: scrollAmount },
    left: { x: -scrollAmount, y: 0 },
    right: { x: scrollAmount, y: 0 },
  };

  const { x: xMultiplier, y: yMultiplier } = scrollMultipliers[direction];

  let script: string;

  if (elementId) {
    // Scroll a specific element
    const element = elementCache.getElementById(
      conversationId,
      tabId,
      elementId,
    );
    if (!element) {
      console.log(`❌ [ElementScroll] Element ${elementId} not found in cache`);
      return {
        success: false,
        elementId,
        scrolled: false,
        error: buildElementCacheMissMessage(elementId),
      };
    }

    console.log(
      `✅ [ElementScroll] Found element: selector="${element.selector}"`,
    );
    const escapedSelector = element.selector.replace(/"/g, '\\"');

    script = `
      (function() {
        const selector = "${escapedSelector}";
        const el = document.querySelector(selector);
        const xMultiplier = ${xMultiplier};
        const yMultiplier = ${yMultiplier};

        if (!el) {
          return { scrolled: false, error: "Element not found in DOM", stale: true };
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
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
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
    elementId,
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

  const element = elementCache.getElementById(conversationId, tabId, elementId);
  if (!element) {
    console.log(`❌ [ElementSwipe] Element ${elementId} not found in cache`);
    return {
      success: false,
      elementId,
      swiped: false,
      error: buildElementCacheMissMessage(elementId),
    };
  }

  console.log(
    `✅ [ElementSwipe] Found element: selector="${element.selector}"`,
  );

  const escapedSelector = element.selector.replace(/"/g, '\\"');

  const script = `
    (async function() {
      const selector = "${escapedSelector}";
      const direction = "${direction}";
      const swipeCount = ${swipeCount};
      const el = document.querySelector(selector);

      if (!el) {
        return { swiped: false, error: "Element not found in DOM", stale: true };
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
      elementId,
      swiped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!jsResult.success) {
    console.log(`❌ [ElementSwipe] Swipe execution failed: ${jsResult.error}`);
    return {
      success: false,
      elementId,
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
      elementId,
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
      elementId,
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
    elementId,
    swiped: true,
    swipeEffective,
    ...(warning ? { warning } : {}),
    ...(swipeResult.method ? { method: swipeResult.method } : {}),
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
 * @param elementId Cached element ID (e.g., "input-1", "textarea-1")
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
  const element = elementCache.getElementById(conversationId, tabId, elementId);
  if (!element) {
    console.log(`❌ [KeyboardInput] Element ${elementId} not found in cache`);
    return {
      success: false,
      elementId,
      input: false,
      staleElement: false,
      error: buildElementCacheMissMessage(elementId),
    };
  }

  console.log(
    `✅ [KeyboardInput] Found element: selector="${element.selector}"`,
  );

  // ============================================================
  // STEP 2: Build JavaScript to input text
  // ============================================================
  // Escape quotes and backslashes in selector and text for safe injection
  const escapedSelector = element.selector
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const script = `
    (function() {
      const selector = "${escapedSelector}";
      const text = "${escapedText}";
      ${buildEditableActivationHelpersScript()}
      const el = document.querySelector(selector);

      if (!el) {
        return { input: false, error: "Element not found in DOM", stale: true };
      }

      // Check if element is still visible
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return { input: false, error: "Element is not visible", stale: false };
      }

      // Scroll element into view if needed
      const rect = el.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight ||
          rect.left < 0 || rect.right > window.innerWidth) {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      }

      try {
        const activation = getInteractiveActivationTarget(el);
        const activationTarget =
          activation.target instanceof Element ? activation.target : el;
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

        // Set value based on element type
        const tagName = el.tagName.toLowerCase();
        const isContentEditable = el.isContentEditable || el.contentEditable === 'true';

        const beforeInputEvent = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: text.length === 0 ? 'deleteContentBackward' : 'insertText',
          data: text,
        });
        el.dispatchEvent(beforeInputEvent);

        if (tagName === 'input' || tagName === 'textarea') {
          // For input and textarea, use value property
          el.value = text;
        } else if (isContentEditable) {
          // For contenteditable elements, use textContent
          el.textContent = text;
        } else {
          return { input: false, error: "Element is not an input, textarea, or contenteditable" };
        }

        // Dispatch input event for React/Vue compatibility
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        });
        el.dispatchEvent(inputEvent);

        // Dispatch change event
        const changeEvent = new Event('change', {
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(changeEvent);

        // Return the actual value set
        const finalValue = tagName === 'input' || tagName === 'textarea' ? el.value : el.textContent;
        return { input: true, value: finalValue };
      } catch (e) {
        return { input: false, error: e.message || String(e) };
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
    console.error(`❌ [KeyboardInput] JavaScript execution error:`, error);
    return {
      success: false,
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
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
    elementId,
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
 * @param elementId Cached element ID from the latest highlight (for example, "1")
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
  const element = elementCache.getElementById(conversationId, tabId, elementId);
  if (!element) {
    console.log(`❌ [ElementSelect] Element ${elementId} not found in cache`);
    return {
      success: false,
      elementId,
      selected: false,
      staleElement: false,
      error: buildElementCacheMissMessage(elementId),
    };
  }

  console.log(
    `✅ [ElementSelect] Found element: selector="${element.selector}"`,
  );

  // ============================================================
  // STEP 2: Build JavaScript to select option(s)
  // ============================================================
  // Escape quotes and backslashes in selector for safe injection
  const escapedSelector = element.selector
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  // Serialize value for JavaScript injection
  const valueJson = JSON.stringify(value);

  const script = `
    (function() {
      const selector = "${escapedSelector}";
      const value = ${valueJson};

      const el = document.querySelector(selector);

      if (!el) {
        return { selected: false, error: "Element not found in DOM", stale: true };
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

        // Helper to find option by value
        const findByValue = (v) => options.find(opt => opt.value === v);

        // Select by value
        if (Array.isArray(value)) {
          // Multi-select: clear all first, then select multiple
          el.selectedIndex = -1;
          for (const v of value) {
            const opt = findByValue(v);
            if (opt) {
              opt.selected = true;
              selectedOptions.push(opt);
            }
          }
        } else {
          // Single select by value
          const opt = findByValue(value);
          if (opt) {
            el.value = opt.value;
            selectedOptions.push(opt);
          }
        }

        // Check if any options were found
        if (selectedOptions.length === 0) {
          return {
            selected: false,
            error: \`Option not found for value: \${JSON.stringify(value)}\`
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
      elementId,
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
      elementId,
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
      elementId,
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
      elementId,
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
    elementId,
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
 * Export element actions module
 */
export const elementActions = {
  performElementClick,
  performElementHover,
  performElementScroll,
  performKeyboardInput,
  performElementSelect,
};
