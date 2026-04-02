import { describe, expect, test } from 'bun:test';

import {
  buildHighlightDetectionScript,
  filterHighlightElementsByKeywords,
  getHighlightKeywordHaystack,
  normalizeHighlightKeywords,
} from '../commands/highlight-detection';
import type { InteractiveElement } from '../types';

function createElement(
  overrides: Partial<InteractiveElement> = {},
): InteractiveElement {
  return {
    id: 'abc123',
    type: 'clickable',
    tagName: 'span',
    selector: 'span.like-wrapper',
    html: '<span class="like-wrapper"><svg class="like-icon"></svg><span>1</span></span>',
    text: '1',
    searchText: 'span like-wrapper like-active 1',
    bbox: { x: 0, y: 0, width: 16, height: 16 },
    isVisible: true,
    isInViewport: true,
    ...overrides,
  };
}

describe('highlight-detection helpers', () => {
  test('normalizeHighlightKeywords trims, lowercases, removes whitespace, and deduplicates', () => {
    expect(
      normalizeHighlightKeywords([
        ' Like ',
        'like',
        ' REPLY ',
        " John's   reply ",
      ]),
    ).toEqual(['like', 'reply', "john'sreply"]);
  });

  test('keyword haystack prefers normalized searchText over raw html', () => {
    const haystack = getHighlightKeywordHaystack(
      createElement({
        searchText: 'comment actions',
        html: '<div class="like-wrapper">like</div>',
      }),
    );

    expect(haystack).toBe('commentactions');
  });

  test('filterHighlightElementsByKeywords matches semantic control tokens', () => {
    const result = filterHighlightElementsByKeywords(
      [
        createElement({
          selector: 'span.like-wrapper',
          searchText: 'span like-wrapper like-active 1',
        }),
        createElement({
          id: 'def456',
          selector: 'div.comment-panel',
          searchText: 'div comment-panel comments',
          html: '<div class="comment-panel"><span class="like-wrapper">1</span></div>',
        }),
      ],
      ['like'],
    );

    expect(result.keywords).toEqual(['like']);
    expect(result.elements.map((element) => element.selector)).toEqual([
      'span.like-wrapper',
    ]);
  });

  test('filterHighlightElementsByKeywords ignores whitespace differences', () => {
    const result = filterHighlightElementsByKeywords(
      [
        createElement({
          id: 'reply123',
          selector: 'button.reply-target',
          text: "John's reply",
          searchText: "john ' s    reply",
          html: "<button>John <span>'s</span> reply</button>",
        }),
        createElement({
          id: 'reply456',
          selector: 'button.other-reply',
          text: "Jane's reply",
          searchText: "jane's reply",
          html: '<button>Jane&apos;s reply</button>',
        }),
      ],
      ["John's reply"],
    );

    expect(result.keywords).toEqual(["john'sreply"]);
    expect(result.elements.map((element) => element.id)).toEqual(['reply123']);
  });

  test('buildHighlightDetectionScript wires injected source with config', () => {
    const script = buildHighlightDetectionScript({ elementType: 'clickable' });

    expect(script).toContain('runOpenBrowserHighlightDetection');
    expect(script).toContain('"elementType":"clickable"');
    expect(script).toContain('getElementHitTestVisibility');
    expect(script).toContain('layoutStabilityConfig');
    expect(script).toContain('getStructuralClickableSignal');
    expect(script).toContain('structuralText');
    expect(script).toContain('CONTROL_TOKEN_REGEX');
    expect(script).toContain('resolveClickableCandidate');
    expect(script).toContain('resolveElementCandidate');
    expect(script).toContain('isTightClickableWrapper');
    expect(script).toContain('countDirectClickableChildren');
    expect(script).toContain('getBaseClickableSignal');
    expect(script).toContain('evaluateReadinessSnapshot');
    expect(script).toContain('evaluateLayoutReadiness');
  });

  test('buildHighlightDetectionScript can force full scans on not-ready pages', () => {
    const script = buildHighlightDetectionScript({
      elementType: 'any',
      fullPageScanOnNotReady: true,
    });

    expect(script).toContain('"fullPageScanOnNotReady":true');
    expect(script).toContain('config.fullPageScanOnNotReady === true');
    expect(script).toContain('override=full_scan');
  });

  test('buildHighlightDetectionScript uses readiness snapshot instead of wait loop', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });

    expect(script).toContain('function evaluateReadinessSnapshot');
    expect(script).toContain('function getCandidateElementsForScan');
    expect(script).toContain("layoutStability.state !== 'not_ready'");
    expect(script).toContain('config.fullPageScanOnNotReady === true');
    expect(script).toContain('const NOT_READY_SCAN_LIMIT = 500;');
    expect(script).toContain("trace('scan:capped'");
    expect(script).toContain('readiness:snapshot');
    expect(script).not.toContain('function waitForLayoutStability');
  });

  test('buildHighlightDetectionScript captures placeholder and skeleton signals', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });

    expect(script).toContain('PLACEHOLDER_SIGNAL_SELECTOR');
    expect(script).toContain('countViewportPlaceholderSignals');
    expect(script).toContain('placeholderAreaRatio');
    expect(script).toContain('skeletonLikeCount');
    expect(script).toContain('spinnerLikeCount');
  });

  test('buildHighlightDetectionScript uses isContentEditable for inputable detection', () => {
    const script = buildHighlightDetectionScript({ elementType: 'inputable' });

    expect(script).toContain('return el.isContentEditable;');
    expect(script).not.toContain(
      "return el.getAttribute('contenteditable') === 'true';",
    );
  });

  test('buildHighlightDetectionScript excludes visually hidden screen-reader nodes', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function isElementVisibleForDetection');
    const end = script.indexOf('function isElementInViewportForDetection', start);
    const visibilitySource = script.slice(start, end);

    expect(script).toContain('const VISUALLY_HIDDEN_TOKEN_REGEX');
    expect(script).toContain('sr-only');
    expect(script).toContain('screen-reader');
    expect(script).toContain('visually-hidden');
    expect(script).toContain('function isVisuallyHiddenForDetection');
    expect(visibilitySource).toContain('isVisuallyHiddenForDetection(el)');
  });

  test('buildHighlightDetectionScript excludes truncation-only scrollable false positives', () => {
    const script = buildHighlightDetectionScript({ elementType: 'scrollable' });
    const truncationStart = script.indexOf(
      'function isLikelyTextTruncationContainer',
    );
    const truncationEnd = script.indexOf(
      'function isScrollableCandidate',
      truncationStart,
    );
    const truncationSource = script.slice(truncationStart, truncationEnd);
    const scrollableStart = script.indexOf('function isScrollableCandidate');
    const scrollableEnd = script.indexOf(
      'function isHoverableCandidate',
      scrollableStart,
    );
    const scrollableSource = script.slice(scrollableStart, scrollableEnd);

    expect(truncationSource).toContain("style.textOverflow === 'ellipsis'");
    expect(truncationSource).toContain("style.whiteSpace === 'nowrap'");
    expect(truncationSource).toContain('countVisibleElementChildren(el, 2)');
    expect(scrollableSource).toContain('isLikelyTextTruncationContainer(el)');
    expect(scrollableSource).toContain('isSemanticControlElement(el)');
    expect(scrollableSource).toContain(
      "overflowX.includes('hidden') || overflowX.includes('clip')",
    );
    expect(scrollableSource).toContain('hasHorizontalSwipeLayout(el)');
  });

  test("buildHighlightDetectionScript keeps 'any' candidate selection across all element types", () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function resolveElementCandidate');
    const end = script.indexOf('function compareCandidates', start);
    const resolveElementCandidateSource = script.slice(start, end);

    expect(resolveElementCandidateSource).toContain(
      "if (requestedType === 'any')",
    );
    expect(resolveElementCandidateSource).toContain(
      "candidates.push(buildResolvedCandidate(el, 'scrollable', 'scrollable'));",
    );
    expect(resolveElementCandidateSource).toContain(
      "candidates.push(buildResolvedCandidate(el, 'hoverable', 'hoverable'));",
    );
    expect(resolveElementCandidateSource).toContain(
      'candidates.sort(compareCandidates);',
    );
    expect(resolveElementCandidateSource).toContain('return candidates[0];');
  });

  test("buildHighlightDetectionScript preserves scrollable containers in 'any' mode", () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function shouldDropCandidate');
    const end = script.indexOf('function toInteractiveElement', start);
    const shouldDropCandidateSource = script.slice(start, end);

    expect(shouldDropCandidateSource).toContain(
      "candidate.type === 'scrollable' && kept.type !== 'scrollable'",
    );
    expect(shouldDropCandidateSource).toContain(
      '!preserveScrollableContainer &&',
    );
    expect(shouldDropCandidateSource).toContain(
      'candidate.element.contains(kept.element)',
    );
  });

  test('buildHighlightDetectionScript prioritizes prominent scrollable containers for display', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function isProminentScrollableCandidate');
    const end = script.indexOf('function getOverlapArea', start);
    const displayOrderingSource = script.slice(start, end);

    expect(displayOrderingSource).toContain("candidate.type !== 'scrollable'");
    expect(displayOrderingSource).toContain(
      'candidate.area >= viewportArea * 0.12',
    );
    expect(displayOrderingSource).toContain(
      'candidate.rect.height >= window.innerHeight * 0.35',
    );
    expect(displayOrderingSource).toContain(
      'candidate.rect.width >= window.innerWidth * 0.5',
    );
    expect(displayOrderingSource).toContain(
      'function compareDisplayCandidates',
    );
    expect(displayOrderingSource).toContain(
      "a.type === 'scrollable' && a.element.contains(b.element)",
    );
  });

  test('buildHighlightDetectionScript exposes swipable interaction hints', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('const SWIPE_LIBRARY_REGEX');
    const end = script.indexOf('function generateSelectorSegment', start);
    const swipeHintSource = script.slice(start, end);

    expect(swipeHintSource).toContain('const SWIPE_LIBRARY_REGEX');
    expect(swipeHintSource).toContain("hints.push('swipable');");
    expect(swipeHintSource).toContain('function findSwipeContext');
    expect(swipeHintSource).toContain('function findSwipeDescendant');
    expect(swipeHintSource).toContain('function hasSwipeApi');
    expect(swipeHintSource).toContain('function hasHorizontalSwipeLayout');
    expect(script).toContain('interactionHints');
  });

  test('buildHighlightDetectionScript keeps semantic controls clickable in swipe regions', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function toInteractiveElement');
    const end = script.indexOf(
      'function countVisibleClickableCandidates',
      start,
    );
    const toInteractiveElementSource = script.slice(start, end);

    expect(script).toContain('function isSemanticControlElement');
    expect(toInteractiveElementSource).toContain(
      "candidate.type === 'clickable'",
    );
    expect(toInteractiveElementSource).toContain(
      '!isSemanticControlElement(candidate.element)',
    );
    expect(toInteractiveElementSource).toContain(
      "interactionHints.includes('swipable')",
    );
    expect(toInteractiveElementSource).toContain(
      'isScrollableCandidate(candidate.element)',
    );
    expect(toInteractiveElementSource).toContain("? 'scrollable'");
  });

  test('buildHighlightDetectionScript uses bounded tree walking for text metrics', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });

    expect(script).toContain('const TEXT_METRIC_TAGS = new Set([');
    expect(script).toContain('document.createTreeWalker');
    expect(script).toContain('layoutStabilityConfig.maxTextCandidates');
    expect(script).toContain('isMetricsTimeBudgetExceeded(metricsStartTime)');
  });

  test('buildHighlightDetectionScript treats collect wrappers as control roots', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const controlTokenStart = script.indexOf('const CONTROL_TOKEN_REGEX');
    const controlTokenEnd = script.indexOf(
      'const SWIPE_LIBRARY_REGEX',
      controlTokenStart,
    );
    const controlTokenSource = script.slice(controlTokenStart, controlTokenEnd);
    const affinityStart = script.indexOf('function getControlAffinityScore');
    const affinityEnd = script.indexOf(
      'function getSemanticClickableSignal',
      affinityStart,
    );
    const affinitySource = script.slice(affinityStart, affinityEnd);

    expect(controlTokenSource).toContain('collect');
    expect(controlTokenSource).toContain('bookmark');
    expect(controlTokenSource).toContain('favorite');
    expect(controlTokenSource).toContain('save');
    expect(controlTokenSource).toContain('star');
    expect(affinitySource).toContain('collect');
    expect(affinitySource).toContain('bookmark');
    expect(affinitySource).toContain('favorite');
    expect(affinitySource).toContain('save');
    expect(affinitySource).toContain('star');
  });

  test('buildHighlightDetectionScript de-prioritizes pointer-only count labels', () => {
    const script = buildHighlightDetectionScript({ elementType: 'clickable' });
    const candidateSignalStart = script.indexOf('function getCandidateSignal');
    const candidateSignalEnd = script.indexOf(
      'function buildResolvedCandidate',
      candidateSignalStart,
    );
    const candidateSignalSource = script.slice(
      candidateSignalStart,
      candidateSignalEnd,
    );

    expect(candidateSignalSource).toContain('isLikelyCountTextElement');
    expect(candidateSignalSource).toContain("signalSource === 'pointer'");
    expect(candidateSignalSource).toContain('return baseSignalScore - 80;');
  });

  test('buildHighlightDetectionScript prefers control wrappers over nested count spans', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const compareStart = script.indexOf('function compareCandidates');
    const compareEnd = script.indexOf(
      'function isProminentScrollableCandidate',
      compareStart,
    );
    const compareSource = script.slice(compareStart, compareEnd);
    const shouldDropStart = script.indexOf('function shouldDropCandidate');
    const shouldDropEnd = script.indexOf(
      'function toInteractiveElement',
      shouldDropStart,
    );
    const shouldDropSource = script.slice(shouldDropStart, shouldDropEnd);

    expect(compareSource).toContain('isPreferredControlWrapperOverCandidate');
    expect(compareSource).toContain('isPureCountClickableCandidate');
    expect(shouldDropSource).toContain(
      'isPureCountClickableCandidate(candidate)',
    );
    expect(shouldDropSource).toContain(
      'isPreferredControlWrapperOverCandidate(kept, candidate)',
    );
  });
});
