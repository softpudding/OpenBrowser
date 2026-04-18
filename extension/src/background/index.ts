/**
 * Background Script - Main entry point for Chrome extension (Strict Mode)
 *
 * All commands require conversation_id to be provided by server.
 * No default fallback behavior.
 */

import { wsClient } from '../websocket/client';
import { CommandScheduler } from './command-scheduler';
import {
  captureScreenshot,
  compressIfNeeded,
  getCompressionThreshold,
} from '../commands/screenshot';
import { DialogBlockedError } from '../commands/screenshot';
import { DialogType } from '../commands/dialog';
import { tabs } from '../commands/tabs';
import { tabManager } from '../commands/tab-manager';
import { javascript } from '../commands/javascript';
import { debuggerSessionManager } from '../commands/debugger-manager';
import { dialogManager } from '../commands/dialog';
import { clearScreenshotCache } from '../commands/computer';

import { highlightSingleElement } from '../commands/single-highlight';
import { highlightDropPreview } from '../commands/drop-preview-highlight';
import { elementCache } from '../commands/element-cache';
import { assignHashedElementIds } from '../commands/element-id';
import { buildElementCacheMissMessage } from '../commands/element-cache';
import {
  buildHighlightDetectionScript,
  filterHighlightElementsByKeywords,
} from '../commands/highlight-detection';
import {
  performElementClick,
  performElementHover,
  performElementScroll,
  performElementSwipe,
  performElementDragAndDrop,
  performElementSetSlider,
  performElementUpload,
  performKeyboardInput,
  performElementSelect,
  replayHoverState,
  clearHoverState,
} from '../commands/element-actions';
import {
  LABEL_FONT_SIZE,
  LABEL_PADDING,
  LABEL_HEIGHT,
  MAX_LABEL_WIDTH,
} from '../commands/label-constants';
import { getOrCreateUUID } from '../uuid/uuidGenerator';
import {
  isLabelWithinViewport,
  paginateCollisionFreeElements,
  sortElementsByVisualOrder,
  type LabelPosition,
} from '../utils/collision-detection';
import {
  HIGHLIGHT_CONSISTENCY_CONFIG,
  evaluateHighlightConsistency,
  isRepeatedHighlightDrift,
  type HighlightConsistencyResult,
} from '../utils/highlight-consistency';
import {
  getHighlightReadinessRetryDelay,
  type HighlightPageState,
} from '../utils/layout-stability';
import {
  TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
  type ScreenshotCaptureOptions,
} from '../utils/highlight-screenshot';
import {
  getRecordingState,
  handleContentRecordingEvent,
  handleContentRecordingPreAction,
  initializeRecordingEventListeners,
  startRecording,
  stopRecording,
} from '../recording/recorder';
import type {
  Command,
  CommandResponse,
  ElementType,
  InteractiveElement,
} from '../types';
console.log('🚀 OpenBrowser extension starting (Strict Mode)...');

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';
let currentConnectionId: string | null = null;

initializeRecordingEventListeners();

async function compressScreenshotResult<T extends { imageData?: string }>(
  screenshotResult: T | null | undefined,
): Promise<T | null | undefined> {
  if (!screenshotResult?.imageData) {
    return screenshotResult;
  }

  const compressedResult = await compressIfNeeded(
    screenshotResult,
    getCompressionThreshold(),
  );

  return (compressedResult as T | null | undefined) ?? screenshotResult;
}

async function runHighlightPreconditionWarmup(options: {
  tabId: number;
  conversationId: string;
  elementType: ElementType;
  page: number;
  waitForRender?: number;
  captureOptions?: ScreenshotCaptureOptions;
  logLabel?: string;
}): Promise<void> {
  const {
    tabId,
    conversationId,
    elementType,
    page,
    waitForRender = 350,
    captureOptions = TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
    logLabel = 'HighlightElements',
  } = options;
  const warmupStart = Date.now();
  console.log(
    `🔥 [${logLabel}] Starting screenshot warmup precondition for elementType=${elementType}, page=${page}`,
  );

  await captureScreenshot(
    tabId,
    conversationId,
    true,
    90,
    false,
    waitForRender,
    captureOptions,
  );

  console.log(
    `🔥 [${logLabel}] Screenshot warmup precondition completed in ${Date.now() - warmupStart}ms`,
  );
}

async function runRawScreenshotPrime(options: {
  tabId: number;
  conversationId: string;
  waitForRender?: number;
  captureOptions?: ScreenshotCaptureOptions;
  logLabel?: string;
}): Promise<void> {
  const {
    tabId,
    conversationId,
    waitForRender = 350,
    captureOptions = TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
    logLabel = 'HighlightPrime',
  } = options;
  const primeStart = Date.now();
  console.log(`🔥 [${logLabel}] Starting raw screenshot wake-up prime`);

  await captureScreenshot(
    tabId,
    conversationId,
    true,
    90,
    false,
    waitForRender,
    captureOptions,
  );

  console.log(
    `🔥 [${logLabel}] Raw screenshot wake-up prime completed in ${Date.now() - primeStart}ms`,
  );
}

const LABEL_POSITION_FALLBACK_ORDER: LabelPosition[] = [
  'above',
  'below',
  'left',
  'right',
];

// Keyword-mode bypasses the collision planner (it must show all matches on
// one page), but the renderer still needs a labelPosition that fits in the
// viewport — otherwise the label is clipped by the overlay's overflow:hidden.
function assignViewportFeasibleLabelPosition(
  element: InteractiveElement,
  viewportWidth: number,
  viewportHeight: number,
): InteractiveElement {
  if (element.labelPosition) {
    return element;
  }

  for (const position of LABEL_POSITION_FALLBACK_ORDER) {
    if (
      isLabelWithinViewport(
        element.bbox,
        position,
        viewportWidth,
        viewportHeight,
        element.id,
      )
    ) {
      return { ...element, labelPosition: position };
    }
  }

  return { ...element, labelPosition: 'above' };
}

function buildStoredHighlightPages(options: {
  filteredElements: InteractiveElement[];
  viewportWidth: number;
  viewportHeight: number;
  keywordMode: boolean;
}): InteractiveElement[][] {
  const { filteredElements, viewportWidth, viewportHeight, keywordMode } =
    options;

  if (keywordMode) {
    const placed = filteredElements.map((element) =>
      assignViewportFeasibleLabelPosition(
        element,
        viewportWidth,
        viewportHeight,
      ),
    );
    return [sortElementsByVisualOrder(placed)];
  }

  const collisionFreePages = paginateCollisionFreeElements(
    filteredElements,
    viewportWidth,
    viewportHeight,
  );
  return collisionFreePages.map((collisionFreePage) =>
    sortElementsByVisualOrder(collisionFreePage),
  );
}

function buildHighlightConsistencyScript(
  elements: InteractiveElement[],
): string {
  const samples = elements
    .slice(0, HIGHLIGHT_CONSISTENCY_CONFIG.maxSampleSize)
    .map((element) => ({
      id: element.id,
      selector: element.selector,
      bbox: element.bbox,
    }));

  return `
    (() => {
      const samples = ${JSON.stringify(samples)};

      function getBBox(el) {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }

      return {
        samples: samples.flatMap((sample) => {
          try {
            const el = document.querySelector(sample.selector);
            if (!el) {
              return [];
            }

            return [{
              id: sample.id,
              bbox: getBBox(el),
            }];
          } catch (error) {
            return [];
          }
        }),
      };
    })();
  `;
}

const IN_PAGE_HIGHLIGHT_COLORS: Record<string, { border: string; bg: string }> =
  {
    clickable: { border: '#0066FF', bg: 'rgba(0,102,255,0.7)' },
    scrollable: { border: '#00CC66', bg: 'rgba(0,204,102,0.7)' },
    inputable: { border: '#FF9900', bg: 'rgba(255,153,0,0.7)' },
    selectable: { border: '#FF6B6B', bg: 'rgba(255,107,107,0.7)' },
    draggable: { border: '#FF6600', bg: 'rgba(255,102,0,0.7)' },
    droppable: { border: '#339966', bg: 'rgba(51,153,102,0.7)' },
    uploadable: { border: '#AA66FF', bg: 'rgba(170,102,255,0.7)' },
    any: { border: '#00CCCC', bg: 'rgba(0,204,204,0.7)' },
  };

const OB_HIGHLIGHT_OVERLAY_ID = '__ob_highlight_overlay__';
const OB_HIGHLIGHT_ATTR = 'data-ob-hl';

function buildInPageHighlightScript(elements: InteractiveElement[]): string {
  const items = elements.map((el) => {
    const colors =
      IN_PAGE_HIGHLIGHT_COLORS[el.type] || IN_PAGE_HIGHLIGHT_COLORS.clickable;
    return {
      id: el.id,
      // The overlay script renders the box on `selector`. For uploadable
      // file inputs that are display:none, the visible anchor's selector
      // lets the overlay land on something the user can actually see.
      selector: el.overlaySelector || el.selector,
      borderColor: colors.border,
      bgColor: colors.bg,
      labelPos: el.labelPosition || 'above',
    };
  });

  return `
    (() => {
      const items = ${JSON.stringify(items)};
      const OVERLAY_ID = ${JSON.stringify(OB_HIGHLIGHT_OVERLAY_ID)};
      const HL_ATTR = ${JSON.stringify(OB_HIGHLIGHT_ATTR)};
      const LABEL_FONT_SIZE = ${LABEL_FONT_SIZE};
      const LABEL_PADDING = ${LABEL_PADDING};
      const MAX_LABEL_WIDTH = ${MAX_LABEL_WIDTH};

      // Snapshot + restore helpers so we don't leak our overrides onto the
      // page when pre-existing inline styles are present.
      const SAVED_ATTR = HL_ATTR + '-saved';
      const OVERRIDES = ['transition', 'box-shadow'];
      const snapshotOverrides = (el) => {
        const snap = {};
        for (const p of OVERRIDES) {
          snap[p] = {
            v: el.style.getPropertyValue(p),
            i: el.style.getPropertyPriority(p),
          };
        }
        el.setAttribute(SAVED_ATTR, JSON.stringify(snap));
      };
      const restoreOverrides = (el) => {
        let snap = {};
        try { snap = JSON.parse(el.getAttribute(SAVED_ATTR) || '{}'); } catch (_) {}
        for (const p of OVERRIDES) {
          const saved = snap[p];
          if (saved && saved.v) {
            el.style.setProperty(p, saved.v, saved.i || '');
          } else {
            el.style.removeProperty(p);
          }
        }
        el.removeAttribute(SAVED_ATTR);
      };

      // Remove any previous highlights
      document.getElementById(OVERLAY_ID)?.remove();
      document.querySelectorAll('[' + HL_ATTR + ']').forEach(el => {
        restoreOverrides(el);
        el.removeAttribute(HL_ATTR);
      });

      // Create overlay for labels only (boxes use inset box-shadow on elements)
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:hidden;';
      document.documentElement.appendChild(overlay);

      const bboxes = [];
      // box-sizing:border-box so max-width caps the total rendered width
      // (matching the collision planner's MAX_LABEL_WIDTH, which is the full
      // label width including padding).
      const LABEL_BASE_CSS = 'position:fixed;box-sizing:border-box;'
        + 'font:bold ' + LABEL_FONT_SIZE + 'px/' + LABEL_FONT_SIZE + 'px Arial,sans-serif;'
        + 'color:#fff;padding:' + LABEL_PADDING + 'px;border-radius:2px;'
        + 'white-space:nowrap;pointer-events:none;overflow:hidden;text-overflow:ellipsis;'
        + 'max-width:' + MAX_LABEL_WIDTH + 'px;';

      for (const item of items) {
        try {
          const el = document.querySelector(item.selector);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;

          // Skip elements whose center is covered by something else (e.g. a
          // button hidden behind a modal popup). Without this check, the
          // border is still drawn inside the hidden element and the label
          // floats free over whatever is actually on top.
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
            const hit = document.elementFromPoint(cx, cy);
            if (hit && hit !== el && !el.contains(hit)) continue;
          }

          // Snapshot any inline transition/box-shadow so cleanup can restore
          // them exactly (including !important priority) instead of stripping.
          snapshotOverrides(el);
          // Disable CSS transitions so the page can't animate the shadow in
          // (e.g. sidebar items with "transition: all 0.2s" would cause the
          // CDP screenshot to catch the box-shadow mid-interpolation and the
          // border would render thinner than the specified 3px).
          el.style.setProperty('transition', 'none', 'important');
          // Adapt border thickness to element size: tight targets (small
          // buttons, checkboxes) get 2px so the stroke doesn't dominate; larger
          // targets (menu items, sections) get 3px so the stroke stays visible
          // against a bigger empty interior.
          const borderPx = Math.min(rect.width, rect.height) > 32 ? 3 : 2;
          el.style.setProperty(
            'box-shadow',
            'inset 0 0 0 ' + borderPx + 'px ' + item.borderColor,
            'important',
          );
          el.setAttribute(HL_ATTR, item.id);

          // Render label off-screen first to measure actual dimensions, then
          // position it using the measured size — keeps positioning consistent
          // with the collision-detection model (which uses actual label width).
          const label = document.createElement('div');
          label.style.cssText = LABEL_BASE_CSS + 'left:-9999px;top:0;background:' + item.bgColor + ';';
          label.textContent = item.id;
          overlay.appendChild(label);

          const labelRect = label.getBoundingClientRect();
          const labelW = labelRect.width;
          const labelH = labelRect.height;

          let lx, ly;
          switch (item.labelPos) {
            case 'below': lx = rect.left;            ly = rect.bottom;       break;
            case 'left':  lx = rect.left - labelW;   ly = rect.top;          break;
            case 'right': lx = rect.right;           ly = rect.top;          break;
            default:      lx = rect.left;            ly = rect.top - labelH; break;
          }

          label.style.left = lx + 'px';
          label.style.top = ly + 'px';

          bboxes.push({ id: item.id, bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
        } catch (e) { /* skip */ }
      }

      return { bboxes };
    })();
  `;
}

function buildHighlightCleanupScript(): string {
  return `
    (() => {
      const HL_ATTR = ${JSON.stringify(OB_HIGHLIGHT_ATTR)};
      const SAVED_ATTR = HL_ATTR + '-saved';
      const OVERRIDES = ['transition', 'box-shadow'];
      document.getElementById(${JSON.stringify(OB_HIGHLIGHT_OVERLAY_ID)})?.remove();
      document.querySelectorAll('[' + HL_ATTR + ']').forEach(el => {
        let snap = {};
        try { snap = JSON.parse(el.getAttribute(SAVED_ATTR) || '{}'); } catch (_) {}
        for (const p of OVERRIDES) {
          const saved = snap[p];
          if (saved && saved.v) {
            el.style.setProperty(p, saved.v, saved.i || '');
          } else {
            el.style.removeProperty(p);
          }
        }
        el.removeAttribute(SAVED_ATTR);
        el.removeAttribute(HL_ATTR);
      });
    })();
  `;
}

interface ScreenshotPayload {
  screenshot?: string;
  dialog_auto_accepted?: unknown;
  dialog_auto_accepted_list?: unknown;
}

interface HighlightedPageStateData extends ScreenshotPayload {
  elements: InteractiveElement[];
  totalElements: number;
  totalPages: number;
  page: number;
  pageState: HighlightPageState;
  readinessReasons: string[];
}

interface HighlightedPageCaptureOptions {
  tabId: number;
  conversationId: string;
  elementType?: ElementType;
  page?: number;
  keywords?: string[];
  logLabel?: string;
  preconditionWaitForRender?: number;
  preconditionCaptureOptions?: ScreenshotCaptureOptions;
}

function buildScreenshotPayload(
  screenshotResult:
    | {
        imageData?: string;
        dialog_auto_accepted?: unknown;
        dialog_auto_accepted_list?: unknown;
      }
    | null
    | undefined,
): ScreenshotPayload {
  return {
    screenshot: screenshotResult?.imageData,
    ...(screenshotResult?.dialog_auto_accepted
      ? {
          dialog_auto_accepted: screenshotResult.dialog_auto_accepted,
        }
      : {}),
    ...(screenshotResult?.dialog_auto_accepted_list
      ? {
          dialog_auto_accepted_list: screenshotResult.dialog_auto_accepted_list,
        }
      : {}),
  };
}

async function captureHighlightedPageState(
  options: HighlightedPageCaptureOptions,
): Promise<HighlightedPageStateData> {
  const {
    tabId,
    conversationId,
    elementType = 'any',
    page = 1,
    keywords,
    logLabel = 'HighlightElements',
    preconditionWaitForRender,
    preconditionCaptureOptions,
  } = options;

  await tabManager.ensureTabManaged(tabId, conversationId);
  tabManager.updateTabActivity(tabId, conversationId);

  await runHighlightPreconditionWarmup({
    tabId,
    conversationId,
    elementType,
    page,
    waitForRender: preconditionWaitForRender,
    captureOptions: preconditionCaptureOptions,
    logLabel,
  });

  const maxHighlightAttempts = 3;
  const highlightDetectionTimeoutMs = 18000;
  let previousConsistency: HighlightConsistencyResult | null = null;

  for (let attempt = 1; attempt <= maxHighlightAttempts; attempt++) {
    console.log(`🔁 [${logLabel}] Attempt ${attempt}/${maxHighlightAttempts}`);
    const detectionScript = buildHighlightDetectionScript({
      elementType,
      fullPageScanOnNotReady: attempt === maxHighlightAttempts,
    });

    const detectionResult = await javascript.executeJavaScript(
      tabId,
      conversationId,
      detectionScript,
      true,
      true,
      highlightDetectionTimeoutMs,
    );

    if (!detectionResult.success || !detectionResult.result?.value) {
      throw new Error(detectionResult.error || 'Failed to detect elements');
    }

    const allElements = detectionResult.result.value.elements || [];
    const detectedDocumentId =
      typeof detectionResult.result.value.documentId === 'string'
        ? detectionResult.result.value.documentId
        : '';
    const detectedViewport = detectionResult.result.value.viewport || {};
    const layoutStability = detectionResult.result.value.layoutStability;
    const inPagePerf = detectionResult.result.value._perf || {};
    const highlightTraceStart = Date.now();
    let paginationMs = 0;
    let screenshotMs = 0;
    let consistencyMs = 0;
    const detectedViewportWidth =
      typeof detectedViewport.width === 'number' ? detectedViewport.width : 0;
    const detectedViewportHeight =
      typeof detectedViewport.height === 'number' ? detectedViewport.height : 0;
    if (layoutStability) {
      console.log(
        `⏳ [${logLabel}] Readiness snapshot: ${JSON.stringify(layoutStability)}`,
      );
    }

    const pageState: HighlightPageState = layoutStability?.state || 'ready';
    const readinessReasons = Array.isArray(layoutStability?.reasons)
      ? layoutStability.reasons
      : [];

    if (pageState === 'not_ready' && attempt < maxHighlightAttempts) {
      const retryDelayMs = getHighlightReadinessRetryDelay(attempt);
      console.warn(
        `⚠️ [${logLabel}] Readiness state is not_ready (${readinessReasons.join(', ') || 'no reasons'}), retrying in ${retryDelayMs}ms (attempt ${attempt}/${maxHighlightAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    const keywordFilterStart = Date.now();
    const keywordFiltering = filterHighlightElementsByKeywords(
      allElements,
      keywords,
    );
    const keywordList = keywordFiltering.keywords;
    const filteredElements = assignHashedElementIds(keywordFiltering.elements);

    if (keywordList.length > 0) {
      console.log(
        `🔍 [${logLabel}] Keywords [${keywordList.join(', ')}] matched ${filteredElements.length} of ${allElements.length} elements`,
      );
    }
    console.log(
      `⏱️ [HighlightTrace] background keyword-filter ${Date.now() - keywordFilterStart}ms (keywords=${keywordList.length}, kept=${filteredElements.length}/${allElements.length})`,
    );

    let storedPages: InteractiveElement[][];
    let paginatedElements: InteractiveElement[];
    let totalPages: number;
    let currentPage = page;

    if (keywordList.length > 0) {
      storedPages = buildStoredHighlightPages({
        filteredElements,
        viewportWidth: detectedViewportWidth,
        viewportHeight: detectedViewportHeight,
        keywordMode: true,
      });
      paginatedElements = storedPages[0] ?? [];
      totalPages = storedPages.length || 1;
      currentPage = 1;
      console.log(
        `🔍 [${logLabel}] Keywords [${keywordList.join(', ')}] matched ${paginatedElements.length} elements (no pagination)`,
      );
    } else {
      const paginationBuildStart = Date.now();
      storedPages = buildStoredHighlightPages({
        filteredElements,
        viewportWidth: detectedViewportWidth,
        viewportHeight: detectedViewportHeight,
        keywordMode: false,
      });
      paginatedElements = storedPages[Math.max(0, page - 1)] ?? [];
      totalPages = storedPages.length;
      console.log(
        `📄 [${logLabel}] Page ${page}/${totalPages}, showing ${paginatedElements.length} of ${filteredElements.length} elements`,
      );
      paginationMs = Date.now() - paginationBuildStart;
      console.log(
        `⏱️ [HighlightTrace] background pagination build-pages=${paginationMs}ms (page=${page}, viewport=${detectedViewportWidth}x${detectedViewportHeight})`,
      );
    }

    // Inject highlights into the page DOM before capturing. Using CSS
    // outlines on elements guarantees pixel-perfect alignment because the
    // browser renders them as part of the element — no bbox-to-screenshot
    // coordinate mapping needed. This eliminates hidden-tab layout
    // discrepancies where getBoundingClientRect() and Page.captureScreenshot
    // see different geometry.
    const highlightScript = buildInPageHighlightScript(paginatedElements);
    const screenshotStart = Date.now();
    const screenshotResult = await captureScreenshot(
      tabId,
      conversationId,
      true,
      90,
      false,
      0,
      TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
      highlightScript,
    );

    // Clean up injected highlights from the DOM
    try {
      await javascript.executeJavaScript(
        tabId,
        conversationId,
        buildHighlightCleanupScript(),
        true,
        false,
        2000,
      );
    } catch (e) {
      console.warn(`⚠️ [${logLabel}] highlight cleanup failed: ${e}`);
    }

    if (!screenshotResult?.success || !screenshotResult?.imageData) {
      throw new Error(
        `Failed to capture screenshot: ${screenshotResult?.success === false ? 'Screenshot command failed' : 'No image data returned'}`,
      );
    }
    console.log(
      `📸 [${logLabel}] Screenshot captured (with in-page highlights), size: ${screenshotResult.imageData.length} bytes`,
    );
    screenshotMs = Date.now() - screenshotStart;
    console.log(`⏱️ [HighlightTrace] background screenshot ${screenshotMs}ms`);

    // Apply bboxes returned from the highlight injection script
    const preCaptureData = screenshotResult.preCaptureResult;
    if (preCaptureData?.bboxes && Array.isArray(preCaptureData.bboxes)) {
      const bboxMap = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      for (const entry of preCaptureData.bboxes) {
        if (entry.id && entry.bbox) {
          bboxMap.set(entry.id, entry.bbox);
        }
      }
      for (const element of filteredElements) {
        const freshBbox = bboxMap.get(element.id);
        if (freshBbox) {
          element.bbox = freshBbox;
        }
      }
    }

    const imageScale =
      screenshotResult.metadata?.imageScale ||
      screenshotResult.metadata?.devicePixelRatio ||
      1;
    const viewportWidth = screenshotResult.metadata?.viewportWidth || 0;
    const viewportHeight = screenshotResult.metadata?.viewportHeight || 0;
    console.log(`📐 [${logLabel}] Image scale: ${imageScale}`);
    console.log(
      `📐 [${logLabel}] Viewport: ${viewportWidth}x${viewportHeight} CSS pixels`,
    );
    console.log(
      `📐 [${logLabel}] Expected image size: ${Math.round(viewportWidth * imageScale)}x${Math.round(viewportHeight * imageScale)} device pixels`,
    );

    const consistencyCheckStart = Date.now();
    const consistencyScript =
      buildHighlightConsistencyScript(paginatedElements);
    const consistencyResult = await javascript.executeJavaScript(
      tabId,
      conversationId,
      consistencyScript,
      true,
      false,
      2000,
    );
    const currentConsistencySamples =
      consistencyResult.success &&
      consistencyResult.result?.value?.samples &&
      Array.isArray(consistencyResult.result.value.samples)
        ? consistencyResult.result.value.samples
        : [];
    const highlightConsistency = evaluateHighlightConsistency(
      paginatedElements
        .slice(0, HIGHLIGHT_CONSISTENCY_CONFIG.maxSampleSize)
        .map((element) => ({
          id: element.id,
          bbox: element.bbox,
        })),
      currentConsistencySamples,
    );
    consistencyMs = Date.now() - consistencyCheckStart;
    console.log(
      `⏱️ [HighlightTrace] background consistency-check ${consistencyMs}ms (checked=${highlightConsistency.checkedCount}, matched=${highlightConsistency.matchedCount}, missing=${highlightConsistency.missingCount}, shifted=${highlightConsistency.shiftedCount}, maxCenterShift=${highlightConsistency.maxCenterShift}, maxSizeDelta=${highlightConsistency.maxSizeDelta}, retry=${highlightConsistency.shouldRetry})`,
    );
    const repeatedDrift = isRepeatedHighlightDrift(
      highlightConsistency,
      previousConsistency,
    );

    if (
      highlightConsistency.shouldRetry &&
      attempt < maxHighlightAttempts &&
      !repeatedDrift
    ) {
      previousConsistency = highlightConsistency;
      console.warn(
        `⚠️ [${logLabel}] Layout drift detected after screenshot, retrying (attempt ${attempt}/${maxHighlightAttempts})`,
      );
      continue;
    }

    if (highlightConsistency.shouldRetry) {
      console.warn(
        repeatedDrift
          ? `⚠️ [${logLabel}] Layout drift repeated with near-identical metrics, returning latest screenshot`
          : `⚠️ [${logLabel}] Layout drift still detected on final attempt, returning latest screenshot`,
      );
    }

    const displayOrderedElements = storedPages[currentPage - 1] ?? [];

    const cacheStoreStart = Date.now();
    const storedPage = elementCache.storeHighlightResult({
      conversationId,
      tabId,
      documentId: detectedDocumentId,
      elementType,
      keywords: keywordList,
      totalElements: filteredElements.length,
      totalPages,
      pages: storedPages,
      page: currentPage,
    });
    console.log(
      `⏱️ [HighlightTrace] background cache-store ${Date.now() - cacheStoreStart}ms (page=${storedPage.page}, count=${displayOrderedElements.length})`,
    );

    if (displayOrderedElements.length > 0) {
      console.log(
        `📍 [${logLabel}] First element bbox:`,
        JSON.stringify(displayOrderedElements[0].bbox),
      );
    }

    // Highlights are already baked into the screenshot via in-page injection.
    // Just compress the screenshot directly — no post-hoc drawing needed.
    const compressStart = Date.now();
    const compressedScreenshotResult = await compressScreenshotResult({
      imageData: screenshotResult.imageData,
      dialog_auto_accepted: screenshotResult.dialog_auto_accepted,
      dialog_auto_accepted_list: screenshotResult.dialog_auto_accepted_list,
    });
    console.log(
      `⏱️ [HighlightTrace] background compress ${Date.now() - compressStart}ms`,
    );
    console.log(
      `⏱️ [HighlightTrace] background total ${Date.now() - highlightTraceStart}ms`,
    );

    return {
      elements: storedPage.elements,
      totalElements: filteredElements.length,
      totalPages,
      page: currentPage,
      pageState,
      readinessReasons,
      _perf: {
        scan_ms:
          typeof inPagePerf.scan_ms === 'number' ? inPagePerf.scan_ms : 0,
        scan_stats: inPagePerf.scan_stats || {},
        scan_times: inPagePerf.scan_times || {},
        pagination_ms: paginationMs,
        screenshot_ms: screenshotMs,
        consistency_ms: consistencyMs,
      },
      ...buildScreenshotPayload(compressedScreenshotResult),
    };
  }

  throw new Error('Failed to produce a stable highlight screenshot');
}

async function captureDefaultHighlightedPageState(options: {
  tabId: number;
  conversationId: string;
  logLabel: string;
  preconditionWaitForRender?: number;
  preconditionCaptureOptions?: ScreenshotCaptureOptions;
  primeWithRawScreenshot?: boolean;
  primeWaitForRender?: number;
  primeCaptureOptions?: ScreenshotCaptureOptions;
}): Promise<HighlightedPageStateData | ScreenshotPayload> {
  const {
    tabId,
    conversationId,
    logLabel,
    preconditionWaitForRender,
    preconditionCaptureOptions,
    primeWithRawScreenshot = false,
    primeWaitForRender,
    primeCaptureOptions,
  } = options;
  const effectivePreconditionWaitForRender = preconditionWaitForRender ?? 350;
  const effectivePreconditionCaptureOptions =
    preconditionCaptureOptions ?? TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS;

  if (primeWithRawScreenshot) {
    await runRawScreenshotPrime({
      tabId,
      conversationId,
      waitForRender: primeWaitForRender ?? effectivePreconditionWaitForRender,
      captureOptions:
        primeCaptureOptions ?? effectivePreconditionCaptureOptions,
      logLabel: `${logLabel} Prime`,
    });
  }

  try {
    return await captureHighlightedPageState({
      tabId,
      conversationId,
      elementType: 'any',
      page: 1,
      logLabel,
      preconditionWaitForRender: effectivePreconditionWaitForRender,
      preconditionCaptureOptions: effectivePreconditionCaptureOptions,
    });
  } catch (error) {
    console.warn(
      `⚠️ [${logLabel}] Default any/page 1 highlight failed, falling back to raw screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    const screenshotResult = await captureScreenshot(
      tabId,
      conversationId,
      true,
      90,
      false,
      effectivePreconditionWaitForRender,
      effectivePreconditionCaptureOptions,
    );
    const compressedScreenshotResult =
      await compressScreenshotResult(screenshotResult);
    return buildScreenshotPayload(compressedScreenshotResult);
  }
}

function cleanupTabState(conversationId: string, tabId: number): void {
  elementCache.invalidate(conversationId, tabId);
  clearHoverState(conversationId, tabId);
  dialogManager.disableForTab(tabId);
  clearScreenshotCache(tabId);
}

// ============================================================================
// Command Queue Management System
// ============================================================================

const commandPerformanceHistory: Array<{
  type: string;
  duration: number;
  timestamp: number;
}> = [];
const MAX_COMMAND_PERFORMANCE_HISTORY = 20;

function getCommandSchedulingKey(data: any): string {
  if (typeof data?.conversation_id === 'string' && data.conversation_id) {
    return data.conversation_id;
  }
  if (typeof data?.tab_id === 'number') {
    return `tab:${data.tab_id}`;
  }
  if (typeof data?.command_id === 'string' && data.command_id) {
    return `command:${data.command_id}`;
  }
  return '__global__';
}

function isHeavyBrowserCommand(data: any): boolean {
  switch (data?.type) {
    case 'highlight_elements':
    case 'highlight_single_element':
    case 'highlight_drop_preview':
    case 'screenshot':
    case 'javascript_execute':
    case 'click_element':
    case 'hover_element':
    case 'scroll_element':
    case 'swipe_element':
    case 'drag_and_drop_element':
    case 'set_slider_value':
    case 'keyboard_input':
    case 'select_element':
    case 'upload_file':
    case 'handle_dialog':
      return true;
    case 'tab':
      return (
        data?.action === 'init' ||
        data?.action === 'open' ||
        data?.action === 'switch' ||
        data?.action === 'refresh' ||
        data?.action === 'view' ||
        data?.action === 'back' ||
        data?.action === 'forward'
      );
    default:
      return false;
  }
}

function recordCommandPerformance(type: string, duration: number): void {
  commandPerformanceHistory.push({
    type,
    duration,
    timestamp: Date.now(),
  });

  if (commandPerformanceHistory.length > MAX_COMMAND_PERFORMANCE_HISTORY) {
    commandPerformanceHistory.shift();
  }

  if (commandPerformanceHistory.length < 5) {
    return;
  }

  const recent = commandPerformanceHistory.slice(-5);
  const avgDuration =
    recent.reduce((sum, cmd) => sum + cmd.duration, 0) / recent.length;

  if (avgDuration > 5000) {
    console.warn(
      `📉 Performance degradation detected: avg command time ${avgDuration.toFixed(0)}ms`,
    );
  }
}

async function processQueuedCommand(data: any): Promise<any> {
  watchdog.tick();

  const commandId = data.command_id || `unknown_${Date.now()}`;
  const commandType = data.type || 'unknown';
  const commandStartTime = Date.now();

  wsClient.trackCommandStart(commandId, commandType, {
    conversation_id: data.conversation_id,
    action: data.action,
    tab_id: data.tab_id,
    url: data.url,
  });

  try {
    const response = await handleCommand(data as Command);
    const commandDuration = Date.now() - commandStartTime;

    recordCommandPerformance(commandType, commandDuration);

    if (commandDuration > 10000) {
      console.warn(
        `⚠️ Long command execution: ${commandType} took ${commandDuration}ms`,
      );
    }

    if (wsClient.isConnected()) {
      const responseWithId = {
        ...response,
        command_id: data.command_id,
        timestamp: Date.now(),
      };

      wsClient
        .sendMessage({
          type: 'command_response',
          ...responseWithId,
        })
        .catch((error) => {
          console.error('Failed to send response:', error);
        });
    }

    return response;
  } catch (error) {
    console.error('Error handling command:', error);
    const commandDuration = Date.now() - commandStartTime;

    const errorResponse: CommandResponse = {
      success: false,
      command_id: data.command_id,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    };

    if (wsClient.isConnected()) {
      wsClient
        .sendMessage({ type: 'command_response', ...errorResponse })
        .catch(console.error);
    }

    if (commandDuration > 10000) {
      console.warn(
        `⚠️ Long failed command: ${commandType} failed after ${commandDuration}ms`,
      );
    }

    throw error;
  } finally {
    wsClient.trackCommandEnd(commandId);
  }
}

const commandQueue = new CommandScheduler<any, any>({
  processCommand: processQueuedCommand,
  getConversationKey: getCommandSchedulingKey,
  isHeavyCommand: isHeavyBrowserCommand,
  maxConcurrentCommands: 3,
  maxConcurrentHeavyCommands: 2,
});

// ============================================================================
// Watchdog Timer for Main Thread Freeze Detection
// ============================================================================

/**
 * Watchdog timer detects when main thread is frozen
 */
class WatchdogTimer {
  private lastCheckTime = Date.now();
  private watchdogInterval: number | null = null;
  private readonly CHECK_INTERVAL = 3000; // Check every 3 seconds
  private readonly FREEZE_THRESHOLD = 5000; // 5 seconds without check = frozen

  start(): void {
    console.log('🔍 Watchdog timer started');

    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }

    this.lastCheckTime = Date.now();

    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastCheck = now - this.lastCheckTime;

      if (timeSinceLastCheck > this.FREEZE_THRESHOLD) {
        console.error(
          `🚨 WATCHDOG: Main thread may be frozen! No check for ${timeSinceLastCheck}ms`,
        );

        // Emergency cleanup if main thread appears frozen
        this.emergencyCleanup();
      }

      this.lastCheckTime = now;
    }, this.CHECK_INTERVAL) as unknown as number;
  }

  stop(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
      console.log('🔍 Watchdog timer stopped');
    }
  }

  tick(): void {
    this.lastCheckTime = Date.now();
  }

  private emergencyCleanup(): void {
    console.warn('🆘 Watchdog emergency cleanup initiated');

    // Clear command queue to free up resources
    commandQueue.clearQueue();

    // Try to send heartbeat if WebSocket is still connected
    if (wsClient.isConnected()) {
      try {
        // Try to send immediate ping
        wsClient.sendMessage({ type: 'ping' }).catch(() => {
          // Ignore errors during emergency
        });
      } catch (error) {
        // Ignore errors during emergency cleanup
      }
    }
  }

  getStatus() {
    return {
      lastCheckTime: this.lastCheckTime,
      timeSinceLastCheck: Date.now() - this.lastCheckTime,
      isRunning: this.watchdogInterval !== null,
    };
  }
}

// Initialize watchdog timer
const watchdog = new WatchdogTimer();
watchdog.start();

// ============================================================================

// Initialize tab manager
tabManager
  .initialize()
  .then(() => {
    console.log('✅ Tab manager initialized');
  })
  .catch((error) => {
    console.error('❌ Failed to initialize tab manager:', error);
  });

// Initialize WebSocket connection
wsClient
  .connect()
  .then(() => {
    tabManager.updateStatus('idle');
    console.log('🌐 WebSocket connected, tab manager status updated');
  })
  .catch((error) => {
    console.error('Failed to connect to WebSocket server:', error);
    tabManager.updateStatus('disconnected');
  });

// Listen for WebSocket disconnection
wsClient.onDisconnect(() => {
  console.log('🌐 WebSocket disconnected, updating tab manager status');
  currentConnectionId = null;
  tabManager.updateStatus('disconnected');
});

// Listen for commands from WebSocket server
wsClient.onMessage(async (data) => {
  // Only handle command messages (not responses or server messages)
  if (data.type && !data.success && !data.error) {
    // Skip server messages that are not commands
    if (
      data.type === 'connected' ||
      data.type === 'ping' ||
      data.type === 'pong'
    ) {
      if (data.type === 'connected') {
        currentConnectionId =
          typeof data.connection_id === 'string' ? data.connection_id : null;

        if (currentConnectionId) {
          registerBrowserIdentity(currentConnectionId).catch((error) => {
            console.error('❌ Failed to register browser identity:', error);
          });
        }
      }
      console.log(
        `📨 Received server message: ${data.type}`,
        data.message || '',
      );
      return;
    }

    // Log command receipt
    const commandType = data.type || 'unknown';
    const commandId = data.command_id || `unknown_${Date.now()}`;
    console.log(`📨 Received command: ${commandType} (ID: ${commandId})`);

    // Add command to queue for processing
    try {
      await commandQueue.enqueue(data);
      console.log(
        `✅ Command ${commandType} (ID: ${commandId}) processed successfully`,
      );
    } catch (error) {
      console.error(
        `❌ Command ${commandType} (ID: ${commandId}) failed:`,
        error,
      );

      // Send error response if still connected
      if (wsClient.isConnected()) {
        const errorResponse: CommandResponse = {
          success: false,
          command_id: data.command_id,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        };
        wsClient
          .sendMessage({ type: 'command_response', ...errorResponse })
          .catch(console.error);
      }
    }
  }
});

async function openUuidPage(): Promise<void> {
  const uuidPageUrl = chrome.runtime.getURL('uuid/uuidPage.html');
  await chrome.tabs.create({ url: uuidPageUrl, active: true });
}

async function registerBrowserIdentity(connectionId: string): Promise<void> {
  const browserUuid = await getOrCreateUUID();
  const response = await fetch(`${SERVER_HTTP_URL}/browsers/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uuid: browserUuid,
      connection_id: connectionId,
      ttl_hours: 24,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Browser registration failed (${response.status}): ${errorText || response.statusText}`,
    );
  }

  console.log(`🔐 Browser UUID registered successfully: ${browserUuid}`);
}

chrome.runtime.onInstalled.addListener(() => {
  openUuidPage().catch((error) => {
    console.error('❌ Failed to open UUID page on install:', error);
  });
});

chrome.action.onClicked.addListener(() => {
  openUuidPage().catch((error) => {
    console.error('❌ Failed to open UUID page from action click:', error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openbrowser:get-recording-state') {
    void getRecordingState()
      .then((state) => {
        sendResponse(state);
      })
      .catch((error) => {
        console.warn('⚠️ Failed to resolve recording state:', error);
        sendResponse({
          active: false,
          recording_id: null,
          scope: null,
        });
      });
    return true;
  }

  if (message?.type === 'openbrowser:recording-event') {
    handleContentRecordingEvent(message, _sender)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error:
            error instanceof Error ? error.message : 'Recording event error',
        });
      });
    return true;
  }

  if (message?.type === 'openbrowser:recording-pre-action') {
    handleContentRecordingPreAction(message, _sender)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Recording pre-action error',
        });
      });
    return true;
  }

  if (message?.type !== 'openbrowser:register-browser-identity') {
    return false;
  }

  if (!currentConnectionId) {
    sendResponse({
      success: false,
      error: 'Extension is not connected to the OpenBrowser server yet.',
    });
    return false;
  }

  registerBrowserIdentity(currentConnectionId)
    .then(() => {
      sendResponse({ success: true });
    })
    .catch((error) => {
      sendResponse({
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown registration error',
      });
    });

  return true;
});

/**
 * Handle incoming commands (Strict Mode)
 * All commands require conversation_id to be provided by server.
 */
async function handleCommand(command: Command): Promise<CommandResponse> {
  console.log(`📨 Handling command: ${command.type}`, command);

  try {
    switch (command.type) {
      case 'recording_control': {
        if (command.action === 'start') {
          await startRecording(command.recording_id, command.launch_mode);
          return {
            success: true,
            message: `Recording ${command.recording_id} started`,
            data: await getRecordingState(),
            timestamp: Date.now(),
          };
        }

        await stopRecording(command.recording_id);
        return {
          success: true,
          message: `Recording ${command.recording_id} stopped`,
          data: await getRecordingState(),
          timestamp: Date.now(),
        };
      }

      case 'screenshot': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for screenshot command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;

        // Always use current active tab for the conversation (ignore tab_id if provided)
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init or specify tab_id.`,
          );
        }

        console.log(
          `📸 [Screenshot] Using active tab ${activeTabId} for conversation ${conversationId} (ignoring provided tab_id: ${command.tab_id || 'none'})`,
        );

        console.log(
          `📸 [Screenshot] Starting for tab ${activeTabId}, conversation: ${conversationId}`,
        );

        // Ensure tab is managed by tab manager for this conversation
        await tabManager.ensureTabManaged(activeTabId, conversationId);
        tabManager.updateTabActivity(activeTabId, conversationId);

        // Take screenshot in background (no tab activation)
        const screenshotResult = await captureScreenshot(
          activeTabId,
          conversationId,
          command.include_cursor !== false,
          command.quality || 90,
          false, // resizeToPreset: false for WYSIWYG mode
          0, // waitForRender
        );
        const compressedScreenshotResult =
          await compressScreenshotResult(screenshotResult);

        console.log(`✅ [Screenshot] Completed for tab ${activeTabId}`);

        return {
          success: true,
          message: 'Screenshot captured',
          data: compressedScreenshotResult,
          timestamp: Date.now(),
        };
      }

      case 'tab': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for tab command (strict mode)',
          );
        }
        const conversationId = command.conversation_id;
        console.log(`🔍 [Tab Command] conversation_id: "${conversationId}"`);

        switch (command.action) {
          case 'init':
            if (!command.url) {
              throw new Error('URL is required for init action');
            }
            const initResult = await tabManager.initializeSession(
              command.url,
              conversationId,
            );

            console.log(
              `🚀 [Tab Init] Session ${conversationId} initialized with tab ${initResult.tabId}`,
            );

            // Set the newly created tab as active
            tabManager.setCurrentActiveTabId(conversationId, initResult.tabId);

            // Capture screenshot after initialization
            const initPageState = await captureDefaultHighlightedPageState({
              tabId: initResult.tabId,
              conversationId,
              logLabel: 'Tab Init',
              primeWithRawScreenshot: true,
            });

            return {
              success: true,
              message: `Session ${conversationId} initialized with ${command.url}`,
              data: {
                tabId: initResult.tabId,
                groupId: initResult.groupId,
                url: initResult.url,
                conversationId: conversationId,
                isManaged: true,
                ...initPageState,
              },
              timestamp: Date.now(),
            };

          case 'open':
            if (!command.url) {
              throw new Error('URL is required for open action');
            }
            const openResult = await tabs.openTab(command.url, conversationId);

            // Set the newly opened tab as active if it has a tabId
            if (openResult.tabId) {
              tabManager.setCurrentActiveTabId(
                conversationId,
                openResult.tabId,
              );
            }

            // Capture screenshot after opening
            const openPageState = openResult.tabId
              ? await captureDefaultHighlightedPageState({
                  tabId: openResult.tabId,
                  conversationId,
                  logLabel: 'Tab Open',
                  primeWithRawScreenshot: true,
                })
              : {};

            return {
              success: true,
              message: openResult.message,
              data: {
                ...openResult,
                conversationId: conversationId,
                ...openPageState,
              },
              timestamp: Date.now(),
            };

          case 'close':
            if (!command.tab_id) {
              throw new Error('tab_id is required for close action');
            }
            const closeResult = await tabs.closeTab(command.tab_id);
            return {
              success: true,
              message: closeResult.message,
              data: {
                ...closeResult,
                conversationId: conversationId,
              },
              timestamp: Date.now(),
            };

          case 'switch':
            if (!command.tab_id) {
              throw new Error('tab_id is required for switch action');
            }
            const switchResult = await tabs.switchToTab(command.tab_id);
            await tabManager.ensureTabManaged(command.tab_id, conversationId);
            tabManager.updateTabActivity(command.tab_id, conversationId);

            // Set the switched-to tab as active
            tabManager.setCurrentActiveTabId(conversationId, command.tab_id);

            // Capture screenshot after switching
            const switchPageState = await captureDefaultHighlightedPageState({
              tabId: command.tab_id,
              conversationId,
              logLabel: 'Tab Switch',
              primeWithRawScreenshot: true,
            });

            return {
              success: true,
              message: switchResult.message,
              data: {
                ...switchResult,
                conversationId: conversationId,
                ...switchPageState,
              },
              timestamp: Date.now(),
            };

          case 'list':
            // ✅ STRICT MODE: conversation_id already checked above
            const listResult = await tabs.getAllTabs(true, conversationId);
            const conversationTabs = tabManager.getManagedTabs(conversationId);
            return {
              success: true,
              message: `Found ${listResult.count} tabs (${conversationTabs.length} in conversation ${conversationId})`,
              data: {
                ...listResult,
                conversationId: conversationId,
                conversationTabs: conversationTabs,
              },
              timestamp: Date.now(),
            };

          case 'refresh':
            if (!command.tab_id) {
              throw new Error('tab_id is required for refresh action');
            }
            await tabManager.ensureTabManaged(command.tab_id, conversationId);
            tabManager.updateTabActivity(command.tab_id, conversationId);
            const refreshResult = await tabs.refreshTab(command.tab_id);

            // Capture screenshot after refresh
            const refreshPageState = await captureDefaultHighlightedPageState({
              tabId: command.tab_id,
              conversationId,
              logLabel: 'Tab Refresh',
              primeWithRawScreenshot: true,
            });

            return {
              success: true,
              message: refreshResult.message,
              data: {
                ...refreshResult,
                conversationId: conversationId,
                ...refreshPageState,
              },
              timestamp: Date.now(),
            };
          case 'view': {
            // View action: Capture screenshot of current active tab
            const viewActiveTabId =
              tabManager.getCurrentActiveTabId(conversationId);
            if (!viewActiveTabId) {
              throw new Error(
                `No active tab found for conversation ${conversationId}. Use tab init first.`,
              );
            }

            await tabManager.ensureTabManaged(viewActiveTabId, conversationId);
            tabManager.updateTabActivity(viewActiveTabId, conversationId);

            console.log(
              `👁️ [Tab View] Capturing screenshot for tab ${viewActiveTabId}, conversation: ${conversationId}`,
            );

            const viewScreenshotResult = await captureScreenshot(
              viewActiveTabId,
              conversationId,
              true,
              90,
              false,
              350,
              TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
            );
            const compressedViewScreenshotResult =
              await compressScreenshotResult(viewScreenshotResult);

            return {
              success: true,
              message: `View captured for tab ${viewActiveTabId}`,
              data: {
                tabId: viewActiveTabId,
                conversationId: conversationId,
                screenshot: compressedViewScreenshotResult?.imageData,
                ...(compressedViewScreenshotResult?.dialog_auto_accepted
                  ? {
                      dialog_auto_accepted:
                        compressedViewScreenshotResult.dialog_auto_accepted,
                    }
                  : {}),
                ...(compressedViewScreenshotResult?.dialog_auto_accepted_list
                  ? {
                      dialog_auto_accepted_list:
                        compressedViewScreenshotResult.dialog_auto_accepted_list,
                    }
                  : {}),
              },
              timestamp: Date.now(),
            };
          }

          case 'back':
          case 'forward': {
            // Determine which tab to use: provided tab_id or current active tab
            let targetTabId: number;
            if (command.tab_id) {
              targetTabId = command.tab_id;
              console.log(
                `↩️ [Tab ${command.action}] Using provided tab_id ${targetTabId}`,
              );
            } else {
              const activeTabId =
                tabManager.getCurrentActiveTabId(conversationId);
              if (!activeTabId) {
                throw new Error(
                  `No active tab found for conversation ${conversationId}. Use tab init first or specify tab_id.`,
                );
              }
              targetTabId = activeTabId;
              console.log(
                `↩️ [Tab ${command.action}] Using current active tab ${targetTabId}`,
              );
            }

            await tabManager.ensureTabManaged(targetTabId, conversationId);
            tabManager.updateTabActivity(targetTabId, conversationId);

            console.log(
              `↩️ [Tab ${command.action}] Navigating ${command.action} in tab ${targetTabId}, conversation: ${conversationId}`,
            );

            // Execute back or forward navigation
            const navigationResult =
              command.action === 'back'
                ? await tabs.goBack(targetTabId)
                : await tabs.goForward(targetTabId);

            const navigationPageState =
              await captureDefaultHighlightedPageState({
                tabId: targetTabId,
                conversationId,
                logLabel:
                  command.action === 'back' ? 'Tab Back' : 'Tab Forward',
                primeWithRawScreenshot: true,
              });

            return {
              success: true,
              message: navigationResult.message,
              data: {
                ...navigationResult,
                tabId: targetTabId,
                conversationId: conversationId,
                ...navigationPageState,
              },
              timestamp: Date.now(),
            };
          }

          default:
            throw new Error(`Unknown tab action: ${(command as any).action}`);
        }
      }

      case 'cleanup_session': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for cleanup_session (strict mode)',
          );
        }
        const cleanupConversationId = command.conversation_id;
        console.log(
          `🧹 [Cleanup Session] Cleaning up session ${cleanupConversationId}`,
        );
        const managedTabs = tabManager.getManagedTabs(cleanupConversationId);

        for (const managedTab of managedTabs) {
          cleanupTabState(cleanupConversationId, managedTab.tabId);
        }

        // Clear any conversation-scoped cache entries that may remain after
        // tabs are closed or the session has already partially cleaned up.
        elementCache.invalidate(cleanupConversationId);
        clearHoverState(cleanupConversationId);

        // 清理 tab manager 会话
        await tabManager.cleanupSession(cleanupConversationId);

        // 清理 debugger 会话（detach 所有相关 tabs）
        await debuggerSessionManager.cleanupSession(cleanupConversationId);

        return {
          success: true,
          message: `Session ${cleanupConversationId} cleaned up successfully`,
          data: {
            conversationId: cleanupConversationId,
          },
          timestamp: Date.now(),
        };
      }

      case 'get_tabs': {
        // ✅ STRICT MODE: conversation_id is REQUIRED for managed_only=true
        const getTabsManagedOnly = command.managed_only !== false;

        if (getTabsManagedOnly) {
          if (!command.conversation_id) {
            throw new Error(
              'conversation_id is required for get_tabs with managed_only=true (strict mode)',
            );
          }
          const conversationTabs = tabManager.getManagedTabs(
            command.conversation_id,
          );

          // ✅ FIX: Query Chrome API to get active status for each tab
          const tabsWithActive = await Promise.all(
            conversationTabs.map(async (managedTab) => {
              try {
                const chromeTab = await chrome.tabs.get(managedTab.tabId);
                return {
                  ...managedTab,
                  active: chromeTab.active, // Add active status from Chrome API
                  index: chromeTab.index, // Also add index for consistency
                };
              } catch (error) {
                // Tab might have been closed, return with active=false
                console.warn(
                  `Tab ${managedTab.tabId} not found, marking as inactive`,
                );
                return {
                  ...managedTab,
                  active: false,
                  index: -1,
                };
              }
            }),
          );

          return {
            success: true,
            message: `Found ${tabsWithActive.length} managed tabs in conversation ${command.conversation_id}`,
            data: {
              tabs: tabsWithActive,
              count: tabsWithActive.length,
              conversationId: command.conversation_id,
              managed_only: true,
            },
            timestamp: Date.now(),
          };
        } else {
          // Get all tabs (no conversation filter)
          const allTabsResult = await tabs.getAllTabs(
            false,
            command.conversation_id,
          );
          return {
            success: true,
            message: `Found ${allTabsResult.count} tabs total`,
            data: {
              ...allTabsResult,
              managed_only: false,
            },
            timestamp: Date.now(),
          };
        }
      }

      case 'javascript_execute': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for javascript_execute command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;

        // Determine which tab to execute JavaScript in
        // Always use current active tab for the conversation (ignore tab_id if provided)
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init or specify tab_id.`,
          );
        }

        console.log(
          `📜 [JavaScript] Executing in active tab ${activeTabId}, conversation: ${conversationId} (ignoring provided tab_id: ${command.tab_id || 'none'})`,
        );

        // Ensure tab is managed by tab manager for this conversation
        await tabManager.ensureTabManaged(activeTabId, conversationId);
        tabManager.updateTabActivity(activeTabId, conversationId);

        const jsStartTime = Date.now();

        const jsResult = await javascript.executeJavaScript(
          activeTabId,
          conversationId,
          command.script,
          command.return_by_value !== false,
          command.await_promise === true,
          command.timeout || 30000,
        );

        const jsDuration = Date.now() - jsStartTime;
        console.log(`✅ [JavaScript] Execution completed in ${jsDuration}ms`);

        // Determine which tab to screenshot: latest new tab if created, otherwise original tab
        let screenshotTabId = activeTabId;
        if (jsResult.new_tabs_created && jsResult.new_tabs_created.length > 0) {
          const latestNewTab =
            jsResult.new_tabs_created[jsResult.new_tabs_created.length - 1];
          screenshotTabId = latestNewTab.tabId;
          console.log(
            `📸 [JavaScript] New tabs detected, screenshot will be on latest new tab ${screenshotTabId}`,
          );

          // Update active tab for the conversation to the new tab
          tabManager.setCurrentActiveTabId(conversationId, screenshotTabId);
        }

        const jsPageState = await captureDefaultHighlightedPageState({
          tabId: screenshotTabId,
          conversationId,
          logLabel: 'JavaScript',
        });

        return {
          success: true,
          message: 'JavaScript executed successfully',
          data: {
            ...jsResult,
            ...jsPageState,
          },
          timestamp: Date.now(),
          duration: jsDuration,
        };
      }

      case 'handle_dialog': {
        // ✅ STRICT MODE: conversation_id is REQUIRED
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for handle_dialog command (strict mode)',
          );
        }

        const conversationId = command.conversation_id;
        const action = command.action; // 'accept' or 'dismiss'

        console.log(
          `💬 [HandleDialog] Handling dialog for conversation ${conversationId}: action=${action}`,
        );

        // Get the active tab for this conversation
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init first.`,
          );
        }

        // Check if there's an active dialog
        if (!dialogManager.hasActiveDialog(activeTabId)) {
          return {
            success: false,
            error: 'No dialog is currently open. There is nothing to handle.',
            timestamp: Date.now(),
          };
        }

        const existingDialog = dialogManager.getActiveDialog(activeTabId)!;
        console.log(
          `💬 [HandleDialog] Found dialog: type=${existingDialog.dialogType}, message="${existingDialog.message}"`,
        );

        try {
          // Handle the dialog (may cascade to another dialog)
          const handleResult = await dialogManager.handleDialog(
            activeTabId,
            action,
            command.prompt_text,
          );

          console.log(
            `✅ [HandleDialog] Dialog handled: status=${handleResult.status}`,
          );

          // If a new dialog cascaded, return info about it
          if (
            handleResult.status === 'dialog_cascaded' &&
            handleResult.newDialog
          ) {
            console.log(
              `💬 [HandleDialog] Cascading dialog detected: type=${handleResult.newDialog.type}`,
            );

            // Auto-accept if it's an alert (no decision needed)
            if (!handleResult.newDialog.needsDecision) {
              console.log(`💬 [HandleDialog] Auto-accepting cascading alert`);
              await dialogManager.autoAcceptDialog(activeTabId);

              const dialogPageState = await captureDefaultHighlightedPageState({
                tabId: activeTabId,
                conversationId,
                logLabel: 'HandleDialog',
              });

              return {
                success: true,
                message: `Dialog handled (${action}), cascading alert auto-accepted: "${handleResult.newDialog.message}"`,
                data: {
                  previousDialog: handleResult.previousDialog,
                  cascadingDialog: {
                    type: handleResult.newDialog.type,
                    message: handleResult.newDialog.message,
                    autoAccepted: true,
                  },
                  ...dialogPageState,
                },
                timestamp: Date.now(),
              };
            }

            // Return info about the cascading dialog (needs decision)
            return {
              success: true,
              message: `Dialog handled (${action}), but a new ${handleResult.newDialog.type} dialog opened: "${handleResult.newDialog.message}". Use handle_dialog again to respond.`,
              dialog_opened: true,
              dialog: {
                type: handleResult.newDialog.type,
                message: handleResult.newDialog.message,
                url: handleResult.newDialog.url,
                needsDecision: handleResult.newDialog.needsDecision,
              },
              data: {
                previousDialog: handleResult.previousDialog,
                cascadingDialog: handleResult.newDialog,
              },
              timestamp: Date.now(),
            };
          }

          const dialogPageState = await captureDefaultHighlightedPageState({
            tabId: activeTabId,
            conversationId,
            logLabel: 'HandleDialog',
          });

          console.log(
            `✅ [HandleDialog] Dialog handling complete, screenshot captured`,
          );

          return {
            success: true,
            message: `Dialog handled successfully: ${handleResult.previousDialog.type} ${action}ed`,
            data: {
              handledDialog: handleResult.previousDialog,
              ...dialogPageState,
            },
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error(`❌ [HandleDialog] Failed to handle dialog:`, error);
          if (error instanceof DialogBlockedError) {
            const response: any = {
              success: false,
              error: error.message,
              dialog_opened: true,
              dialog: {
                type: error.dialogType as DialogType,
                message: error.dialogMessage,
                needsDecision: error.needsDecision,
              },
              timestamp: Date.now(),
            };

            // Include auto-accepted dialogs if any
            if (
              error.autoAcceptedDialogs &&
              error.autoAcceptedDialogs.length > 0
            ) {
              response.auto_accepted_dialogs = error.autoAcceptedDialogs.map(
                (dialog) => ({
                  type: dialog.dialogType,
                  message: dialog.message,
                  url: dialog.url,
                  timestamp: dialog.timestamp,
                }),
              );
            }

            return response;
          }
          return {
            success: false,
            error: `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now(),
          };
        }
      }

      case 'highlight_elements': {
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for highlight_elements command',
          );
        }
        const conversationId = command.conversation_id;
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(`No active tab for conversation ${conversationId}`);
        }

        const keywords = command.keywords;
        const elementType = command.element_type || 'any';
        const page = command.page || 1;
        try {
          const highlightedPage = await captureHighlightedPageState({
            tabId: activeTabId,
            conversationId,
            elementType,
            page,
            keywords,
            logLabel: 'HighlightElements',
          });

          return {
            success: true,
            data: highlightedPage,
            timestamp: Date.now(),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          };
        }
      }

      case 'click_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const clickTabId = command.tab_id;
        if (clickTabId === undefined || clickTabId === null)
          throw new Error('tab_id is required');

        const clickResult = await performElementClick(
          command.conversation_id,
          command.element_id,
          clickTabId,
        );

        // Determine which tab to screenshot: latest new tab if created, otherwise original tab
        let screenshotTabId = clickTabId;
        if (
          clickResult.new_tabs_created &&
          clickResult.new_tabs_created.length > 0
        ) {
          const latestNewTab =
            clickResult.new_tabs_created[
              clickResult.new_tabs_created.length - 1
            ];
          screenshotTabId = latestNewTab.tabId;
          console.log(
            `📸 [ClickElement] New tabs detected, screenshot will be on latest new tab ${screenshotTabId}`,
          );

          // Update active tab for the conversation to the new tab
          tabManager.setCurrentActiveTabId(
            command.conversation_id,
            screenshotTabId,
          );
        }

        const clickPageState = await captureDefaultHighlightedPageState({
          tabId: screenshotTabId,
          conversationId: command.conversation_id,
          logLabel: 'ClickElement',
        });

        return {
          success: clickResult.success,
          data: {
            ...clickResult,
            ...clickPageState,
          },
          error: clickResult.error,
          timestamp: Date.now(),
        };
      }

      case 'hover_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const hoverTabId = command.tab_id;
        if (hoverTabId === undefined || hoverTabId === null)
          throw new Error('tab_id is required');

        const hoverResult = await performElementHover(
          command.conversation_id,
          command.element_id,
          hoverTabId,
        );
        const hoverPageState = await captureDefaultHighlightedPageState({
          tabId: hoverTabId,
          conversationId: command.conversation_id,
          logLabel: 'HoverElement',
        });

        return {
          success: hoverResult.success,
          data: {
            ...hoverResult,
            ...hoverPageState,
          },
          error: hoverResult.error,
          timestamp: Date.now(),
        };
      }

      case 'scroll_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const scrollTabId = command.tab_id;
        if (scrollTabId === undefined || scrollTabId === null)
          throw new Error('tab_id is required');

        // element_id is optional - if not provided, scrolls the entire page
        const scrollResult = await performElementScroll(
          command.conversation_id,
          command.element_id,
          command.direction || 'down',
          scrollTabId,
          command.scroll_amount || 0.5,
        );
        const scrollPageState = await captureDefaultHighlightedPageState({
          tabId: scrollTabId,
          conversationId: command.conversation_id,
          logLabel: 'ScrollElement',
        });

        return {
          success: scrollResult.success,
          data: {
            ...scrollResult,
            ...scrollPageState,
          },
          error: scrollResult.error,
          timestamp: Date.now(),
        };
      }

      case 'swipe_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const swipeTabId = command.tab_id;
        if (swipeTabId === undefined || swipeTabId === null)
          throw new Error('tab_id is required');

        const swipeResult = await performElementSwipe(
          command.conversation_id,
          command.element_id,
          command.direction || 'next',
          swipeTabId,
          command.swipe_count || 1,
        );
        const swipePageState = await captureDefaultHighlightedPageState({
          tabId: swipeTabId,
          conversationId: command.conversation_id,
          logLabel: 'SwipeElement',
          preconditionWaitForRender: 900,
          preconditionCaptureOptions: TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
        });

        return {
          success: swipeResult.success,
          data: {
            ...swipeResult,
            ...swipePageState,
          },
          error: swipeResult.error,
          timestamp: Date.now(),
        };
      }

      case 'drag_and_drop_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const dragTabId = command.tab_id;
        if (dragTabId === undefined || dragTabId === null)
          throw new Error('tab_id is required');

        const dragResult = await performElementDragAndDrop(
          command.conversation_id,
          command.element_id,
          dragTabId,
          {
            targetElementId: command.target_element_id,
            position: command.position,
            offsetX: command.offset_x,
            offsetY: command.offset_y,
            steps: command.steps || 10,
          },
        );
        const dragPageState = await captureDefaultHighlightedPageState({
          tabId: dragTabId,
          conversationId: command.conversation_id,
          logLabel: 'DragAndDropElement',
          preconditionWaitForRender: 600,
        });

        return {
          success: dragResult.success,
          data: {
            ...dragResult,
            ...dragPageState,
          },
          error: dragResult.error,
          timestamp: Date.now(),
        };
      }

      case 'set_slider_value': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const sliderTabId = command.tab_id;
        if (sliderTabId === undefined || sliderTabId === null)
          throw new Error('tab_id is required');

        const sliderResult = await performElementSetSlider(
          command.conversation_id,
          command.element_id,
          command.value,
          sliderTabId,
        );
        const sliderPageState = await captureDefaultHighlightedPageState({
          tabId: sliderTabId,
          conversationId: command.conversation_id,
          logLabel: 'SetSliderValue',
        });

        return {
          success: sliderResult.success,
          data: {
            ...sliderResult,
            ...sliderPageState,
          },
          error: sliderResult.error,
          timestamp: Date.now(),
        };
      }

      case 'upload_file': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const uploadTabId = command.tab_id;
        if (uploadTabId === undefined || uploadTabId === null)
          throw new Error('tab_id is required');
        if (!command.file_path || typeof command.file_path !== 'string')
          throw new Error('file_path is required for upload_file');

        const uploadResult = await performElementUpload(
          command.conversation_id,
          command.element_id,
          uploadTabId,
          command.file_path,
        );
        const uploadPageState = await captureDefaultHighlightedPageState({
          tabId: uploadTabId,
          conversationId: command.conversation_id,
          logLabel: 'UploadFile',
        });

        return {
          success: uploadResult.success,
          data: {
            ...uploadResult,
            ...uploadPageState,
          },
          error: uploadResult.error,
          timestamp: Date.now(),
        };
      }

      case 'keyboard_input': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const inputTabId = command.tab_id;
        if (inputTabId === undefined || inputTabId === null)
          throw new Error('tab_id is required');

        const inputResult = await performKeyboardInput(
          command.conversation_id,
          command.element_id,
          command.text,
          inputTabId,
        );
        const inputPageState = await captureDefaultHighlightedPageState({
          tabId: inputTabId,
          conversationId: command.conversation_id,
          logLabel: 'KeyboardInput',
        });

        return {
          success: inputResult.success,
          data: {
            ...inputResult,
            ...inputPageState,
          },
          error: inputResult.error,
          timestamp: Date.now(),
        };
      }

      case 'select_element': {
        if (!command.conversation_id)
          throw new Error('conversation_id required');
        const selectTabId = command.tab_id;
        if (selectTabId === undefined || selectTabId === null)
          throw new Error('tab_id is required');

        const selectResult = await performElementSelect(
          command.conversation_id,
          command.element_id,
          selectTabId,
          command.value,
        );
        const selectPageState = await captureDefaultHighlightedPageState({
          tabId: selectTabId,
          conversationId: command.conversation_id,
          logLabel: 'SelectElement',
        });

        return {
          success: selectResult.success,
          data: {
            ...selectResult,
            ...selectPageState,
          },
          error: selectResult.error,
          timestamp: Date.now(),
        };
      }

      case 'get_element_html': {
        if (!command.conversation_id)
          throw new Error('conversation_id required for get_element_html');
        const conversationId = command.conversation_id;
        const elementId = command.element_id;

        if (!elementId) {
          throw new Error('element_id is required for get_element_html');
        }

        // Get current active tab for this conversation
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(
            `No active tab found for conversation ${conversationId}. Use tab init first.`,
          );
        }

        // Look up the element in the cache
        const element = elementCache.getElementById(
          conversationId,
          activeTabId,
          elementId,
        );

        if (!element) {
          console.warn(
            `⚠️ [GetElementHtml] Element ${elementId} not found in cache for conversation ${conversationId}, tab ${activeTabId}`,
          );
          return {
            success: false,
            error: buildElementCacheMissMessage({
              conversationId,
              tabId: activeTabId,
              elementId,
              refreshHint:
                'The highlight cache may have expired or the page may have changed. Try highlight_elements again.',
            }),
            data: {
              element_id: elementId,
              html: null,
            },
            timestamp: Date.now(),
          };
        }

        // Return the cached HTML
        const html = element.element.html || '<not available>';
        console.log(
          `✅ [GetElementHtml] Retrieved HTML for element ${elementId} from cache (${html.length} chars)`,
        );

        return {
          success: true,
          message:
            element.elementIdCorrected &&
            element.resolvedElementId !== elementId
              ? `Retrieved HTML for element ${element.resolvedElementId} (matched from requested ${elementId})`
              : `Retrieved HTML for element ${element.resolvedElementId}`,
          data: {
            element_id: element.resolvedElementId,
            requested_element_id: elementId,
            resolved_element_id: element.resolvedElementId,
            element_id_corrected: element.elementIdCorrected,
            html: html,
            tagName: element.element.tagName,
            type: element.element.type,
          },
          timestamp: Date.now(),
        };
      }

      case 'highlight_single_element': {
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for highlight_single_element command',
          );
        }
        const conversationId = command.conversation_id;
        const activeTabId = tabManager.getCurrentActiveTabId(conversationId);
        if (!activeTabId) {
          throw new Error(`No active tab for conversation ${conversationId}`);
        }

        // Get element from cache
        const element = elementCache.getElementById(
          conversationId,
          activeTabId,
          command.element_id,
        );
        if (!element) {
          return {
            success: false,
            error: buildElementCacheMissMessage({
              conversationId,
              tabId: activeTabId,
              elementId: command.element_id,
            }),
            timestamp: Date.now(),
          };
        }

        // ============================================================
        // Re-fetch current bbox using cached selector (bbox may be stale if page scrolled)
        // ============================================================
        const escapedSelector = element.element.selector
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const escapedDocumentId = element.documentId
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const escapedFingerprint = (element.element.fingerprint || '')
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const bboxScript = `
          (function() {
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

            const el = document.querySelector("${escapedSelector}");
            const expectedDocumentId = "${escapedDocumentId}";
            const expectedFingerprint = "${escapedFingerprint}";
            const currentDocumentId = \`\${Math.trunc(performance.timeOrigin)}|\${location.href}\`;
            if (expectedDocumentId && currentDocumentId !== expectedDocumentId) {
              return {
                ok: false,
                stale: true,
                error:
                  "The highlighted element is stale because the document changed. Call highlight_elements() again."
              };
            }
            if (!el) {
              return {
                ok: false,
                stale: true,
                error:
                  "Element not found in DOM for the cached highlight result. Call highlight_elements() again."
              };
            }
            const currentFingerprint = getElementFingerprint(el);
            if (!fingerprintsLookCompatible(expectedFingerprint, currentFingerprint)) {
              return {
                ok: false,
                stale: true,
                error:
                  "The cached highlight result is stale because the target element identity changed. Call highlight_elements() again."
              };
            }
            const rect = el.getBoundingClientRect();
            return {
              ok: true,
              bbox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            };
          })();
        `;

        let freshBbox = element.element.bbox; // Default to cached bbox
        try {
          const bboxResult = await javascript.executeJavaScript(
            activeTabId,
            conversationId,
            bboxScript,
            true,
            false,
            5000,
          );
          if (bboxResult.success && bboxResult.result?.value?.ok) {
            const fetchedBbox = bboxResult.result.value.bbox as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            freshBbox = fetchedBbox;
            console.log(
              `📐 [SingleHighlight] Fresh bbox for ${element.element.id}:`,
              JSON.stringify(freshBbox),
            );
          } else if (
            bboxResult.success &&
            bboxResult.result?.value &&
            bboxResult.result.value.ok === false
          ) {
            return {
              success: false,
              error:
                bboxResult.result.value.error ||
                `Element ${command.element_id} is stale. Call highlight_elements() again.`,
              timestamp: Date.now(),
            };
          } else {
            console.warn(
              `⚠️ [SingleHighlight] Failed to fetch fresh bbox for ${element.element.id}:`,
              {
                error: bboxResult.error,
                selector: element.element.selector,
                cachedBbox: element.element.bbox,
                resultValue: bboxResult.result?.value,
                rawResult: bboxResult.result,
              },
            );
          }
        } catch (bboxError) {
          console.warn(
            `⚠️ [SingleHighlight] Error fetching bbox, using cached:`,
            bboxError,
          );
        }

        // Re-fire hover events so hover-dependent UI stays visible for
        // the confirmation screenshot (e.g. video player controls).
        await replayHoverState(conversationId, activeTabId);
        // Brief pause for CSS transitions triggered by hover event handlers
        await new Promise((r) => setTimeout(r, 150));

        // Capture screenshot
        const screenshotResult = await captureScreenshot(
          activeTabId,
          conversationId,
          true,
          90,
        );

        // ============================================================
        // Check if element is visible in viewport
        // ============================================================
        const viewportWidth = screenshotResult.metadata?.viewportWidth || 1280;
        const viewportHeight = screenshotResult.metadata?.viewportHeight || 720;

        // Element is considered visible if at least part of it is in the viewport
        const isVisibleInViewport =
          freshBbox.x < viewportWidth && // Left edge is left of right boundary
          freshBbox.x + freshBbox.width > 0 && // Right edge is right of left boundary
          freshBbox.y < viewportHeight && // Top edge is above bottom boundary
          freshBbox.y + freshBbox.height > 0; // Bottom edge is below top boundary

        if (!isVisibleInViewport) {
          // Determine scroll direction hint
          let scrollHint = '';
          if (freshBbox.y >= viewportHeight) {
            scrollHint =
              'The element is below the viewport. Try scrolling down or using scroll_element to bring it into view.';
          } else if (freshBbox.y + freshBbox.height <= 0) {
            scrollHint =
              'The element is above the viewport. Try scrolling up or using scroll_element to bring it into view.';
          } else if (freshBbox.x >= viewportWidth) {
            scrollHint =
              'The element is to the right of the viewport. Try scrolling right or using scroll_element to bring it into view.';
          } else if (freshBbox.x + freshBbox.width <= 0) {
            scrollHint =
              'The element is to the left of the viewport. Try scrolling left or using scroll_element to bring it into view.';
          }

          return {
            success: false,
            error:
              `Element ${element.element.id} is not visible in the current viewport. ${scrollHint}`.trim(),
            data: {
              elementId: element.element.id,
              bbox: freshBbox,
              viewportWidth,
              viewportHeight,
            },
            timestamp: Date.now(),
          };
        }

        // Create element with fresh bbox for drawing
        const elementWithFreshBbox = {
          ...element.element,
          bbox: freshBbox,
        };

        // Draw single element highlight
        const highlightedScreenshot = await highlightSingleElement(
          screenshotResult.imageData,
          elementWithFreshBbox,
          {
            intendedAction: command.intended_action,
            scale:
              screenshotResult.metadata?.imageScale ||
              screenshotResult.metadata?.devicePixelRatio ||
              1,
            viewportWidth: screenshotResult.metadata?.viewportWidth || 0,
            viewportHeight: screenshotResult.metadata?.viewportHeight || 0,
          },
        );

        return {
          success: true,
          data: {
            html: element.element.html || '',
            screenshot: await compressIfNeeded(
              highlightedScreenshot,
              getCompressionThreshold(),
            ),
            elementId: element.resolvedElementId,
            requestedElementId: command.element_id,
            resolvedElementId: element.resolvedElementId,
            elementIdCorrected: element.elementIdCorrected,
            ...(screenshotResult?.dialog_auto_accepted
              ? { dialog_auto_accepted: screenshotResult.dialog_auto_accepted }
              : {}),
            ...(screenshotResult?.dialog_auto_accepted_list
              ? {
                  dialog_auto_accepted_list:
                    screenshotResult.dialog_auto_accepted_list,
                }
              : {}),
          },
          timestamp: Date.now(),
        };
      }

      case 'highlight_drop_preview': {
        if (!command.conversation_id) {
          throw new Error(
            'conversation_id is required for highlight_drop_preview command',
          );
        }
        const dropConvId = command.conversation_id;
        const dropActiveTabId =
          (command as any).tab_id ??
          tabManager.getCurrentActiveTabId(dropConvId);
        if (!dropActiveTabId) {
          throw new Error(`No active tab for conversation ${dropConvId}`);
        }

        // Look up source and target elements from cache
        const sourceEl = elementCache.getElementById(
          dropConvId,
          dropActiveTabId,
          (command as any).source_element_id,
        );
        if (!sourceEl) {
          return {
            success: false,
            error: buildElementCacheMissMessage({
              conversationId: dropConvId,
              tabId: dropActiveTabId,
              elementId: (command as any).source_element_id,
            }),
            timestamp: Date.now(),
          };
        }
        const targetEl = elementCache.getElementById(
          dropConvId,
          dropActiveTabId,
          (command as any).target_element_id,
        );
        if (!targetEl) {
          return {
            success: false,
            error: buildElementCacheMissMessage({
              conversationId: dropConvId,
              tabId: dropActiveTabId,
              elementId: (command as any).target_element_id,
            }),
            timestamp: Date.now(),
          };
        }

        // Fetch fresh bbox for target container + discover inner draggable children
        const targetSelector = targetEl.element.selector
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        const dropDetectionScript = `
          (function() {
            const container = document.querySelector("${targetSelector}");
            if (!container) {
              return { ok: false, error: "Drop target container not found in DOM" };
            }
            const containerRect = container.getBoundingClientRect();

            // Helper: check if an element is visible
            function isVisible(el) {
              if (!(el instanceof HTMLElement)) return false;
              if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') return false;
              const r = el.getBoundingClientRect();
              return r.width >= 5 && r.height >= 5;
            }

            // Helper: find homogeneous children in a parent
            function findHomogeneousChildren(parent) {
              const tagCounts = {};
              for (const child of parent.children) {
                if (!isVisible(child)) continue;
                tagCounts[child.tagName] = (tagCounts[child.tagName] || 0) + 1;
              }
              const itemTags = new Set(Object.keys(tagCounts).filter(t => tagCounts[t] >= 2));
              if (itemTags.size === 0) return null;
              const items = [];
              for (const child of parent.children) {
                if (!isVisible(child)) continue;
                if (!itemTags.has(child.tagName)) continue;
                items.push(child);
              }
              return items.length >= 2 ? { parent: parent, items: items } : null;
            }

            // Try direct children first, then recurse one level into each child
            let result = findHomogeneousChildren(container);
            let itemsParent = container;
            if (!result) {
              for (const child of container.children) {
                if (!isVisible(child)) continue;
                result = findHomogeneousChildren(child);
                if (result) {
                  itemsParent = result.parent;
                  break;
                }
              }
            }

            const innerElements = [];
            if (result) {
              // Build a selector prefix for the items parent
              let parentPrefix = "${targetSelector}";
              if (itemsParent !== container) {
                let pSel = itemsParent.tagName.toLowerCase();
                if (itemsParent.id) {
                  pSel += '#' + CSS.escape(itemsParent.id);
                } else if (itemsParent.className && typeof itemsParent.className === 'string') {
                  const cls = itemsParent.className.trim().split(/\\s+/).slice(0, 3);
                  pSel += cls.map(c => '.' + CSS.escape(c)).join('');
                }
                parentPrefix = "${targetSelector}" + ' > ' + pSel;
              }

              for (const child of result.items) {
                let selector = child.tagName.toLowerCase();
                if (child.id) {
                  selector += '#' + CSS.escape(child.id);
                } else if (child.className && typeof child.className === 'string') {
                  const classes = child.className.trim().split(/\\s+/).slice(0, 3);
                  selector += classes.map(c => '.' + CSS.escape(c)).join('');
                }
                selector = parentPrefix + ' > ' + selector;
                const matchCount = itemsParent.querySelectorAll(':scope > ' + child.tagName.toLowerCase()).length;
                if (matchCount > 1) {
                  const idx = Array.from(itemsParent.children).indexOf(child) + 1;
                  selector += ':nth-child(' + idx + ')';
                }
                const rect = child.getBoundingClientRect();
                innerElements.push({
                  tagName: child.tagName,
                  text: (child.textContent || '').trim().slice(0, 200),
                  html: child.outerHTML.slice(0, 2000),
                  selector: selector,
                  bbox: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                });
              }
            }

            return {
              ok: true,
              containerBbox: {
                x: containerRect.x,
                y: containerRect.y,
                width: containerRect.width,
                height: containerRect.height,
              },
              innerElements: innerElements,
            };
          })();
        `;

        const dropDetResult = await javascript.executeJavaScript(
          dropActiveTabId,
          dropConvId,
          dropDetectionScript,
          true,
          false,
          5000,
        );

        if (!dropDetResult.success || !dropDetResult.result?.value?.ok) {
          const dropErr =
            dropDetResult.result?.value?.error ||
            dropDetResult.error ||
            'Failed to detect inner elements';
          return {
            success: false,
            error: dropErr,
            timestamp: Date.now(),
          };
        }

        const containerBbox = dropDetResult.result.value.containerBbox;
        const rawInnerElements = dropDetResult.result.value.innerElements || [];

        // Build InteractiveElement objects for inner elements
        const innerInteractiveElements: InteractiveElement[] =
          rawInnerElements.map((raw: any, _idx: number) => ({
            id: '', // Will be assigned by assignHashedElementIds
            type: 'draggable' as const,
            tagName: raw.tagName,
            selector: raw.selector,
            html: raw.html,
            text: raw.text,
            bbox: raw.bbox,
            isVisible: true,
            isInViewport: true,
          }));

        // Assign stable IDs
        const idAssignedInnerElements = assignHashedElementIds(
          innerInteractiveElements,
        );

        // Take a screenshot
        const dropScreenshot = await captureScreenshot(
          dropActiveTabId,
          dropConvId,
          true,
          90,
        );
        if (!dropScreenshot?.success || !dropScreenshot?.imageData) {
          throw new Error('Failed to capture screenshot for drop preview');
        }

        const dropScale =
          dropScreenshot.metadata?.imageScale ||
          dropScreenshot.metadata?.devicePixelRatio ||
          1;
        const dropVpWidth = dropScreenshot.metadata?.viewportWidth || 0;
        const dropVpHeight = dropScreenshot.metadata?.viewportHeight || 0;

        // Build a container element with fresh bbox for the crop calculation
        const containerForCrop: InteractiveElement = {
          ...targetEl.element,
          bbox: containerBbox,
        };

        // Draw the drop preview
        const dropPreviewImage = await highlightDropPreview(
          dropScreenshot.imageData,
          containerForCrop,
          idAssignedInnerElements,
          {
            scale: dropScale,
            viewportWidth: dropVpWidth,
            viewportHeight: dropVpHeight,
          },
        );

        // Store inner elements in cache so confirm_drag_and_drop can reference them
        // Use the stored result's elements (IDs may be adjusted on collision)
        const storedDropPage = elementCache.storeHighlightResult({
          conversationId: dropConvId,
          tabId: dropActiveTabId,
          documentId: targetEl.documentId,
          elementType: 'draggable',
          keywords: [],
          totalElements: idAssignedInnerElements.length,
          totalPages: 1,
          pages: [idAssignedInnerElements],
          page: 1,
        });
        const storedInnerElements = storedDropPage.elements;

        const compressedDropPreview = await compressIfNeeded(
          dropPreviewImage,
          getCompressionThreshold(),
        );

        return {
          success: true,
          data: {
            screenshot: compressedDropPreview,
            elements: storedInnerElements,
            containerElementId: targetEl.resolvedElementId,
            sourceElementId: sourceEl.resolvedElementId,
            totalElements: storedInnerElements.length,
          },
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(`Unknown command type: ${(command as any).type}`);
    }
  } catch (error) {
    console.error(`Command ${(command as any).type} failed:`, error);
    if (error instanceof DialogBlockedError) {
      const response: any = {
        success: false,
        command_id: command.command_id,
        error: error.message,
        dialog_opened: true,
        dialog: {
          type: error.dialogType as DialogType,
          message: error.dialogMessage,
          needsDecision: error.needsDecision,
        },
        timestamp: Date.now(),
      };

      // Include auto-accepted dialogs if any
      if (error.autoAcceptedDialogs && error.autoAcceptedDialogs.length > 0) {
        response.auto_accepted_dialogs = error.autoAcceptedDialogs.map(
          (dialog) => ({
            type: dialog.dialogType,
            message: dialog.message,
            url: dialog.url,
            timestamp: dialog.timestamp,
          }),
        );
      }

      return response;
    }
    return {
      success: false,
      command_id: command.command_id,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    };
  }
}

/**
 * Send tab switched event to server
 */
async function sendTabSwitchedEvent(
  conversationId: string,
  tabId: number,
): Promise<void> {
  try {
    if (!wsClient.isConnected()) {
      console.warn(
        `⚠️ Cannot send tab_switched event: WebSocket not connected`,
      );
      return;
    }

    const event = {
      type: 'event',
      event_type: 'tab_switched',
      conversation_id: conversationId,
      tab_id: tabId,
      timestamp: Date.now(),
    };

    console.log(
      `🔄 [TabEvent] Sending tab_switched event: ${conversationId} -> ${tabId}`,
    );
    await wsClient.sendMessage(event);
    console.log(`✅ [TabEvent] Tab switched event sent successfully`);
  } catch (error) {
    console.error('❌ [TabEvent] Failed to send tab switched event:', error);
  }
}

// Register tab switched listener with tab manager
tabManager.addTabSwitchedListener((conversationId: string, tabId: number) => {
  console.log(
    `🔄 [Background] Tab switched listener called: ${conversationId} -> ${tabId}`,
  );
  // Send event to server asynchronously (don't await)
  sendTabSwitchedEvent(conversationId, tabId).catch(console.error);
});

tabManager.addTabClosedListener((conversationId: string, tabId: number) => {
  cleanupTabState(conversationId, tabId);
});

// In dev builds, connect to Vite reload server for automatic extension reloading.
// Static import avoids Vite's __vitePreload polyfill (which references `document`
// and breaks in MV3 service workers). The function is only called when __DEV__.
import { initDevReload } from './dev-reload';
if (__DEV__) {
  initDevReload();
}

console.log('✅ OpenBrowser extension loaded (Strict Mode)');

// Export constants and functions for testing
export { LABEL_FONT_SIZE, LABEL_PADDING, LABEL_HEIGHT, MAX_LABEL_WIDTH };
export {
  expandBBoxWithLabel,
  elementsCollide,
  selectCollisionFreePage,
  getLabelBBox,
  bboxesIntersect,
  isLabelWithinViewport,
  calculateTotalPages,
  type LabelPosition,
} from '../utils/collision-detection';
export type { BBox } from '../utils/collision-detection';
