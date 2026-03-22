import { describe, expect, test } from 'bun:test';

import {
  HIGHLIGHT_LAYOUT_STABILITY_CONFIG,
  didLayoutStabilityMetricsChange,
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

  test('keeps the current wait budget explicit', () => {
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.quietWindowMs).toBe(350);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.minWaitMs).toBe(250);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxWaitMs).toBe(2200);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.metricsSampleIntervalMs).toBe(250);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.meaningfulContentGraceMs).toBe(
      1200,
    );
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.metricsTimeBudgetMs).toBe(120);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxTextCandidates).toBe(250);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxClickableCandidates).toBe(60);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxPendingImages).toBe(24);
    expect(HIGHLIGHT_LAYOUT_STABILITY_CONFIG.maxViewportMedia).toBe(48);
  });
});
