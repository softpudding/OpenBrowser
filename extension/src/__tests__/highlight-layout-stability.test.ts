import { describe, expect, test } from 'bun:test';

import {
  HIGHLIGHT_LAYOUT_STABILITY_CONFIG,
  didLayoutStabilityMetricsChange,
  evaluateLayoutReadiness,
  getHighlightReadinessRetryDelay,
  getLayoutContentScore,
  hasMeaningfulViewportContent,
  type LayoutStabilityMetrics,
} from '../utils/layout-stability';

function createMetrics(
  overrides: Partial<LayoutStabilityMetrics> = {},
): LayoutStabilityMetrics {
  return {
    bodyHeight: 720,
    scrollHeight: 1280,
    pendingImages: 0,
    viewportMediaCount: 0,
    completeViewportMediaCount: 0,
    textBlockCount: 0,
    textCharCount: 0,
    visibleClickableCount: 0,
    skeletonLikeCount: 0,
    spinnerLikeCount: 0,
    placeholderAreaRatio: 0,
    ...overrides,
  };
}

describe('Highlight Layout Stability', () => {
  test('treats shell-like viewport content as not meaningful yet', () => {
    const shellMetrics = createMetrics({
      textBlockCount: 3,
      textCharCount: 42,
      visibleClickableCount: 8,
    });

    expect(getLayoutContentScore(shellMetrics)).toBe(0);
    expect(hasMeaningfulViewportContent(shellMetrics)).toBe(false);
  });

  test('treats loaded feed-like viewport content as meaningful', () => {
    const loadedFeedMetrics = createMetrics({
      viewportMediaCount: 4,
      completeViewportMediaCount: 4,
      textBlockCount: 9,
      textCharCount: 240,
      visibleClickableCount: 10,
    });

    expect(getLayoutContentScore(loadedFeedMetrics)).toBeGreaterThanOrEqual(2);
    expect(hasMeaningfulViewportContent(loadedFeedMetrics)).toBe(true);
  });

  test('treats text and interaction mix as meaningful even without media', () => {
    const mixedMetrics = createMetrics({
      textBlockCount: 5,
      textCharCount: 110,
      visibleClickableCount: 7,
    });

    expect(getLayoutContentScore(mixedMetrics)).toBeGreaterThanOrEqual(2);
    expect(hasMeaningfulViewportContent(mixedMetrics)).toBe(true);
  });

  test('detects changes in viewport-content metrics, not only document height', () => {
    const before = createMetrics({
      textBlockCount: 2,
      textCharCount: 30,
      visibleClickableCount: 8,
    });
    const after = createMetrics({
      textBlockCount: 6,
      textCharCount: 160,
      visibleClickableCount: 11,
    });

    expect(didLayoutStabilityMetricsChange(before, after)).toBe(true);
  });

  test('does not report changes when metrics are identical', () => {
    const metrics = createMetrics({
      viewportMediaCount: 2,
      completeViewportMediaCount: 2,
      textBlockCount: 7,
      textCharCount: 150,
      visibleClickableCount: 9,
    });

    expect(didLayoutStabilityMetricsChange(metrics, { ...metrics })).toBe(
      false,
    );
  });

  test('marks a well-loaded feed as ready', () => {
    const result = evaluateLayoutReadiness(
      createMetrics({
        viewportMediaCount: 4,
        completeViewportMediaCount: 4,
        textBlockCount: 9,
        textCharCount: 240,
        visibleClickableCount: 10,
      }),
      { pageReady: true, visibilityState: 'hidden' },
    );

    expect(result.state).toBe('ready');
    expect(result.reasons).toEqual([]);
  });

  test('marks pages with pending media as provisionally ready', () => {
    const result = evaluateLayoutReadiness(
      createMetrics({
        viewportMediaCount: 5,
        completeViewportMediaCount: 2,
        pendingImages: 3,
        textBlockCount: 7,
        textCharCount: 180,
        visibleClickableCount: 8,
      }),
      { pageReady: true, visibilityState: 'hidden' },
    );

    expect(result.state).toBe('provisionally_ready');
    expect(result.reasons).toContain('pending-images');
  });

  test('marks skeleton-heavy pages as not ready', () => {
    const result = evaluateLayoutReadiness(
      createMetrics({
        textBlockCount: 4,
        textCharCount: 60,
        visibleClickableCount: 4,
        skeletonLikeCount: 3,
        placeholderAreaRatio: 0.22,
      }),
      { pageReady: true, visibilityState: 'hidden' },
    );

    expect(result.state).toBe('not_ready');
    expect(result.reasons).toContain('skeleton-placeholders');
    expect(result.reasons).toContain('placeholder-area');
  });

  test('keeps snapshot readiness thresholds explicit', () => {
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.metricsTimeBudgetMs).toBe(120);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxTextCandidates).toBe(250);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxClickableCandidates).toBe(60);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxPendingImages).toBe(24);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxViewportMedia).toBe(48);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxPlaceholderCandidates).toBe(
      120,
    );
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.readyContentScore).toBe(2);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.provisionalPendingImages).toBe(6);
    expect(getHighlightReadinessRetryDelay(1)).toBe(250);
    expect(getHighlightReadinessRetryDelay(2)).toBe(500);
  });
});
