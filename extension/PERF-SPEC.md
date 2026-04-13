# OpenBrowser Extension Performance Optimization Spec

## Problem Statement

The highlight pipeline is the critical path for every OpenBrowser interaction. It runs
on every `highlight_elements` call **and** after every action (click, scroll, hover,
input, select, drag, swipe, slider). On heavy-DOM pages (5K-10K+ elements) it takes
3-15 seconds, creating an unacceptable bottleneck.

### Design Principle

We can tolerate a half-loading page being seen by OpenBrowser, as long as drawn bboxes
match correct visible elements. An element that is highlighted must be actually
interactable; if loading is in progress, it should not be highlighted, and OpenBrowser
knows to wait.

---

## Current Pipeline (before optimization)

```
captureHighlightedPageState (background/index.ts:297)
  |
  +-- runHighlightPreconditionWarmup (line 107)
  |     captureScreenshot(waitForRender=350)
  |       warmUpPageBeforeCapture -> querySelectorAll('*') up to 1200 elems
  |       getPageMetrics()
  |       CDP Page.captureScreenshot -> RESULT DISCARDED
  |
  +-- [loop up to 3 attempts]
  |   +-- executeJavaScript(detectionScript)  (line 335)
  |   |     Runtime.evaluate -> runOpenBrowserHighlightDetection
  |   |       evaluateReadinessSnapshot -> getPageMetrics()
  |   |       collectHighlightCandidates
  |   |         document.querySelectorAll('*')        <-- FULL DOM SCAN
  |   |         per element: visibility + viewport + scroll-parent + hit-test + resolve
  |   |     500ms unconditional sleep (javascript.ts:410)   <-- PURE WASTE
  |   |
  |   +-- filterByKeywords + assignIds + paginateAllPages (background)
  |   |
  |   +-- captureScreenshot(waitForRender=0)  (line 434)
  |   |     warmUpPageBeforeCapture -> querySelectorAll('*') AGAIN
  |   |     CDP Page.captureScreenshot
  |   |
  |   +-- executeJavaScript(consistencyScript)  (line 473)
  |   |     500ms unconditional sleep AGAIN              <-- PURE WASTE
  |   |     evaluate consistency -> if drift, retry loop
  |   |
  |   +-- drawHighlights (OffscreenCanvas)
  |   +-- compressScreenshotResult                       <-- DOUBLE COMPRESS
```

### Cost Breakdown (estimated, 5K DOM page)

| Phase | Time | Waste |
|-------|------|-------|
| Precondition warmup (screenshot thrown away) | 500-2500ms | 100% waste |
| Detection script | 500-5000ms | variable |
| Post-evaluate sleep #1 (javascript.ts:410) | 500ms | 100% waste |
| Screenshot warmup (redundant DOM scan) | 200-1000ms | 100% waste |
| Consistency check | 50-200ms | necessary |
| Post-evaluate sleep #2 | 500ms | 100% waste |
| Draw + double compress | 100-500ms | ~50% waste |
| **Total** | **3000-10000ms+** | **~1500-4000ms pure waste** |

---

## Tier 0: Pure-Sleep and Waste Elimination

**Goal:** Remove code that sleeps or does work whose result is immediately discarded.
These changes do not alter any detection logic or filter ordering.

### T0-A: Bypass 500ms post-evaluate sleep for highlight calls

**File:** `src/commands/javascript.ts`
**Line:** 410
**Current:** `executeJavaScript` unconditionally sleeps 500ms after `Runtime.evaluate`
to detect new tabs created by user-authored JS. Highlight detection and consistency
scripts never create tabs.

**Change:** Add an optional `skipNewTabDetection` parameter (default `false`). When
`true`, skip the 500ms sleep and tab diff logic. Callers in
`background/index.ts` (detection at line 335, consistency at line 473) pass `true`.

**Tests:**
- Existing `javascript.ts` behavior is unchanged when `skipNewTabDetection` is `false`
  (default).
- When `skipNewTabDetection` is `true`, the new-tab diff and 500ms sleep are skipped;
  `new_tabs_created` is never populated.
- The function still races against dialog events and timeout.

**Saved:** ~1000ms per highlight attempt (500ms x 2 calls).

### T0-B: Remove throwaway precondition warmup screenshot

**File:** `src/background/index.ts`
**Lines:** 107-143 (definition), 314-322 (call site)
**Current:** `runHighlightPreconditionWarmup` calls `captureScreenshot(waitForRender=350)`
which captures a full screenshot (including DOM warmup) and discards the result. Purpose
was to "wake up the renderer" but the detection script already evaluates readiness.

**Change:** Remove the `runHighlightPreconditionWarmup` function and the call at line 314.

**Tests:**
- `captureHighlightedPageState` no longer calls any warmup before detection.
- Existing highlight-integration tests still pass.

**Saved:** ~500-2500ms per highlight call.

### T0-C: Skip warmup in post-detection screenshot

**File:** `src/background/index.ts`
**Line:** 434 (screenshot capture call after detection)
**Current:** `captureScreenshot(tabId, conversationId, true, 90, false, 0, TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS)`
where `TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS` has `warmupBeforeCapture: true` and
`warmupMaxAttempts: 3`, triggering another full DOM scan.

**Change:** Create `HIGHLIGHT_POST_DETECTION_CAPTURE_OPTIONS` with
`warmupBeforeCapture: false`, and pass it instead of `TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS`
for the post-detection screenshot at line 434.

**Tests:**
- New capture options exist and have `warmupBeforeCapture: false`.
- Existing screenshot tests still pass.

**Saved:** ~200-1000ms + one full DOM scan.

### T0-D: Remove double compression

**File:** `src/background/index.ts`
**Lines:** 563-570 (`compressScreenshotResult` call)
**Current:** `drawHighlights` already encodes with compression (`encodeCanvasWithCompression`),
then `compressScreenshotResult` compresses again.

**Change:** Skip `compressScreenshotResult` when the input already came from `drawHighlights`.
Simplest approach: replace the `compressScreenshotResult` call with a direct passthrough
of `highlightedScreenshot`.

**Tests:**
- The output from `drawHighlights` is used directly without double compression.
- Existing visual-highlight tests still pass.
- Image output size stays reasonable (verified by existing compression in drawHighlights).

**Saved:** ~50-200ms per highlight.

### T0-E: Fix TreeWalker to start at body, not documentElement

**File:** `src/commands/highlight-detection.injected.js`
**Line:** 2346
**Current:** When readiness is `not_ready`, the capped TreeWalker starts at
`document.documentElement`, wasting scan budget on `<head>`, `<meta>`, `<link>`,
`<script>` tags.

**Change:** Start at `document.body` instead.

**Tests:**
- Existing highlight-detection tests pass.
- TreeWalker-based scan begins at `<body>`.

**Saved:** Avoids wasting 50-200 of the 500-element budget on non-interactive elements.

---

## Tier 1: Redundant Work Elimination

**Goal:** Remove work that is done multiple times or produces results that are thrown
away. Detection logic and filter ordering remain unchanged.

### T1-A: Defer generateSelector + outerHTML to after page selection

**File:** `src/commands/highlight-detection.injected.js`
**Lines:** 1995-2022 (`toInteractiveElement`), 1611-1698 (`generateSelector`)
**Current:** For every pruned candidate (could be 50-200+), `toInteractiveElement` calls
`generateSelector` (which makes multiple `querySelectorAll` calls for uniqueness) and
reads `element.outerHTML` (which serializes entire subtrees).

**Change:** Split `toInteractiveElement` into two phases:
1. `toInteractiveElementLite`: Returns id='', type, tagName, bbox, searchText, fingerprint
   (cheap fields only). Called for ALL pruned candidates.
2. `toInteractiveElementFull`: Adds selector, html, text (expensive fields). Called only
   for candidates that survive page selection (typically 15-30 per page).

The detection script returns lite elements. Background code applies keyword filtering,
pagination, then calls a second small injected script to enrich only the visible-page
elements.

**Tests:**
- `toInteractiveElementLite` returns all fields except `selector` and `html`.
- `toInteractiveElementFull` returns all fields including `selector` and `html`.
- Full pipeline produces identical element data as before (same fields, same values).
- Pagination and keyword filtering work on lite elements (they only need bbox, text,
  searchText, fingerprint, type, tagName).

**Saved:** ~250 querySelectorAll calls + outerHTML serialization for 80%+ of candidates.

### T1-B: Compute only the requested page

**File:** `src/background/index.ts` lines 177-198 (`buildStoredHighlightPages`),
`src/utils/collision-detection.ts` lines 220-340 (`paginateCollisionFreeElements`)
**Current:** All collision-free pages are computed upfront even when only page 1 is needed.
All pages are stored in cache.

**Change:** `paginateCollisionFreeElements` already accepts a `maxPages` parameter.
Pass `page` (the requested page number) as `maxPages` so it stops after computing the
needed page. For total-page count, use a lightweight estimate from element count / average
page size instead of computing all pages.

**Tests:**
- When `page=1`, only 1 page of collisions is computed.
- `totalPages` is estimated correctly (within +/- 1 of actual).
- Cache still stores the requested page.

**Saved:** O(n^2) collision computation for pages 2+ (significant on dense UIs with 100+
elements).

### T1-C: Truncate outerHTML for large elements

**File:** `src/commands/highlight-detection.injected.js`
**Line:** 2012
**Current:** `candidate.element.outerHTML.trim()` can produce megabytes for large
scrollable containers with hundreds of children.

**Change:** Cap outerHTML to 2000 characters. If truncated, append `<!-- truncated -->`.

**Tests:**
- Small elements have their full outerHTML preserved.
- Elements with outerHTML > 2000 chars are truncated with the marker.

**Saved:** Variable, potentially seconds for large containers.

---

## Tier 2: Scan Efficiency

**Goal:** Reduce the per-element cost and the total number of elements scanned. Changes
the scan approach but preserves the same detection semantics (same elements detected).

### T2-A: Replace querySelectorAll('*') with targeted interactive selectors

**File:** `src/commands/highlight-detection.injected.js`
**Lines:** 2330-2382 (`getCandidateElementsForScan`)
**Current:** `document.querySelectorAll('*')` returns every element in the DOM.

**Change:** Use a union of targeted selectors for potentially-interactive elements:

```js
const INTERACTIVE_SEED_SELECTOR = [
  // Semantic interactive elements
  'a[href]', 'a[target]', 'button', 'input', 'select', 'textarea', 'summary',
  'details', 'label[for]',
  // ARIA roles
  '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="option"]', '[role="radio"]', '[role="switch"]',
  '[role="tab"]', '[role="treeitem"]', '[role="checkbox"]', '[role="combobox"]',
  '[role="textbox"]', '[role="slider"]', '[role="spinbutton"]',
  // Explicit interactivity
  '[tabindex]', '[contenteditable]', '[draggable="true"]',
  '[onclick]', '[ng-click]', '[\\@click]', '[x-on\\:click]',
  '[data-click]', '[data-action]',
  '[onmouseover]', '[onmouseenter]', '[data-hover]',
].join(', ');
```

For scrollable detection (overflow containers), use a second pass on viewport-visible
elements that have overflow styles — but only on elements with `scrollHeight > clientHeight`
or `scrollWidth > clientWidth`.

For pointer-cursor clickables (arbitrary `<div>` with `cursor: pointer`), keep a fallback
scan of viewport-visible elements but limit to non-semantic elements not already captured
by the seed selector.

**Tests:**
- All elements detected by the current `querySelectorAll('*')` approach that end up in
  the final result are also detected by the targeted approach.
- Elements outside the seed selectors that are NOT interactive are correctly skipped.
- Scrollable containers are still detected.
- Pointer-cursor clickables are still detected.
- The scan touches significantly fewer elements (measure: < 30% of querySelectorAll('*')
  count on a typical page).

**Saved:** 60-90% reduction in scanned elements, proportional reduction in
getComputedStyle/getBoundingClientRect calls.

### T2-B: Defer hit-test visibility to after candidate resolution

**File:** `src/commands/highlight-detection.injected.js`
**Lines:** 2420-2421 (hit-test call in scan loop)
**Current:** `getElementHitTestVisibility` (5x `elementsFromPoint()`) runs for every
element that passes basic visibility. Many elements then fail `resolveElementCandidate`
and the hit-test was wasted.

**Change:** Move `getElementHitTestVisibility` to after `resolveElementCandidate` succeeds.
New filter order:
1. `isElementVisibleForDetection` (getComputedStyle)
2. `isElementInViewportForDetection` (getBoundingClientRect)
3. `isElementVisibleInScrollParent` (ancestor walk)
4. `isElementInActiveTopLayer` (containment)
5. `resolveElementCandidate` (type classification)  <-- moved BEFORE hit-test
6. `getElementHitTestVisibility` (5x elementsFromPoint)  <-- moved AFTER resolve

**Tests:**
- Same elements are detected in the final result (identical output for identical input).
- `elementsFromPoint` is only called for elements that have a resolved type.
- Total `elementsFromPoint` call count is reduced (measure: 50-80% reduction).

**Saved:** 50-80% reduction in `elementsFromPoint()` calls.

### T2-C: Cache getComputedStyle and getBoundingClientRect per scan

**File:** `src/commands/highlight-detection.injected.js`
**Change:** Add WeakMap caches for both APIs, scoped to the scan lifecycle:

```js
const _styleCache = new WeakMap();
function cachedStyle(el) {
  let s = _styleCache.get(el);
  if (!s) { s = window.getComputedStyle(el); _styleCache.set(el, s); }
  return s;
}

const _rectCache = new WeakMap();
function cachedRect(el) {
  let r = _rectCache.get(el);
  if (!r) { r = el.getBoundingClientRect(); _rectCache.set(el, r); }
  return r;
}
```

Replace all `window.getComputedStyle(el)` with `cachedStyle(el)` and
`el.getBoundingClientRect()` with `cachedRect(el)` in the detection pipeline.

**Exception:** `getElementRect` in `toInteractiveElement` (final bbox read) should NOT
use cache — it needs a fresh read to capture any layout changes during the scan.

**Tests:**
- `cachedStyle` returns same object for same element on repeated calls.
- `cachedRect` returns same object for same element on repeated calls.
- `getComputedStyle` is called at most once per element per scan.
- `getBoundingClientRect` is called at most once per element per scan (except final bbox).
- Same detection results as before.

**Saved:** 40-60% reduction in style/layout recalculation.

### T2-D: Pre-compute scroll containers

**File:** `src/commands/highlight-detection.injected.js`
**Lines:** 168-206 (`isElementVisibleInScrollParent`)
**Current:** For every element, walks the entire ancestor chain checking `getComputedStyle`
for overflow at each level, plus `getBoundingClientRect` for each scroll parent.

**Change:** Pre-compute the set of scroll containers once before the main scan:

```js
function findScrollContainers() {
  const containers = [];
  // Use targeted selector for overflow elements
  for (const el of document.querySelectorAll('*')) {
    // Only check viewport-visible elements
    const rect = cachedRect(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = cachedStyle(el);
    const ov = style.overflow + ' ' + style.overflowX + ' ' + style.overflowY;
    if (ov.includes('auto') || ov.includes('scroll') || ov.includes('hidden')) {
      containers.push({ el, rect });
    }
  }
  return containers;
}
```

Then `isElementVisibleInScrollParent` checks only the pre-computed containers that are
ancestors of the element (using `container.el.contains(element)`).

**Tests:**
- Scroll containers are correctly identified.
- `isElementVisibleInScrollParent` returns same results as the ancestor-walk approach.
- The ancestor walk is no longer called per-element.

**Saved:** Eliminates O(depth) getComputedStyle/getBoundingClientRect per element in the
scroll-parent check.

---

## Success Criteria

After all tiers, on a 5K DOM page:
- Highlight latency < 1.5s (down from 3-8s)
- Post-action highlight latency < 1.5s (down from 3-8s)
- All 191 existing unit tests pass
- Full evaluation shows no regression in task completion rates

## Verification Plan

After each tier:
1. Run `bun test` — all existing tests must pass
2. Run `npm run dev` to rebuild extension
3. Run evaluation suite via `python eval/evaluate_browser_agent.py`
4. Compare timing metrics in HighlightTrace logs
5. If any regression detected: stop, report, revert
