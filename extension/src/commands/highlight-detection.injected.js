const HIGHLIGHT_TYPE_PRIORITY = {
  clickable: 0,
  inputable: 1,
  selectable: 2,
  scrollable: 3,
  hoverable: 4,
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
  /\b(action|back|btn|button|clear|close|comment|filter|follow|like|menu|more|next|pause|play|prev|previous|refresh|reload|reply|search|share|submit|tab|toggle)\b/i;

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

function isElementVisibleForDetection(el) {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
    return false;
  }

  const style = window.getComputedStyle(el);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isElementInViewportForDetection(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
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
        token.length > 1 &&
        token.length <= 40 &&
        /^[a-z0-9_-]+$/i.test(token),
    )
    .slice(0, 8);
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
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
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
  return window.getComputedStyle(el).cursor === 'pointer';
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

  if (/\b(button|btn|filter|follow|like|refresh|reload|reply|search|share|submit|toggle)\b/i.test(searchText)) {
    score += 12;
  }

  if (/\b(icon|svg)\b/i.test(searchText)) {
    score -= 10;
  }

  const rect = el.getBoundingClientRect();
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

function isMeaningfulPointerCandidate(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }

  if (!hasPointerCursor(el) || isDisabledForDetection(el)) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = getElementArea(rect);

  if (elementArea <= 0 || elementArea > viewportArea * 0.35) {
    return false;
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

  if (hasExplicitClickableAncestor(el) || hasStructuredInteractiveDescendant(el)) {
    return null;
  }

  const rect = el.getBoundingClientRect();
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

  return el.getAttribute('contenteditable') === 'true';
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

  const parentRect = parent.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
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
        signalScore: getCandidateSignal('clickable', signalSource),
        quality:
          getCandidateSignal('clickable', signalSource) +
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

function isScrollableCandidate(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'html') {
    return false;
  }

  const style = window.getComputedStyle(el);
  const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
  const hasScrollStyle =
    overflow.includes('auto') || overflow.includes('scroll');
  const hasHiddenOverflow = style.overflow === 'hidden';
  const canScroll =
    el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;

  if (!canScroll) {
    return false;
  }

  return hasScrollStyle || hasHiddenOverflow;
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

  if (hasExplicitClickableAncestor(el) || hasStructuredInteractiveDescendant(el)) {
    return false;
  }

  return true;
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

function getCandidateSignal(type, signalSource) {
  if (type === 'clickable') {
    return HIGHLIGHT_SIGNAL_SCORE[signalSource] || HIGHLIGHT_SIGNAL_SCORE.pointer;
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
    signalScore: getCandidateSignal(type, signalSource),
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

function toInteractiveElement(candidate) {
  const text = getElementTextForDetection(candidate.element);

  return {
    id: '',
    type: candidate.type,
    tagName: candidate.element.tagName.toLowerCase(),
    selector: generateSelector(candidate.element),
    html: candidate.element.outerHTML
      ? candidate.element.outerHTML.trim()
      : undefined,
    text,
    searchText: getElementSearchText(candidate.element),
    bbox: getElementRect(candidate.element),
    isVisible: true,
    isInViewport: true,
  };
}

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
  return performance.now() - startTime >= layoutStabilityConfig.metricsTimeBudgetMs;
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

    const rect = element.getBoundingClientRect();
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
  const placeholderSignals =
    countViewportPlaceholderSignals(metricsStartTime);

  return {
    bodyHeight: document.body ? document.body.getBoundingClientRect().height : 0,
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

function collectHighlightCandidates(requestedType, trace) {
  const activeTopLayerRoot = getActiveTopLayerRoot();
  const registry = new Map();
  const allElements = Array.from(document.querySelectorAll('*'));

  trace('querySelectorAll', `count=${allElements.length}`);

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

    if (!isElementInActiveTopLayer(element, activeTopLayerRoot)) {
      continue;
    }

    const hitTestVisibility = getElementHitTestVisibility(element);
    if (!hitTestVisibility.visible) {
      continue;
    }

    const resolvedCandidate = resolveElementCandidate(element, requestedType);
    if (!resolvedCandidate) {
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
  };

  const elements = prunedCandidates.map((candidate) => {
    counts[candidate.type] += 1;
    return toInteractiveElement(candidate);
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
  trace('start', `elementType=${config.elementType}`);

  const layoutStability = evaluateReadinessSnapshot(trace);

  const { elements, counts } = collectHighlightCandidates(
    config.elementType,
    trace,
  );

  trace('return', `elements=${elements.length}`);
  return {
    elements,
    counts,
    layoutStability,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}
