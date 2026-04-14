const HIGHLIGHT_TYPE_PRIORITY = {
  clickable: 0,
  inputable: 1,
  selectable: 2,
  scrollable: 3,
  hoverable: 4,
  draggable: 5,
  droppable: 6,
};

const HIGHLIGHT_SIGNAL_SCORE = {
  semantic: 500,
  attribute: 420,
  pointer: 320,
  structuralText: 300,
  structuralIcon: 280,
  inputable: 360,
  selectable: 340,
  scrollable: 220,
  hoverable: 160,
};

const POINTER_ROLE_SET = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'switch',
  'tab',
  'treeitem',
]);

const CONTROL_TOKEN_REGEX =
  /\b(action|back|bookmark|btn|button|clear|close|collect|comment|favorite|favourite|filter|follow|like|menu|more|next|pause|play|prev|previous|refresh|reload|reply|save|search|share|star|submit|tab|toggle)\b/i;
const SWIPE_LIBRARY_REGEX =
  /\b(swiper|carousel|slider|slides?|embla|splide|slick|flickity|glide|keen-slider|tns)\b/i;
const VISUALLY_HIDDEN_TOKEN_REGEX =
  /\b(sr-only|sronly|screen-reader|screenreader|screen-reader-only|visually-hidden|visuallyhidden|u-hidden-visually|a11y-hidden)\b/i;
const NOT_READY_SCAN_LIMIT = 500;

// T2-A: Targeted seed selector replacing querySelectorAll('*') for full scans.
// Covers semantic interactives, ARIA roles, attribute-based click handlers,
// and common drag/drop markers. A secondary pass (see getFullScanCandidates)
// catches cursor:pointer div/span fallbacks and pre-computed scroll containers.
const INTERACTIVE_SEED_SELECTOR = [
  // Semantic interactives
  'a[href]',
  'a[target]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
  'label',
  // ARIA roles
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="treeitem"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  // Explicit interactivity
  '[tabindex]',
  '[contenteditable]',
  '[draggable="true"]',
  '[onclick]',
  '[ng-click]',
  '[\\@click]',
  '[x-on\\:click]',
  '[data-click]',
  '[data-action]',
  '[onmouseover]',
  '[onmouseenter]',
  '[data-hover]',
  // Drag-and-drop markers
  '[aria-grabbed]',
  '[data-rbd-draggable-handle]',
  '[data-rbd-drag-handle-draggable-id]',
  '[data-rbd-droppable-id]',
  '[data-dnd-draggable]',
  // Class-based structural clickable hints (catches divs styled as buttons
  // without cursor:pointer — getStructuralClickableSignal still filters these
  // by size/text/SVG signals, so false positives are rejected downstream).
  '[class*="btn"]',
  '[class*="button"]',
  '[class*="Button"]',
  '[class*="Btn"]',
].join(', ');

// Broader tag set for the cursor:pointer / grab fallback scan. Elements in
// INTERACTIVE_SEED_SELECTOR are deduped. The actual interactivity filter
// still runs in the main scan (isElementVisibleForDetection +
// resolveElementCandidate), so including extra tags is safe — they simply
// get rejected if they don't qualify.
const POINTER_CURSOR_FALLBACK_SELECTOR = [
  'div', 'span', 'li', 'td', 'th', 'tr',
  'section', 'article', 'main', 'aside', 'nav',
  'header', 'footer', 'figure', 'figcaption',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'svg', 'picture', 'video',
].join(', ');

// Tags that commonly host overflow:auto/scroll/hidden containers. Narrow
// set keeps findScrollContainers O(containers) rather than O(DOM).
// Also includes class/style hints for custom elements or framework
// components (e.g., <x-scroll-area>, styled spans) that use scroll behavior
// without being one of the tag-whitelisted containers.
const SCROLL_CONTAINER_TAG_SELECTOR = [
  'div', 'section', 'article', 'main', 'aside', 'nav',
  'header', 'footer', 'ul', 'ol', 'dl', 'form',
  'table', 'tbody', 'figure', 'details', 'dialog', 'menu',
  '[class*="scroll"]',
  '[class*="Scroll"]',
  '[style*="overflow"]',
].join(', ');

const TEXT_LIKE_TAG_SET = new Set([
  'a',
  'abbr',
  'b',
  'cite',
  'code',
  'dd',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'label',
  'li',
  'p',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
]);

function hasCallableMethod(value, methodNames) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  return methodNames.some(
    (methodName) => typeof value[methodName] === 'function',
  );
}

function createHighlightTrace() {
  const traceStart = performance.now();

  return function trace(stage, details) {
    const elapsed = Math.round(performance.now() - traceStart);
    const suffix = details ? ` ${details}` : '';
    console.log(`[HighlightTrace] ${stage} +${elapsed}ms${suffix}`);
  };
}

function normalizeWhitespace(value, maxLength = 240) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, maxLength);
}

function escapeCssValue(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return String(value).replace(/([.#:[\],\s+>~])/g, '\\$1');
}

function getElementRect(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function getElementArea(rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

// ──────────────────────────────────────────────────────────────
// T2-C: Per-scan caches for getComputedStyle and getBoundingClientRect.
// Reset via resetDetectionCaches() at the start of each detection run.
// Using module-level lets so helpers throughout the file can share them.
// Rationale: during a scan, the same element is tested in multiple contexts
// (visibility, viewport, scroll-parent, candidate resolution, hit-test,
// ancestor walks). Caching avoids 5-10x redundant getComputedStyle calls.
// ──────────────────────────────────────────────────────────────

let _styleCache = new WeakMap();
let _rectCache = new WeakMap();
let _scrollContainers = [];

function cachedStyle(el) {
  let s = _styleCache.get(el);
  if (!s) {
    s = window.getComputedStyle(el);
    _styleCache.set(el, s);
  }
  return s;
}

function cachedRect(el) {
  let r = _rectCache.get(el);
  if (!r) {
    r = el.getBoundingClientRect();
    _rectCache.set(el, r);
  }
  return r;
}

function resetDetectionCaches() {
  _styleCache = new WeakMap();
  _rectCache = new WeakMap();
  _scrollContainers = [];
}

// T2-D: Pre-compute the list of elements that act as scroll/clip containers.
// Each entry carries the cached rect and overflow axes so the per-element
// scroll-parent check can skip re-reading style/rect during the main scan.
function findScrollContainers() {
  const containers = [];
  const candidates = document.querySelectorAll(SCROLL_CONTAINER_TAG_SELECTOR);
  for (const el of candidates) {
    if (el === document.body || el === document.documentElement) {
      continue;
    }
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const rect = cachedRect(el);
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    const style = cachedStyle(el);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;
    const hasScrollX =
      overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden';
    const hasScrollY =
      overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden';
    if (hasScrollX || hasScrollY) {
      containers.push({ el, rect, hasScrollX, hasScrollY });
    }
  }
  return containers;
}

function isElementVisibleForDetection(el) {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
    return false;
  }

  // Explicit aria-hidden="true" is a hard signal that this node is not meant
  // for user interaction. Accessibility/automation overlays (e.g. Baidu
  // button-hp-installed decoys, screen-reader-skip wrappers) set this along
  // with tabindex="-1" and near-zero opacity. Skipping them avoids cache
  // pollution that later causes selector drift via :nth-of-type.
  if (el.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  if (el instanceof HTMLElement && isVisuallyHiddenForDetection(el)) {
    return false;
  }

  const style = cachedStyle(el);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }

  // Near-zero opacity (e.g. opacity: 1e-05 used by automation overlays to
  // remain hit-testable but invisible). Treat as not visible for detection.
  const opacityNum = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacityNum) && opacityNum < 0.01) {
    return false;
  }

  // CSS opacity creates a compositing group: a child with opacity:1 inside
  // a parent with opacity:0 is invisible, but getComputedStyle(child).opacity
  // still returns '1'. Walk up ancestors to catch hover-revealed containers
  // (e.g. video player control bars that use opacity:0 → opacity:1 on hover).
  let ancestor = el.parentElement;
  for (let i = 0; i < 5 && ancestor; i++) {
    if (ancestor === document.body || ancestor === document.documentElement)
      break;
    if (cachedStyle(ancestor).opacity === '0') return false;
    ancestor = ancestor.parentElement;
  }

  const rect = cachedRect(el);
  return rect.width > 0 && rect.height > 0;
}

function isElementInViewportForDetection(el) {
  const rect = cachedRect(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// T2-D: Check whether an element is visible within all ancestor scroll
// containers by consulting the pre-computed _scrollContainers list rather
// than walking the ancestor chain and re-reading style/rect per element.
// Elements inside overflow:auto/scroll parents that are scrolled out of view
// should not be highlighted — the agent should scroll to discover them.
function isElementVisibleInScrollParent(el) {
  const containers = _scrollContainers;
  if (!containers || containers.length === 0) {
    return true;
  }
  const elRect = cachedRect(el);
  // Allow a small tolerance (2px) for border/padding edge cases
  const tolerance = 2;
  for (const container of containers) {
    if (container.el === el) continue;
    if (!container.el.contains(el)) continue;
    const parentRect = container.rect;
    if (container.hasScrollY) {
      if (
        elRect.bottom <= parentRect.top + tolerance ||
        elRect.top >= parentRect.bottom - tolerance
      ) {
        return false;
      }
    }
    if (container.hasScrollX) {
      if (
        elRect.right <= parentRect.left + tolerance ||
        elRect.left >= parentRect.right - tolerance
      ) {
        return false;
      }
    }
  }
  return true;
}

function getDomDepth(el) {
  let depth = 0;
  let current = el;

  while (current && current !== document.body) {
    depth += 1;
    current = current.parentElement;
  }

  return depth;
}

function getAttributeTextTokens(el, attributeNames) {
  const tokens = [];

  for (const attributeName of attributeNames) {
    const value = el.getAttribute(attributeName);
    if (!value) {
      continue;
    }

    const normalized = normalizeWhitespace(value, 80);
    if (normalized) {
      tokens.push(normalized);
    }
  }

  return tokens;
}

function getClassTokens(el) {
  return Array.from(el.classList)
    .filter(
      (token) =>
        token.length > 1 && token.length <= 40 && /^[a-z0-9_-]+$/i.test(token),
    )
    .slice(0, 8);
}

function isVisuallyHiddenForDetection(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  const markerText = normalizeWhitespace(
    [el.id, ...getClassTokens(el)].join(' '),
    160,
  ).toLowerCase();
  if (VISUALLY_HIDDEN_TOKEN_REGEX.test(markerText)) {
    return true;
  }

  const style = cachedStyle(el);
  const rect = cachedRect(el);
  const tinyBox = rect.width <= 4 && rect.height <= 4;
  const hidesOverflow =
    style.overflow === 'hidden' ||
    style.overflowX === 'hidden' ||
    style.overflowY === 'hidden' ||
    style.overflow === 'clip' ||
    style.overflowX === 'clip' ||
    style.overflowY === 'clip';
  const isClipped =
    (style.clip && style.clip !== 'auto') ||
    (style.clipPath && style.clipPath !== 'none');
  const isOffscreen =
    rect.right < -32 ||
    rect.bottom < -32 ||
    rect.left > window.innerWidth + 32 ||
    rect.top > window.innerHeight + 32;

  return (
    tinyBox &&
    (hidesOverflow || isClipped || style.whiteSpace === 'nowrap') &&
    (style.position === 'absolute' || style.position === 'fixed' || isOffscreen)
  );
}

function getSwipeMarkerText(el) {
  return normalizeWhitespace(
    [
      el.tagName.toLowerCase(),
      el.id,
      ...getClassTokens(el),
      ...getAttributeTextTokens(el, [
        'role',
        'aria-label',
        'aria-roledescription',
        'data-swiper',
        'data-carousel',
        'data-slider',
        'data-testid',
      ]),
    ].join(' '),
    320,
  ).toLowerCase();
}

function getElementTextForDetection(el) {
  if (el instanceof HTMLInputElement) {
    const inputType = (el.type || '').toLowerCase();
    if (
      inputType === 'button' ||
      inputType === 'submit' ||
      inputType === 'reset'
    ) {
      return normalizeWhitespace(el.value, 120);
    }
  }

  return normalizeWhitespace(el.textContent || '', 240);
}

function getElementSearchText(el) {
  const tokens = [
    el.tagName.toLowerCase(),
    ...getAttributeTextTokens(el, [
      'role',
      'type',
      'name',
      'id',
      'aria-label',
      'title',
      'placeholder',
      'alt',
      // Stable test-hook attributes — recognised so the routine-replay
      // compiler can emit `**Keywords:** <token>` hints for elements that
      // expose these as their only reliable identifier. Generic HTML text
      // matching still owns the default path; these attributes just let
      // replay-mode keyword hints land.
      'data-testid',
      'data-test',
      'data-test-id',
      'data-cy',
      'data-qa',
    ]),
    ...getClassTokens(el),
  ];

  const value =
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
      ? normalizeWhitespace(el.value || '', 120)
      : '';
  if (value) {
    tokens.push(value);
  }

  const text = getElementTextForDetection(el);
  if (text) {
    tokens.push(text);
  }

  return normalizeWhitespace(tokens.join(' '), 320).toLowerCase();
}

function getCurrentDocumentId() {
  return `${Math.trunc(performance.timeOrigin)}|${location.href}`;
}

function getElementFingerprint(el) {
  const tokens = [
    el.tagName.toLowerCase(),
    ...getAttributeTextTokens(el, [
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
    ...getClassTokens(el).slice(0, 4),
  ];

  const text = getElementTextForDetection(el);
  if (text) {
    tokens.push(text);
  }

  return normalizeWhitespace(tokens.join(' | '), 240).toLowerCase();
}

function hasControlIntentToken(el) {
  return CONTROL_TOKEN_REGEX.test(getElementSearchText(el));
}

function countVisibleSvgDescendants(el, maxCount = 2) {
  let count = 0;
  const svgNodes = el.querySelectorAll('svg');

  for (const svg of svgNodes) {
    if (!isElementVisibleForDetection(svg)) {
      continue;
    }

    count += 1;
    if (count >= maxCount) {
      return count;
    }
  }

  return count;
}

function countVisibleElementChildren(el, maxCount = Number.POSITIVE_INFINITY) {
  let count = 0;

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (!isElementVisibleForDetection(child)) {
      continue;
    }

    count += 1;
    if (count >= maxCount) {
      return count;
    }
  }

  return count;
}

function hasClickLikeAttributes(el) {
  return (
    el.hasAttribute('onclick') ||
    el.hasAttribute('ng-click') ||
    el.hasAttribute('@click') ||
    el.hasAttribute('x-on:click') ||
    el.hasAttribute('data-click') ||
    el.hasAttribute('data-action')
  );
}

function getTabIndexValue(el) {
  const raw = el.getAttribute('tabindex');
  if (raw == null) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDisabledForDetection(el) {
  if (
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true'
  ) {
    return true;
  }

  if ('disabled' in el && el.disabled === true) {
    return true;
  }

  if (el.closest('[inert]')) {
    return true;
  }

  return false;
}

function hasPointerCursor(el) {
  return cachedStyle(el).cursor === 'pointer';
}

function getBaseClickableSignal(el) {
  const semanticSignal = getSemanticClickableSignal(el);
  if (semanticSignal) {
    return semanticSignal;
  }

  const structuralSignal = getStructuralClickableSignal(el);
  if (structuralSignal) {
    return structuralSignal;
  }

  if (!isMeaningfulPointerCandidate(el)) {
    return null;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'html' || tag === 'select') {
    return null;
  }

  return 'pointer';
}

function isNumericCounterText(text) {
  const normalized = normalizeWhitespace(text, 32)
    .replace(/,/g, '')
    .toLowerCase();
  return /^(?:\d+(?:\.\d+)?)(?:[kmw]|万|亿)?$/.test(normalized);
}

function isLikelyCountTextElement(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  if (!['span', 'div', 'strong', 'em', 'b', 'i'].includes(tag)) {
    return false;
  }

  const text = getElementTextForDetection(el);
  if (!text || !isNumericCounterText(text)) {
    return false;
  }

  const searchText = getElementSearchText(el);
  return (
    /\b(count|num|number|total|qty)\b/i.test(searchText) ||
    el.children.length === 0
  );
}

function getControlAffinityScore(el) {
  const searchText = getElementSearchText(el);
  const text = getElementTextForDetection(el);
  let score = 0;

  if (hasControlIntentToken(el)) {
    score += 24;
  }

  if (text.length > 0) {
    score += Math.min(40, text.length);
  }

  if (
    /\b(bookmark|button|btn|collect|favorite|favourite|filter|follow|like|refresh|reload|reply|save|search|share|star|submit|toggle)\b/i.test(
      searchText,
    )
  ) {
    score += 12;
  }

  if (/\b(icon|svg)\b/i.test(searchText)) {
    score -= 10;
  }

  if (hasControlIntentToken(el) && countVisibleSvgDescendants(el, 1) > 0) {
    score += 18;
  }

  if (isLikelyCountTextElement(el)) {
    score -= 24;
  }

  const rect = cachedRect(el);
  if (rect.width >= 20 && rect.height >= 20) {
    score += 6;
  }

  return score;
}

function getSemanticClickableSignal(el) {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();

  if (tag === 'button' || tag === 'summary') {
    return 'semantic';
  }

  if (tag === 'a' && (el.getAttribute('href') || el.hasAttribute('target'))) {
    return 'semantic';
  }

  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (
      ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(
        inputType,
      )
    ) {
      return 'semantic';
    }
  }

  if (POINTER_ROLE_SET.has(role)) {
    return 'semantic';
  }

  if (hasClickLikeAttributes(el)) {
    return 'attribute';
  }

  const tabIndex = getTabIndexValue(el);
  if (tabIndex !== null && tabIndex >= 0 && hasPointerCursor(el)) {
    return 'attribute';
  }

  return null;
}

function isSemanticControlElement(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();

  if (tag === 'button' || tag === 'summary') {
    return true;
  }

  if (tag === 'a' && (el.getAttribute('href') || el.hasAttribute('target'))) {
    return true;
  }

  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (
      ['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(
        inputType,
      )
    ) {
      return true;
    }
  }

  return POINTER_ROLE_SET.has(role);
}

function isMeaningfulPointerCandidate(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  if (!hasPointerCursor(el) || isDisabledForDetection(el)) {
    return false;
  }

  const rect = cachedRect(el);
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = getElementArea(rect);

  if (elementArea <= 0) {
    return false;
  }

  if (elementArea > viewportArea * 0.35) {
    // Large elements are usually layout wrappers, not interaction targets.
    // Exception: cursor:pointer + user-select:none together indicate a
    // deliberate interactive region (video player, canvas app, game area).
    if (elementArea > viewportArea * 0.7) return false;
    return cachedStyle(el).userSelect === 'none';
  }

  const searchText = getElementSearchText(el);
  if (searchText.length > 0) {
    return true;
  }

  return rect.width <= 80 && rect.height <= 80;
}

function getStructuralClickableSignal(el) {
  if (!(el instanceof HTMLElement)) {
    return null;
  }

  if (isDisabledForDetection(el)) {
    return null;
  }

  const tag = el.tagName.toLowerCase();
  if (
    tag === 'body' ||
    tag === 'html' ||
    tag === 'label' ||
    tag === 'select' ||
    tag === 'svg'
  ) {
    return null;
  }

  if (isInputableCandidate(el) || isSelectableCandidate(el)) {
    return null;
  }

  if (countDirectClickableChildren(el) >= 2) {
    return null;
  }

  if (
    hasExplicitClickableAncestor(el) ||
    hasStructuredInteractiveDescendant(el)
  ) {
    return null;
  }

  const rect = cachedRect(el);
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = getElementArea(rect);
  if (
    elementArea <= 0 ||
    elementArea > viewportArea * 0.08 ||
    rect.width > 260 ||
    rect.height > 140
  ) {
    return null;
  }

  const visibleSvgCount = countVisibleSvgDescendants(el);
  const hasSvg = visibleSvgCount > 0;
  const hasControlToken = hasControlIntentToken(el);
  const text = getElementTextForDetection(el);
  const compact = rect.width <= 220 && rect.height <= 120;

  if (!compact) {
    return null;
  }

  if (hasControlToken && text.length > 0) {
    return 'structuralText';
  }

  if (hasSvg && (hasControlToken || text.length > 0 || elementArea <= 6400)) {
    return text.length > 0 ? 'structuralText' : 'structuralIcon';
  }

  return null;
}

function countDirectClickableChildren(el) {
  let count = 0;

  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (!isElementVisibleForDetection(child)) {
      continue;
    }

    const signal = getBaseClickableSignal(child);
    if (!signal) {
      continue;
    }

    count += 1;
    if (count >= 2) {
      return count;
    }
  }

  return count;
}

function hasExplicitClickableAncestor(el) {
  let current = el.parentElement;

  while (current && current !== document.body) {
    const signal = getSemanticClickableSignal(current);
    if (signal === 'semantic' || signal === 'attribute') {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function isInputableCandidate(el) {
  if (isDisabledForDetection(el)) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') {
    return true;
  }

  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    return ![
      'button',
      'submit',
      'reset',
      'image',
      'checkbox',
      'radio',
      'hidden',
      'file',
    ].includes(inputType);
  }

  return el.isContentEditable;
}

function isSelectableCandidate(el) {
  return !isDisabledForDetection(el) && el.tagName.toLowerCase() === 'select';
}

function hasStructuredInteractiveDescendant(el) {
  const stack = [];
  for (const child of Array.from(el.children)) {
    stack.push({ node: child, depth: 1 });
  }

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > 4) {
      continue;
    }

    const node = current.node;
    if (!isElementVisibleForDetection(node)) {
      continue;
    }

    if (
      getSemanticClickableSignal(node) ||
      isInputableCandidate(node) ||
      isSelectableCandidate(node)
    ) {
      return true;
    }

    for (const child of Array.from(node.children)) {
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }

  return false;
}

function isClickableCandidate(el) {
  if (isDisabledForDetection(el)) {
    return null;
  }

  const baseSignal = getBaseClickableSignal(el);
  if (!baseSignal) {
    return null;
  }

  if (hasExplicitClickableAncestor(el)) {
    return null;
  }

  if (hasStructuredInteractiveDescendant(el)) {
    return null;
  }

  return baseSignal;
}

function isTightClickableWrapper(parent, child) {
  if (!(parent instanceof HTMLElement) || !(child instanceof HTMLElement)) {
    return false;
  }

  if (!parent.contains(child)) {
    return false;
  }

  if (countDirectClickableChildren(parent) >= 2) {
    return false;
  }

  const parentRect = cachedRect(parent);
  const childRect = cachedRect(child);
  const parentArea = getElementArea(parentRect);
  const childArea = getElementArea(childRect);

  if (parentArea <= 0 || childArea <= 0 || parentArea < childArea) {
    return false;
  }

  const areaRatio = parentArea / childArea;
  if (areaRatio > 5) {
    return false;
  }

  if (parentRect.width - childRect.width > 96) {
    return false;
  }

  if (parentRect.height - childRect.height > 56) {
    return false;
  }

  const visibleChildCount = Array.from(parent.children).filter((node) =>
    isElementVisibleForDetection(node),
  ).length;

  return visibleChildCount <= 3;
}

function compareClickableRootCandidates(a, b) {
  if (a.quality !== b.quality) {
    return b.quality - a.quality;
  }

  if (a.signalScore !== b.signalScore) {
    return b.signalScore - a.signalScore;
  }

  if (a.element.contains(b.element)) {
    return -1;
  }

  if (b.element.contains(a.element)) {
    return 1;
  }

  if (a.area !== b.area) {
    return a.area - b.area;
  }

  return b.depth - a.depth;
}

function resolveClickableCandidate(el) {
  let current =
    el instanceof HTMLElement
      ? el
      : el instanceof SVGElement
        ? el.parentElement
        : null;

  if (!(current instanceof HTMLElement)) {
    return null;
  }

  const candidates = [];
  let previousClickableElement = null;
  let depth = 0;

  while (current && current !== document.body && depth < 5) {
    const signalSource = isClickableCandidate(current);
    if (signalSource) {
      if (
        previousClickableElement &&
        !isTightClickableWrapper(current, previousClickableElement)
      ) {
        break;
      }

      const rect = getElementRect(current);
      const area = getElementArea(rect);
      candidates.push({
        element: current,
        signalSource,
        signalScore: getCandidateSignal('clickable', signalSource, current),
        quality:
          getCandidateSignal('clickable', signalSource, current) +
          getControlAffinityScore(current),
        rect,
        area,
        depth: getDomDepth(current),
      });
      previousClickableElement = current;
    } else if (
      previousClickableElement &&
      !isTightClickableWrapper(current, previousClickableElement)
    ) {
      break;
    }

    current = current.parentElement;
    depth += 1;
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(compareClickableRootCandidates);
  return candidates[0];
}

function isLikelyTextTruncationContainer(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  if (isInputableCandidate(el) || isSelectableCandidate(el)) {
    return false;
  }

  const style = cachedStyle(el);
  const rect = cachedRect(el);
  const horizontalOverflow = el.scrollWidth - el.clientWidth;
  const verticalOverflow = el.scrollHeight - el.clientHeight;
  const singleLineText =
    style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
  const isEllipsisText = style.textOverflow === 'ellipsis';

  if (
    horizontalOverflow <= Math.max(24, el.clientWidth * 0.15) ||
    verticalOverflow > 8 ||
    rect.height > 48 ||
    (!singleLineText && !isEllipsisText)
  ) {
    return false;
  }

  const visibleChildCount = countVisibleElementChildren(el, 2);
  if (visibleChildCount > 1) {
    return false;
  }

  if (TEXT_LIKE_TAG_SET.has(el.tagName.toLowerCase())) {
    return true;
  }

  const onlyVisibleChild = Array.from(el.children).find(
    (child) =>
      child instanceof HTMLElement && isElementVisibleForDetection(child),
  );
  if (!(onlyVisibleChild instanceof HTMLElement)) {
    return false;
  }

  const childStyle = cachedStyle(onlyVisibleChild);
  return (
    childStyle.display.startsWith('inline') || childStyle.display === 'contents'
  );
}

function isScrollableCandidate(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'html') {
    return false;
  }

  if (
    isSemanticControlElement(el) ||
    isInputableCandidate(el) ||
    isSelectableCandidate(el) ||
    isVisuallyHiddenForDetection(el) ||
    isLikelyTextTruncationContainer(el)
  ) {
    return false;
  }

  const style = cachedStyle(el);
  const overflowX = `${style.overflow} ${style.overflowX}`.toLowerCase();
  const overflowY = `${style.overflow} ${style.overflowY}`.toLowerCase();
  const horizontalOverflow = el.scrollWidth - el.clientWidth;
  const verticalOverflow = el.scrollHeight - el.clientHeight;
  const canScrollVertically =
    (overflowY.includes('auto') || overflowY.includes('scroll')) &&
    el.clientHeight >= 40 &&
    verticalOverflow > Math.max(24, el.clientHeight * 0.15);
  const canScrollHorizontally =
    (overflowX.includes('auto') || overflowX.includes('scroll')) &&
    el.clientWidth >= 80 &&
    horizontalOverflow > Math.max(32, el.clientWidth * 0.15);
  const canSwipeHorizontally =
    (overflowX.includes('hidden') || overflowX.includes('clip')) &&
    el.clientWidth >= 120 &&
    el.clientHeight >= 72 &&
    horizontalOverflow > Math.max(48, el.clientWidth * 0.2) &&
    hasHorizontalSwipeLayout(el);

  return canScrollVertically || canScrollHorizontally || canSwipeHorizontally;
}

function isHoverableCandidate(el) {
  if (isInputableCandidate(el) || isSelectableCandidate(el)) {
    return false;
  }

  if (isClickableCandidate(el)) {
    return false;
  }

  if (
    el.hasAttribute('onmouseover') ||
    el.hasAttribute('onmouseenter') ||
    el.hasAttribute('data-hover')
  ) {
    return true;
  }

  if (!isMeaningfulPointerCandidate(el)) {
    return false;
  }

  if (
    hasExplicitClickableAncestor(el) ||
    hasStructuredInteractiveDescendant(el)
  ) {
    return false;
  }

  return true;
}

// ──────────────────────────────────────────────────────────────
// Drag-and-drop detection predicates
// ──────────────────────────────────────────────────────────────

/** Per-scan cache so Tier 4 droppable inference doesn't re-evaluate. */
const _draggableCache = new WeakMap();

const DROP_TOKEN_REGEX =
  /\b(drop|zone|target|column|lane|bucket|list|board)\b/i;

function isDraggableCandidate(el) {
  if (_draggableCache.has(el)) {
    return _draggableCache.get(el);
  }
  const result = _isDraggableCandidateCore(el);
  _draggableCache.set(el, result);
  return result;
}

function _isDraggableCandidateCore(el) {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'BODY' || tag === 'HTML') {
    return false;
  }
  if (el instanceof HTMLElement && el.hasAttribute('disabled')) {
    return false;
  }

  // Tier 1 — Explicit markers
  if (el.draggable === true || el.getAttribute('draggable') === 'true') {
    return true;
  }
  if (
    el.hasAttribute('data-rbd-draggable-handle') ||
    el.hasAttribute('data-rbd-drag-handle-draggable-id') ||
    el.hasAttribute('data-dnd-draggable') ||
    el.hasAttribute('aria-grabbed')
  ) {
    return true;
  }

  // Tier 2 — Library container children
  let parent = el.parentElement;
  for (
    let depth = 0;
    parent && depth < 2;
    depth += 1, parent = parent.parentElement
  ) {
    if (parent instanceof HTMLElement) {
      const parentClasses = Array.from(parent.classList).join(' ');
      if (/\bsortable\b/i.test(parentClasses) && parent.contains(el)) {
        return true;
      }
      if (
        parent.hasAttribute('data-rbd-droppable-id') &&
        el.hasAttribute('data-rbd-draggable-context-id')
      ) {
        return true;
      }
    }
  }

  // Tier 3 — CSS / structural heuristics
  // Exclude sliders — they should use set_slider, not drag_and_drop
  if (el instanceof HTMLInputElement && el.type === 'range') {
    return false;
  }
  if (el.getAttribute && el.getAttribute('role') === 'slider') {
    return false;
  }
  if (el instanceof HTMLElement) {
    const computedCursor = cachedStyle(el).cursor;
    const hasGrabCursor =
      computedCursor === 'grab' || computedCursor === 'move';
    if (hasGrabCursor) {
      return true;
    }
  }

  // Tier 4 — Direct child of structural drop zone (covers custom mousedown DnD)
  // If the element has user-select:none and its IMMEDIATE parent's class tokens
  // match the drop-zone regex, and that parent has 2+ visible children of the
  // same tag, the element is likely a drag source.
  // Only class names are checked — data attributes like data-column-id are
  // references, not structural markers. Only the immediate parent is checked
  // because user-select:none is inherited.
  if (el instanceof HTMLElement) {
    const userSelect = cachedStyle(el).userSelect;
    if (userSelect === 'none') {
      const ancestor = el.parentElement;
      if (ancestor instanceof HTMLElement) {
        const cls = Array.from(ancestor.classList).join(' ');
        if (DROP_TOKEN_REGEX.test(cls.toLowerCase())) {
          const elTag = el.tagName;
          const sameTagSiblings = Array.from(ancestor.children).filter(
            (c) =>
              c instanceof HTMLElement &&
              c.tagName === elTag &&
              c.offsetParent !== null,
          );
          if (sameTagSiblings.length >= 2) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function isDroppableCandidate(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'BODY' || tag === 'HTML') {
    return false;
  }
  const rect = cachedRect(el);
  if (rect.width < 40 || rect.height < 40) {
    return false;
  }

  // Tier 1 — Explicit markers
  const dropEffect = el.getAttribute('aria-dropeffect');
  if (dropEffect && dropEffect !== 'none') {
    return true;
  }
  if (
    el.hasAttribute('data-rbd-droppable-id') ||
    el.hasAttribute('data-dnd-droppable') ||
    el.hasAttribute('dropzone')
  ) {
    return true;
  }

  // Tier 2 — Library container patterns
  const classes = Array.from(el.classList).join(' ');
  if (/\bsortable\b/i.test(classes)) {
    const visibleChildren = Array.from(el.children).filter(
      (child) => child instanceof HTMLElement && child.offsetParent !== null,
    );
    if (visibleChildren.length >= 2) {
      return true;
    }
  }

  // Tier 3 — Parent-of-draggable inference (uses cached isDraggableCandidate)
  const directChildren = Array.from(el.children).filter(
    (child) => child instanceof HTMLElement && child.offsetParent !== null,
  );
  if (directChildren.length >= 2) {
    let draggableCount = 0;
    for (const child of directChildren) {
      if (isDraggableCandidate(child)) {
        draggableCount += 1;
        if (draggableCount >= 2) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Detect slider-like elements that should be interacted with via set_slider.
 * Matches:
 *   Tier 1 — Explicit markers:
 *     - Native <input type="range">
 *     - Elements with role="slider" (custom ARIA sliders)
 *   Tier 2 — Structural heuristic for custom progress bars:
 *     - cursor: pointer AND class/id contains slider-related tokens
 *       AND has a child whose class suggests a track/fill/thumb structure
 */
const SLIDER_TOKEN_REGEX =
  /\b(progress|slider|seek|scrub|range|timeline|playback)\b/i;
const SLIDER_CHILD_TOKEN_REGEX =
  /\b(track|played|filled|fill|thumb|scrubber|bar|handle|knob|indicator)\b/i;

function isSlidableCandidate(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  // Tier 1: Native range input
  if (el instanceof HTMLInputElement && el.type === 'range') {
    return true;
  }
  // Tier 1: ARIA slider
  if (el.getAttribute('role') === 'slider') {
    return true;
  }

  // Tier 2: Custom progress bar heuristic
  // Requires ALL of: slider-related class/id token + pointer cursor + structural child
  const idAndClass = (el.id || '') + ' ' + Array.from(el.classList).join(' ');
  if (!SLIDER_TOKEN_REGEX.test(idAndClass)) {
    return false;
  }
  const cursor = cachedStyle(el).cursor;
  if (cursor !== 'pointer' && cursor !== 'grab' && cursor !== 'move') {
    return false;
  }
  // Check for at least one child with track/fill/thumb-like class
  const children = el.querySelectorAll('*');
  for (let i = 0; i < children.length && i < 30; i++) {
    const childClasses = Array.from(children[i].classList).join(' ');
    if (SLIDER_CHILD_TOKEN_REGEX.test(childClasses)) {
      return true;
    }
  }
  return false;
}

function hasSwipeApi(el) {
  const candidates = [
    el.swiper,
    el.__swiper__,
    el.embla,
    el._splide,
    el.flickity,
    el.keenSlider,
    el.glide,
  ];

  return candidates.some((candidate) =>
    hasCallableMethod(candidate, [
      'slideNext',
      'slidePrev',
      'slideTo',
      'next',
      'prev',
      'scrollNext',
      'scrollPrev',
      'go',
      'moveToIdx',
    ]),
  );
}

function hasHorizontalSwipeLayout(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  const rect = cachedRect(el);
  if (rect.width < 140 || rect.height < 80) {
    return false;
  }

  const style = cachedStyle(el);
  const overflowX = `${style.overflow} ${style.overflowX}`.toLowerCase();
  const constrainsOverflowX =
    overflowX.includes('hidden') ||
    overflowX.includes('clip') ||
    overflowX.includes('scroll') ||
    overflowX.includes('auto');

  const visibleChildren = Array.from(el.children).filter(
    (child) =>
      child instanceof HTMLElement && isElementVisibleForDetection(child),
  );

  if (visibleChildren.length === 0) {
    return false;
  }

  const primaryTrack =
    visibleChildren.find((child) => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }

      const childStyle = cachedStyle(child);
      return (
        childStyle.transform !== 'none' ||
        childStyle.display.includes('flex') ||
        childStyle.whiteSpace === 'nowrap'
      );
    }) ||
    (visibleChildren[0] instanceof HTMLElement ? visibleChildren[0] : null);

  if (!(primaryTrack instanceof HTMLElement)) {
    return false;
  }

  const trackChildren = Array.from(primaryTrack.children).filter(
    (child) =>
      child instanceof HTMLElement && isElementVisibleForDetection(child),
  );

  if (trackChildren.length < 2) {
    return false;
  }

  let horizontalSteps = 0;
  let verticalAligned = 0;
  let previousRect = null;

  for (const child of trackChildren.slice(0, 6)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const childRect = cachedRect(child);
    if (childRect.width < 40 || childRect.height < 40) {
      continue;
    }

    if (previousRect) {
      if (childRect.left > previousRect.left + 12) {
        horizontalSteps += 1;
      }
      if (
        Math.abs(childRect.top - previousRect.top) <=
        Math.max(24, rect.height * 0.2)
      ) {
        verticalAligned += 1;
      }
    }

    previousRect = childRect;
  }

  return (
    constrainsOverflowX &&
    primaryTrack.scrollWidth > el.clientWidth + 24 &&
    horizontalSteps >= 1 &&
    verticalAligned >= 1
  );
}

function findSwipeDescendant(root, maxDepth = 3, maxNodes = 48) {
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
    if (!(node instanceof HTMLElement) || !isElementVisibleForDetection(node)) {
      continue;
    }

    visited += 1;

    const markerText = getSwipeMarkerText(node);
    if (hasSwipeApi(node)) {
      return node;
    }

    if (
      SWIPE_LIBRARY_REGEX.test(markerText) &&
      (hasHorizontalSwipeLayout(node) || markerText.includes('swiper'))
    ) {
      return node;
    }

    if (hasHorizontalSwipeLayout(node)) {
      return node;
    }

    for (const child of Array.from(node.children)) {
      queue.push({ node: child, depth: current.depth + 1 });
    }
  }

  return null;
}

function findSwipeContext(el, maxDepth = 4) {
  let current =
    el instanceof HTMLElement
      ? el
      : el instanceof SVGElement
        ? el.parentElement
        : null;
  let depth = 0;

  while (current && current !== document.body && depth <= maxDepth) {
    const markerText = getSwipeMarkerText(current);
    if (hasSwipeApi(current)) {
      return current;
    }

    if (
      SWIPE_LIBRARY_REGEX.test(markerText) &&
      (hasHorizontalSwipeLayout(current) || markerText.includes('swiper'))
    ) {
      return current;
    }

    if (
      hasHorizontalSwipeLayout(current) &&
      cachedRect(current).width >= 180
    ) {
      return current;
    }

    const descendantMatch = findSwipeDescendant(current);
    if (descendantMatch) {
      return descendantMatch;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function getInteractionHints(el) {
  const hints = [];

  if (findSwipeContext(el)) {
    hints.push('swipable');
  }

  // Check the element itself and also walk its direct children (up to 20)
  // because resolveClickableCandidate may have lifted a child handle to a
  // parent wrapper, losing descendant-only drag signals.
  if (isDraggableCandidate(el)) {
    hints.push('draggable');
  } else {
    const children = el.children;
    for (let i = 0; i < children.length && i < 20; i++) {
      if (isDraggableCandidate(children[i])) {
        hints.push('draggable');
        break;
      }
    }
  }

  if (isDroppableCandidate(el)) {
    hints.push('droppable');
  }

  // Check element, its children, AND its ancestors for slidable signal.
  // - Children: resolveClickableCandidate may have lifted a child slider to a parent
  // - Ancestors: a leaf element inside a slider container (e.g. progress-buffered
  //   inside progress-area) needs the hint propagated from its container
  if (isSlidableCandidate(el)) {
    hints.push('slidable');
  } else {
    let foundSlidable = false;
    // Check direct children
    const sliderChildren = el.children;
    for (let i = 0; i < sliderChildren.length && i < 20; i++) {
      if (isSlidableCandidate(sliderChildren[i])) {
        foundSlidable = true;
        break;
      }
    }
    // Check ancestors (up to 3 levels) — handles leaf elements inside slider containers
    if (!foundSlidable) {
      let ancestor = el.parentElement;
      for (
        let depth = 0;
        ancestor && depth < 3;
        depth++, ancestor = ancestor.parentElement
      ) {
        if (ancestor === document.body || ancestor === document.documentElement)
          break;
        if (isSlidableCandidate(ancestor)) {
          foundSlidable = true;
          break;
        }
      }
    }
    if (foundSlidable) {
      hints.push('slidable');
    }
  }

  return hints;
}

// Attributes we try as discriminators among matching siblings. Order matters:
// explicit test/identity attrs first, then user-facing labels, then generic
// data-*/aria-* and framework scoped attrs. Presence-based matching
// ([attr]) is preferred over value matching when the attribute is binary.
const SIBLING_DISCRIMINATOR_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-qa',
  'name',
  'aria-label',
  'aria-labelledby',
  'role',
  'type',
  'href',
  'data-hp-bound',
  'data-action',
  'data-role',
];

function getSiblingDiscriminator(el, parent, baseSegment) {
  if (!parent) {
    return null;
  }

  // Collect siblings that would match the baseSegment so we know which
  // attributes actually distinguish el from the collision set.
  let matchingSiblings;
  try {
    matchingSiblings = Array.from(parent.children).filter((child) => {
      try {
        return child !== el && child.matches(baseSegment);
      } catch (_error) {
        return false;
      }
    });
  } catch (_error) {
    return null;
  }

  if (matchingSiblings.length === 0) {
    return null;
  }

  for (const attr of SIBLING_DISCRIMINATOR_ATTRS) {
    if (!el.hasAttribute(attr)) {
      continue;
    }
    const myValue = el.getAttribute(attr) ?? '';

    // Presence-only discriminator: if no sibling has this attribute at all,
    // [attr] is stable regardless of value.
    const siblingHasAttr = matchingSiblings.some((s) => s.hasAttribute(attr));
    if (!siblingHasAttr) {
      return `[${attr}]`;
    }

    // Value discriminator: if our value is unique among siblings.
    const siblingHasSameValue = matchingSiblings.some(
      (s) => (s.getAttribute(attr) ?? '') === myValue,
    );
    if (!siblingHasSameValue && myValue.length > 0 && myValue.length <= 80) {
      return `[${attr}="${escapeCssValue(myValue)}"]`;
    }
  }

  // Fallback: a Vue-scoped data-v-* attribute whose presence differs from
  // siblings is often stable for the life of a component mount.
  for (const attr of Array.from(el.attributes)) {
    if (!/^data-v-[a-f0-9]+$/i.test(attr.name)) {
      continue;
    }
    const siblingHasAttr = matchingSiblings.some((s) =>
      s.hasAttribute(attr.name),
    );
    if (!siblingHasAttr) {
      return `[${attr.name}]`;
    }
  }

  return null;
}

function generateSelectorSegment(el) {
  const tag = el.tagName.toLowerCase();

  if (el.id) {
    return `${tag}#${escapeCssValue(el.id)}`;
  }

  const stableClasses = getClassTokens(el).slice(0, 2);
  const classSelector =
    stableClasses.length > 0
      ? `.${stableClasses.map((token) => escapeCssValue(token)).join('.')}`
      : '';

  let segment = `${tag}${classSelector}`;
  const parent = el.parentElement;

  if (!parent) {
    return segment;
  }

  try {
    if (document.querySelectorAll(segment).length === 1) {
      return segment;
    }
  } catch (_error) {
    segment = tag;
  }

  // Prefer a stable attribute-based discriminator over :nth-of-type, which
  // drifts when accessibility/automation layers insert sibling overlays
  // (e.g. button-hp-installed decoys) between detection and click.
  const discriminator = getSiblingDiscriminator(el, parent, segment);
  if (discriminator) {
    return `${segment}${discriminator}`;
  }

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === el.tagName,
  );

  if (sameTagSiblings.length > 1) {
    const index = sameTagSiblings.indexOf(el) + 1;
    segment = `${segment}:nth-of-type(${index})`;
  }

  return segment;
}

function generateSelector(el) {
  const attributePriority = [
    'name',
    'data-testid',
    'data-test-id',
    'aria-label',
  ];

  if (el.id) {
    return `#${escapeCssValue(el.id)}`;
  }

  for (const attributeName of attributePriority) {
    const value = el.getAttribute(attributeName);
    if (!value) {
      continue;
    }

    const selector = `[${attributeName}="${escapeCssValue(value)}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (_error) {
      // Ignore invalid selectors and continue to path building.
    }
  }

  const path = [];
  let current = el;

  while (current && current !== document.documentElement) {
    path.unshift(generateSelectorSegment(current));
    const selector = path.join(' > ');

    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (_error) {
      // Keep building a longer path if a partial selector is invalid.
    }

    current = current.parentElement;
  }

  return path.join(' > ');
}

function getCandidateSignal(type, signalSource, el = null) {
  if (type === 'clickable') {
    const baseSignalScore =
      HIGHLIGHT_SIGNAL_SCORE[signalSource] || HIGHLIGHT_SIGNAL_SCORE.pointer;
    if (
      signalSource === 'pointer' &&
      el instanceof HTMLElement &&
      isLikelyCountTextElement(el)
    ) {
      return baseSignalScore - 80;
    }

    return baseSignalScore;
  }

  return HIGHLIGHT_SIGNAL_SCORE[type] || 0;
}

function buildResolvedCandidate(el, type, signalSource) {
  const rect = getElementRect(el);

  return {
    element: el,
    type,
    signalSource,
    rect,
    area: getElementArea(rect),
    depth: getDomDepth(el),
    signalScore: getCandidateSignal(type, signalSource, el),
  };
}

function resolveElementCandidate(el, requestedType) {
  const clickableCandidate = resolveClickableCandidate(el);

  if (requestedType === 'clickable') {
    if (!clickableCandidate) {
      return null;
    }

    return {
      element: clickableCandidate.element,
      type: 'clickable',
      signalSource: clickableCandidate.signalSource,
      rect: clickableCandidate.rect,
      area: clickableCandidate.area,
      depth: clickableCandidate.depth,
      signalScore: clickableCandidate.signalScore,
    };
  }

  if (requestedType === 'inputable') {
    return isInputableCandidate(el)
      ? buildResolvedCandidate(el, 'inputable', 'inputable')
      : null;
  }

  if (requestedType === 'selectable') {
    return isSelectableCandidate(el)
      ? buildResolvedCandidate(el, 'selectable', 'selectable')
      : null;
  }

  if (requestedType === 'scrollable') {
    return isScrollableCandidate(el)
      ? buildResolvedCandidate(el, 'scrollable', 'scrollable')
      : null;
  }

  if (requestedType === 'hoverable') {
    return isHoverableCandidate(el)
      ? buildResolvedCandidate(el, 'hoverable', 'hoverable')
      : null;
  }

  if (requestedType === 'draggable') {
    return isDraggableCandidate(el)
      ? buildResolvedCandidate(el, 'draggable', 'draggable')
      : null;
  }

  if (requestedType === 'droppable') {
    return isDroppableCandidate(el)
      ? buildResolvedCandidate(el, 'droppable', 'droppable')
      : null;
  }

  if (requestedType === 'any') {
    const candidates = [];

    if (clickableCandidate) {
      candidates.push({
        element: clickableCandidate.element,
        type: 'clickable',
        signalSource: clickableCandidate.signalSource,
        rect: clickableCandidate.rect,
        area: clickableCandidate.area,
        depth: clickableCandidate.depth,
        signalScore: clickableCandidate.signalScore,
      });
    }

    if (isInputableCandidate(el)) {
      candidates.push(buildResolvedCandidate(el, 'inputable', 'inputable'));
    }

    if (isSelectableCandidate(el)) {
      candidates.push(buildResolvedCandidate(el, 'selectable', 'selectable'));
    }

    if (isScrollableCandidate(el)) {
      candidates.push(buildResolvedCandidate(el, 'scrollable', 'scrollable'));
    }

    if (isHoverableCandidate(el)) {
      candidates.push(buildResolvedCandidate(el, 'hoverable', 'hoverable'));
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort(compareCandidates);
    return candidates[0];
  }

  return null;
}

function compareCandidates(a, b) {
  const typeDelta =
    HIGHLIGHT_TYPE_PRIORITY[a.type] - HIGHLIGHT_TYPE_PRIORITY[b.type];
  if (typeDelta !== 0) {
    return typeDelta;
  }

  if (isPreferredControlWrapperOverCandidate(a, b)) {
    return -1;
  }

  if (isPreferredControlWrapperOverCandidate(b, a)) {
    return 1;
  }

  const aPureCountClickable = isPureCountClickableCandidate(a);
  const bPureCountClickable = isPureCountClickableCandidate(b);
  if (aPureCountClickable !== bPureCountClickable) {
    return aPureCountClickable ? 1 : -1;
  }

  if (a.signalScore !== b.signalScore) {
    return b.signalScore - a.signalScore;
  }

  if (a.area !== b.area) {
    return a.area - b.area;
  }

  if (a.depth !== b.depth) {
    return b.depth - a.depth;
  }

  if (a.rect.y !== b.rect.y) {
    return a.rect.y - b.rect.y;
  }

  return a.rect.x - b.rect.x;
}

function isPureCountClickableCandidate(candidate) {
  return (
    candidate.type === 'clickable' &&
    candidate.signalSource === 'pointer' &&
    isLikelyCountTextElement(candidate.element)
  );
}

function isControlWrapperCandidate(candidate) {
  return (
    candidate.type === 'clickable' &&
    hasControlIntentToken(candidate.element) &&
    (countVisibleSvgDescendants(candidate.element, 1) > 0 ||
      candidate.element.children.length > 0)
  );
}

function isPreferredControlWrapperOverCandidate(
  wrapperCandidate,
  nestedCandidate,
) {
  return (
    isControlWrapperCandidate(wrapperCandidate) &&
    isPureCountClickableCandidate(nestedCandidate) &&
    wrapperCandidate.element.contains(nestedCandidate.element)
  );
}

function isProminentScrollableCandidate(candidate) {
  if (candidate.type !== 'scrollable') {
    return false;
  }

  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea <= 0) {
    return false;
  }

  return (
    candidate.area >= viewportArea * 0.12 ||
    candidate.rect.height >= window.innerHeight * 0.35 ||
    candidate.rect.width >= window.innerWidth * 0.5
  );
}

function compareDisplayCandidates(a, b) {
  const aProminentScrollable = isProminentScrollableCandidate(a);
  const bProminentScrollable = isProminentScrollableCandidate(b);

  if (aProminentScrollable !== bProminentScrollable) {
    return aProminentScrollable ? -1 : 1;
  }

  if (a.type === 'scrollable' && a.element.contains(b.element)) {
    return -1;
  }

  if (b.type === 'scrollable' && b.element.contains(a.element)) {
    return 1;
  }

  return compareCandidates(a, b);
}

function getOverlapArea(a, b) {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );

  return xOverlap * yOverlap;
}

function shouldDropCandidate(candidate, kept) {
  if (candidate.element === kept.element) {
    return true;
  }

  const overlapArea = getOverlapArea(candidate.rect, kept.rect);
  if (overlapArea <= 0) {
    return false;
  }

  const smallerArea = Math.min(candidate.area, kept.area);
  const overlapRatio = smallerArea > 0 ? overlapArea / smallerArea : 0;

  // Preserve scrollable containers in "any" mode even when they overlap
  // with nested controls; otherwise modal/list scrollers disappear entirely.
  const preserveScrollableContainer =
    candidate.type === 'scrollable' && kept.type !== 'scrollable';

  if (
    isPureCountClickableCandidate(candidate) &&
    isPreferredControlWrapperOverCandidate(kept, candidate) &&
    overlapRatio >= 0.6
  ) {
    return true;
  }

  if (isPreferredControlWrapperOverCandidate(candidate, kept)) {
    return false;
  }

  if (
    !preserveScrollableContainer &&
    candidate.element.contains(kept.element) &&
    overlapRatio >= 0.6
  ) {
    return true;
  }

  if (
    candidate.type === kept.type &&
    overlapRatio >= 0.9 &&
    candidate.area >= kept.area
  ) {
    return true;
  }

  return false;
}

const MAX_OUTER_HTML = 2000;

function truncateOuterHTML(element) {
  if (!element.outerHTML) return undefined;
  const raw = element.outerHTML.trim();
  if (raw.length <= MAX_OUTER_HTML) return raw;
  return raw.substring(0, MAX_OUTER_HTML) + '<!-- truncated -->';
}

function toInteractiveElement(candidate) {
  const interactionHints = getInteractionHints(candidate.element);
  const displayType =
    candidate.type === 'clickable' &&
    !isSemanticControlElement(candidate.element) &&
    (interactionHints.includes('swipable') ||
      isScrollableCandidate(candidate.element))
      ? 'scrollable'
      : candidate.type;
  const text = getElementTextForDetection(candidate.element);

  return {
    id: '',
    type: displayType,
    ...(interactionHints.length > 0 ? { interactionHints } : {}),
    tagName: candidate.element.tagName.toLowerCase(),
    selector: generateSelector(candidate.element),
    html: truncateOuterHTML(candidate.element),
    text,
    searchText: getElementSearchText(candidate.element),
    fingerprint: getElementFingerprint(candidate.element),
    bbox: getElementRect(candidate.element),
    isVisible: true,
    isInViewport: true,
  };
}

function toInteractiveElementLite(candidate, stashIndex) {
  const interactionHints = getInteractionHints(candidate.element);
  const displayType =
    candidate.type === 'clickable' &&
    !isSemanticControlElement(candidate.element) &&
    (interactionHints.includes('swipable') ||
      isScrollableCandidate(candidate.element))
      ? 'scrollable'
      : candidate.type;
  const text = getElementTextForDetection(candidate.element);

  return {
    id: '',
    type: displayType,
    ...(interactionHints.length > 0 ? { interactionHints } : {}),
    tagName: candidate.element.tagName.toLowerCase(),
    selector: '',
    text,
    searchText: getElementSearchText(candidate.element),
    fingerprint: getElementFingerprint(candidate.element),
    bbox: getElementRect(candidate.element),
    isVisible: true,
    isInViewport: true,
    _stashIndex: stashIndex,
  };
}

function enrichStashedElement(stashedCandidate, idx) {
  const el = stashedCandidate.element;
  if (!el || !el.isConnected) {
    return { _stashIndex: idx, selector: '', html: undefined };
  }
  return {
    _stashIndex: idx,
    selector: generateSelector(el),
    html: truncateOuterHTML(el),
  };
}

window.__obStashedCandidates = null;
window.__obEnrichElements = function(indices, expectedDocumentId) {
  if (expectedDocumentId && window.__obDetectedDocumentId !== expectedDocumentId) {
    return [];
  }
  const stashed = window.__obStashedCandidates;
  if (!stashed) return [];
  return indices.map(function(idx) {
    const candidate = stashed[idx];
    if (!candidate) return { _stashIndex: idx, selector: '', html: undefined };
    return enrichStashedElement(candidate, idx);
  });
};

function countVisibleClickableCandidates(metricsStartTime) {
  const clickableCandidates = document.querySelectorAll(
    'button, a[href], summary, [role="button"], [role="link"], input',
  );

  let count = 0;
  for (const candidate of clickableCandidates) {
    if (count >= layoutStabilityConfig.maxClickableCandidates) {
      break;
    }

    if (isMetricsTimeBudgetExceeded(metricsStartTime)) {
      break;
    }

    if (!isElementVisibleForDetection(candidate)) {
      continue;
    }

    if (!isElementInViewportForDetection(candidate)) {
      continue;
    }

    count += 1;
  }

  return count;
}

const TEXT_METRIC_TAGS = new Set([
  'main',
  'article',
  'section',
  'aside',
  'nav',
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
]);

function collectViewportTextMetrics(metricsStartTime) {
  let textBlockCount = 0;
  let textCharCount = 0;
  let processedCount = 0;

  if (!document.body || typeof document.createTreeWalker !== 'function') {
    return {
      textBlockCount,
      textCharCount,
    };
  }

  const textWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (!(node instanceof HTMLElement)) {
          return NodeFilter.FILTER_SKIP;
        }

        const tagName = node.tagName.toLowerCase();
        if (
          !TEXT_METRIC_TAGS.has(tagName) &&
          node.getAttribute('role') !== 'main'
        ) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let candidate = textWalker.nextNode();
  while (candidate) {
    if (processedCount >= layoutStabilityConfig.maxTextCandidates) {
      break;
    }

    if (isMetricsTimeBudgetExceeded(metricsStartTime)) {
      break;
    }

    processedCount += 1;

    if (!isElementVisibleForDetection(candidate)) {
      candidate = textWalker.nextNode();
      continue;
    }

    if (!isElementInViewportForDetection(candidate)) {
      candidate = textWalker.nextNode();
      continue;
    }

    const text = normalizeWhitespace(candidate.textContent || '', 400);
    if (text.length >= 24) {
      textBlockCount += 1;
      textCharCount += text.length;
    }

    candidate = textWalker.nextNode();
  }

  return {
    textBlockCount,
    textCharCount,
  };
}

function isRectInViewport(rect) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

function isMetricsTimeBudgetExceeded(startTime) {
  return (
    performance.now() - startTime >= layoutStabilityConfig.metricsTimeBudgetMs
  );
}

function countPendingViewportImages(metricsStartTime) {
  let count = 0;

  for (const img of Array.from(document.images)) {
    if (count >= layoutStabilityConfig.maxPendingImages) {
      break;
    }

    if (isMetricsTimeBudgetExceeded(metricsStartTime)) {
      break;
    }

    const rect = img.getBoundingClientRect();
    if (isRectInViewport(rect) && !img.complete) {
      count += 1;
    }
  }

  return count;
}

function countViewportMedia(metricsStartTime) {
  const mediaElements = document.querySelectorAll('img, video, canvas');
  let total = 0;
  let complete = 0;

  for (const media of mediaElements) {
    if (total >= layoutStabilityConfig.maxViewportMedia) {
      break;
    }

    if (isMetricsTimeBudgetExceeded(metricsStartTime)) {
      break;
    }

    const rect = media.getBoundingClientRect();
    if (!isRectInViewport(rect)) {
      continue;
    }

    total += 1;

    if (
      media.tagName.toLowerCase() === 'img'
        ? media.complete
        : media.readyState >= 2 || media.tagName.toLowerCase() === 'canvas'
    ) {
      complete += 1;
    }
  }

  return { total, complete };
}

const PLACEHOLDER_SIGNAL_SELECTOR = [
  '[class*="skeleton" i]',
  '[class*="placeholder" i]',
  '[class*="shimmer" i]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
  '[id*="skeleton" i]',
  '[id*="placeholder" i]',
  '[id*="shimmer" i]',
  '[id*="loading" i]',
  '[id*="spinner" i]',
  '[aria-busy="true"]',
  '[role="progressbar"]',
].join(', ');

function countViewportPlaceholderSignals(metricsStartTime) {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  let skeletonLikeCount = 0;
  let spinnerLikeCount = 0;
  let placeholderArea = 0;
  let processedCount = 0;

  const candidates = document.querySelectorAll(PLACEHOLDER_SIGNAL_SELECTOR);
  for (const element of candidates) {
    if (processedCount >= layoutStabilityConfig.maxPlaceholderCandidates) {
      break;
    }
    if (isMetricsTimeBudgetExceeded(metricsStartTime)) {
      break;
    }

    processedCount += 1;
    if (!isElementVisibleForDetection(element)) {
      continue;
    }

    if (!isElementInViewportForDetection(element)) {
      continue;
    }

    if (!isElementVisibleInScrollParent(element)) {
      continue;
    }

    const rect = cachedRect(element);
    const clampedWidth = Math.min(window.innerWidth, Math.max(0, rect.width));
    const clampedHeight = Math.min(
      window.innerHeight,
      Math.max(0, rect.height),
    );
    const candidateArea = clampedWidth * clampedHeight;
    const tokenText = normalizeWhitespace(
      [
        element.id || '',
        element.className || '',
        element.getAttribute('role') || '',
        element.getAttribute('aria-label') || '',
        element.getAttribute('aria-busy') || '',
      ].join(' '),
      200,
    ).toLowerCase();

    if (
      tokenText.includes('spinner') ||
      element.getAttribute('role') === 'progressbar'
    ) {
      spinnerLikeCount += 1;
    } else {
      skeletonLikeCount += 1;
    }

    placeholderArea += candidateArea;
  }

  return {
    skeletonLikeCount,
    spinnerLikeCount,
    placeholderAreaRatio: Math.min(1, placeholderArea / viewportArea),
  };
}

function getPageMetrics() {
  const metricsStartTime = performance.now();
  const viewportText = collectViewportTextMetrics(metricsStartTime);
  const viewportMedia = countViewportMedia(metricsStartTime);
  const placeholderSignals = countViewportPlaceholderSignals(metricsStartTime);

  return {
    bodyHeight: document.body
      ? document.body.getBoundingClientRect().height
      : 0,
    scrollHeight: document.documentElement
      ? document.documentElement.scrollHeight
      : 0,
    pendingImages: countPendingViewportImages(metricsStartTime),
    viewportMediaCount: viewportMedia.total,
    completeViewportMediaCount: viewportMedia.complete,
    textBlockCount: viewportText.textBlockCount,
    textCharCount: viewportText.textCharCount,
    visibleClickableCount: countVisibleClickableCandidates(metricsStartTime),
    skeletonLikeCount: placeholderSignals.skeletonLikeCount,
    spinnerLikeCount: placeholderSignals.spinnerLikeCount,
    placeholderAreaRatio: placeholderSignals.placeholderAreaRatio,
  };
}

function evaluateReadinessSnapshot(trace) {
  const metrics = getPageMetrics();
  const readiness = evaluateLayoutReadiness(metrics, {
    pageReady: document.readyState === 'complete',
    visibilityState: document.visibilityState,
  });

  trace(
    'readiness:snapshot',
    `state=${readiness.state} contentScore=${readiness.contentScore} reasons=${readiness.reasons.join('|') || 'none'}`,
  );

  return readiness;
}

// T2-A: Build the union of elements to scan without touching every DOM node.
// Uses a targeted seed selector for semantic/ARIA/attribute interactives,
// then a bounded pointer-cursor fallback pass over common container tags
// (filtered by viewport + cursor style via the style/rect caches), plus the
// pre-computed scroll containers from findScrollContainers(). Typical
// reduction vs querySelectorAll('*') is 60-90% on heavy DOM pages.
function getFullScanCandidates() {
  const seen = new Set();
  const results = [];

  const add = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    results.push(el);
  };

  // Pass 1: semantic interactives, ARIA roles, attribute click/hover handlers.
  for (const el of document.querySelectorAll(INTERACTIVE_SEED_SELECTOR)) {
    add(el);
  }

  // Pass 2: cursor:pointer / grab / move fallback on common container tags.
  // The viewport check cheaply skips off-screen elements; the style lookup
  // is cached so repeated tests share the same getComputedStyle result.
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  for (const el of document.querySelectorAll(POINTER_CURSOR_FALLBACK_SELECTOR)) {
    if (seen.has(el)) continue;
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
    const rect = cachedRect(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      rect.top >= viewportH ||
      rect.bottom <= 0 ||
      rect.left >= viewportW ||
      rect.right <= 0
    ) {
      continue;
    }
    const cursor = cachedStyle(el).cursor;
    if (cursor === 'pointer' || cursor === 'grab' || cursor === 'move') {
      add(el);
    }
  }

  // Pass 3: pre-computed scroll/clip containers (for scrollable candidates).
  for (const container of _scrollContainers) {
    add(container.el);
  }

  return results;
}

function getCandidateElementsForScan(layoutStability, trace, config) {
  const useFullScan =
    layoutStability.state !== 'not_ready' ||
    config.fullPageScanOnNotReady === true;

  if (useFullScan) {
    const allElements = getFullScanCandidates();
    trace(
      'querySelectorAll',
      layoutStability.state === 'not_ready'
        ? `count=${allElements.length} state=not_ready override=full_scan targeted=true`
        : `count=${allElements.length} targeted=true`,
    );
    return allElements;
  }

  // T0-E: Start at body to avoid wasting scan budget on <head> elements.
  const root = document.body || document.documentElement;
  if (!root || typeof document.createTreeWalker !== 'function') {
    const fallbackElements = Array.from(document.querySelectorAll('*')).slice(
      0,
      NOT_READY_SCAN_LIMIT,
    );
    trace(
      'querySelectorAll',
      `count=${fallbackElements.length} capped=${NOT_READY_SCAN_LIMIT} state=not_ready fallback=true`,
    );
    if (fallbackElements.length >= NOT_READY_SCAN_LIMIT) {
      trace('scan:capped', `state=not_ready limit=${NOT_READY_SCAN_LIMIT}`);
    }
    return fallbackElements;
  }

  const cappedElements = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.currentNode;

  while (current && cappedElements.length < NOT_READY_SCAN_LIMIT) {
    if (current instanceof Element) {
      cappedElements.push(current);
    }
    current = walker.nextNode();
  }

  trace(
    'querySelectorAll',
    `count=${cappedElements.length} capped=${NOT_READY_SCAN_LIMIT} state=not_ready`,
  );
  if (cappedElements.length >= NOT_READY_SCAN_LIMIT) {
    trace('scan:capped', `state=not_ready limit=${NOT_READY_SCAN_LIMIT}`);
  }

  return cappedElements;
}

function collectHighlightCandidates(config, trace, layoutStability) {
  const activeTopLayerRoot = getActiveTopLayerRoot();
  const registry = new Map();

  // T2-D: Scroll/clip containers were already pre-computed at the start of
  // runOpenBrowserHighlightDetection (before readiness eval so that
  // isElementVisibleInScrollParent gives correct answers for placeholder
  // signals). Keep the assertion here for readability; findScrollContainers
  // is idempotent but we avoid re-running it.
  if (!_scrollContainers || _scrollContainers.length === 0) {
    // Defensive: ensure populated in case a caller bypassed the outer flow.
    _scrollContainers = findScrollContainers();
  }
  trace('scroll:containers', `count=${_scrollContainers.length}`);

  const allElements = getCandidateElementsForScan(
    layoutStability,
    trace,
    config,
  );

  let scannedCount = 0;
  for (const element of allElements) {
    scannedCount += 1;

    if (scannedCount % 1000 === 0) {
      trace(
        'scan:progress',
        `processed=${scannedCount} matched=${registry.size}`,
      );
    }

    if (!isElementVisibleForDetection(element)) {
      continue;
    }

    if (!isElementInViewportForDetection(element)) {
      continue;
    }

    if (!isElementVisibleInScrollParent(element)) {
      continue;
    }

    if (!isElementInActiveTopLayer(element, activeTopLayerRoot)) {
      continue;
    }

    // T2-B: Resolve the candidate BEFORE the 5-point hit-test. Most elements
    // that pass the cheap visibility checks still fail type resolution; hit
    // testing them costs 5x elementsFromPoint() calls for nothing.
    const resolvedCandidate = resolveElementCandidate(
      element,
      config.elementType,
    );
    if (!resolvedCandidate) {
      continue;
    }

    const hitTestVisibility = getElementHitTestVisibility(element);
    if (!hitTestVisibility.visible) {
      continue;
    }

    const candidate = {
      element: resolvedCandidate.element,
      type: resolvedCandidate.type,
      signalSource: resolvedCandidate.signalSource,
      signalScore: resolvedCandidate.signalScore,
      rect: resolvedCandidate.rect,
      area: resolvedCandidate.area,
      depth: resolvedCandidate.depth,
    };

    const existing = registry.get(resolvedCandidate.element);
    if (!existing || compareCandidates(candidate, existing) < 0) {
      registry.set(resolvedCandidate.element, candidate);
    }
  }

  const sortedCandidates = Array.from(registry.values()).sort(
    compareDisplayCandidates,
  );
  const prunedCandidates = [];

  for (const candidate of sortedCandidates) {
    const shouldDrop = prunedCandidates.some((keptCandidate) =>
      shouldDropCandidate(candidate, keptCandidate),
    );

    if (!shouldDrop) {
      prunedCandidates.push(candidate);
    }
  }

  const counts = {
    clickable: 0,
    scrollable: 0,
    inputable: 0,
    hoverable: 0,
    selectable: 0,
    draggable: 0,
    droppable: 0,
  };

  // T1-A: Stash candidate elements for deferred enrichment and use lite conversion
  window.__obStashedCandidates = prunedCandidates;

  const elements = prunedCandidates.map((candidate, index) => {
    const element = toInteractiveElementLite(candidate, index);
    counts[element.type] += 1;
    return element;
  });

  trace(
    'scan:done',
    `processed=${scannedCount} matched=${elements.length} counts=${JSON.stringify(counts)}`,
  );

  return {
    elements,
    counts,
  };
}

async function runOpenBrowserHighlightDetection(config) {
  const trace = createHighlightTrace();
  trace(
    'start',
    `elementType=${config.elementType} fullPageScanOnNotReady=${config.fullPageScanOnNotReady === true}`,
  );

  // T2-C: Reset per-scan style/rect caches so stale rects from prior scans
  // can't leak in.
  resetDetectionCaches();

  // T2-D: Populate scroll/clip containers BEFORE readiness evaluation.
  // evaluateReadinessSnapshot calls countViewportPlaceholderSignals, which
  // uses isElementVisibleInScrollParent — with an empty _scrollContainers
  // list that check would trivially return true and placeholder counts
  // could flip readiness state incorrectly.
  _scrollContainers = findScrollContainers();

  const layoutStability = evaluateReadinessSnapshot(trace);

  const { elements, counts } = collectHighlightCandidates(
    config,
    trace,
    layoutStability,
  );

  // T1-A: Store documentId for enrichment stale-detection guard
  const docId = getCurrentDocumentId();
  window.__obDetectedDocumentId = docId;

  trace('return', `elements=${elements.length}`);
  return {
    elements,
    counts,
    layoutStability,
    documentId: docId,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}
