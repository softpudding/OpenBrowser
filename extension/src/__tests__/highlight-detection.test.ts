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
  test('normalizeHighlightKeywords trims, lowercases, and deduplicates', () => {
    expect(normalizeHighlightKeywords([' Like ', 'like', ' REPLY '])).toEqual([
      'like',
      'reply',
    ]);
  });

  test('keyword haystack prefers searchText over raw html', () => {
    const haystack = getHighlightKeywordHaystack(
      createElement({
        searchText: 'comment actions',
        html: '<div class="like-wrapper">like</div>',
      }),
    );

    expect(haystack).toBe('comment actions');
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

  test('buildHighlightDetectionScript uses readiness snapshot instead of wait loop', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });

    expect(script).toContain('function evaluateReadinessSnapshot');
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

  test("buildHighlightDetectionScript keeps 'any' candidate selection across all element types", () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function resolveElementCandidate');
    const end = script.indexOf('function compareCandidates', start);
    const resolveElementCandidateSource = script.slice(start, end);

    expect(resolveElementCandidateSource).toContain("if (requestedType === 'any')");
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

  test("buildHighlightDetectionScript prioritizes prominent scrollable containers for display", () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });
    const start = script.indexOf('function isProminentScrollableCandidate');
    const end = script.indexOf('function getOverlapArea', start);
    const displayOrderingSource = script.slice(start, end);

    expect(displayOrderingSource).toContain(
      "candidate.type !== 'scrollable'",
    );
    expect(displayOrderingSource).toContain('candidate.area >= viewportArea * 0.12');
    expect(displayOrderingSource).toContain(
      'candidate.rect.height >= window.innerHeight * 0.35',
    );
    expect(displayOrderingSource).toContain(
      'candidate.rect.width >= window.innerWidth * 0.5',
    );
    expect(displayOrderingSource).toContain('function compareDisplayCandidates');
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

  test('buildHighlightDetectionScript uses bounded tree walking for text metrics', () => {
    const script = buildHighlightDetectionScript({ elementType: 'any' });

    expect(script).toContain('const TEXT_METRIC_TAGS = new Set([');
    expect(script).toContain('document.createTreeWalker');
    expect(script).toContain('layoutStabilityConfig.maxTextCandidates');
    expect(script).toContain('isMetricsTimeBudgetExceeded(metricsStartTime)');
  });
});
