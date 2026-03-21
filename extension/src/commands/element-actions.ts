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

import { elementCache } from './element-cache';
import { executeJavaScript, type JavaScriptResult } from './javascript';
import { buildHitTestVisibilityHelpersScript } from '../utils/hit-test-visibility';

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
 * @param elementId Cached element ID (e.g., "click-1", "scroll-1")
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
      error: `Element '${elementId}' not found in cache. The element cache expires after 2 minutes. Call highlight_elements() first to refresh the cache and get updated element IDs.`,
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
    (function() {
      const selector = "${escapedSelector}";
      ${buildHitTestVisibilityHelpersScript()}
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

      // Full event sequence for React/Vue compatibility
      // NOTE: Synthetic events have isTrusted=false, which some frameworks check
      const eventOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,  // Allow events to cross shadow DOM boundaries
        view: window,
        button: 0,
        buttons: 1,
      };

      try {
        // Focus the element BEFORE events (important for React/Vue form validation)
        if (typeof el.focus === 'function') {
          el.focus();
          // Dispatch focus event for frameworks
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }));
        }

        // Pointer events sequence
        const pointerEvents = ['pointerdown', 'pointerup'];
        for (const eventType of pointerEvents) {
          const event = new PointerEvent(eventType, {
            ...eventOptions,
            pointerType: 'mouse',
            isPrimary: true,
          });
          el.dispatchEvent(event);
        }

        // Native click as fallback - some frameworks only respond to native clicks
        // This is a no-op if synthetic events already triggered the action
        try {
          el.click();
        } catch (nativeClickError) {
          // Ignore native click errors, synthetic events may have already worked
        }

        return { clicked: true };
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
      false,
      timeout,
    );
  } catch (error) {
    console.error(`❌ [ElementClick] JavaScript execution error:`, error);
    return {
      success: false,
      elementId,
      clicked: false,
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
    console.log(`❌ [ElementClick] Click execution failed: ${jsResult.error}`);
    return {
      success: false,
      elementId,
      clicked: false,
      staleElement: false,
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
    console.error(
      `❌ [ElementClick] Invalid JavaScript result.value structure:`,
      jsResult.result?.value,
    );
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
 * @param elementId Cached element ID (e.g., "click-1", "scroll-1")
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
      error: `Element '${elementId}' not found in cache. Cache expires after 2 minutes. Call highlight_elements() first.`,
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
 * @param direction Scroll direction ('up', 'down', 'left', 'right')
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
        error: `Element '${elementId}' not found in cache. Cache expires after 2 minutes. Call highlight_elements() first.`,
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
      error: `Element '${elementId}' not found in cache. Cache expires after 2 minutes. Call highlight_elements() first.`,
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
        // Focus the element first
        if (typeof el.focus === 'function') {
          el.focus();
        }

        // Set value based on element type
        const tagName = el.tagName.toLowerCase();
        const isContentEditable = el.isContentEditable || el.contentEditable === 'true';

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
 * @param elementId Cached element ID (6-char hash)
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
      error: `Element '${elementId}' not found in cache. Cache expires after 2 minutes. Call highlight_elements() first.`,
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
