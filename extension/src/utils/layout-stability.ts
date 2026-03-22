export interface LayoutStabilityMetrics {
  bodyHeight: number;
  scrollHeight: number;
  pendingImages: number;
  viewportMediaCount: number;
  completeViewportMediaCount: number;
  textBlockCount: number;
  textCharCount: number;
  visibleClickableCount: number;
  skeletonLikeCount: number;
  spinnerLikeCount: number;
  placeholderAreaRatio: number;
}

export const HIGHLIGHT_LAYOUT_STABILITY_CONFIG = {
  metricsTimeBudgetMs: 120,
  maxTextCandidates: 250,
  maxClickableCandidates: 60,
  maxPendingImages: 24,
  maxViewportMedia: 48,
  maxPlaceholderCandidates: 120,
  readyContentScore: 2,
  provisionalContentScore: 1,
  readyPendingImages: 1,
  provisionalPendingImages: 6,
  skeletonLikeThreshold: 2,
  spinnerLikeThreshold: 1,
  placeholderAreaRatioThreshold: 0.12,
  placeholderAreaRatioProvisionalThreshold: 0.04,
  quickRetryDelaysMs: [250, 500],
} as const;

export type HighlightPageState = 'ready' | 'provisionally_ready' | 'not_ready';

export interface LayoutReadinessResult extends LayoutStabilityMetrics {
  state: HighlightPageState;
  pageReady: boolean;
  visibilityState: string;
  contentScore: number;
  reasons: string[];
}

export function didLayoutStabilityMetricsChange(
  previous: LayoutStabilityMetrics,
  current: LayoutStabilityMetrics,
): boolean {
  return (
    previous.bodyHeight !== current.bodyHeight ||
    previous.scrollHeight !== current.scrollHeight ||
    previous.pendingImages !== current.pendingImages ||
    previous.viewportMediaCount !== current.viewportMediaCount ||
    previous.completeViewportMediaCount !==
      current.completeViewportMediaCount ||
    previous.textBlockCount !== current.textBlockCount ||
    previous.textCharCount !== current.textCharCount ||
    previous.visibleClickableCount !== current.visibleClickableCount ||
    previous.skeletonLikeCount !== current.skeletonLikeCount ||
    previous.spinnerLikeCount !== current.spinnerLikeCount ||
    previous.placeholderAreaRatio !== current.placeholderAreaRatio
  );
}

export function getLayoutContentScore(metrics: LayoutStabilityMetrics): number {
  let score = 0;

  if (metrics.completeViewportMediaCount >= 2) {
    score += 1;
  }

  if (metrics.textBlockCount >= 6 || metrics.textCharCount >= 140) {
    score += 1;
  }

  if (metrics.visibleClickableCount >= 12) {
    score += 1;
  }

  if (metrics.visibleClickableCount >= 6 && metrics.textCharCount >= 80) {
    score += 2;
  }

  return score;
}

export function hasMeaningfulViewportContent(
  metrics: LayoutStabilityMetrics,
): boolean {
  return getLayoutContentScore(metrics) >= 2;
}

export function evaluateLayoutReadiness(
  metrics: LayoutStabilityMetrics,
  options: { pageReady: boolean; visibilityState: string },
): LayoutReadinessResult {
  const reasons: string[] = [];
  const contentScore = getLayoutContentScore(metrics);

  if (!options.pageReady) {
    reasons.push('document-not-complete');
  }

  if (
    contentScore === 0 &&
    metrics.textCharCount < 40 &&
    metrics.visibleClickableCount < 3 &&
    metrics.completeViewportMediaCount === 0
  ) {
    reasons.push('low-viewport-content');
  }

  if (
    metrics.skeletonLikeCount >= HIGHLIGHT_LAYOUT_STABILITY_CONFIG.skeletonLikeThreshold
  ) {
    reasons.push('skeleton-placeholders');
  }

  if (
    metrics.spinnerLikeCount >= HIGHLIGHT_LAYOUT_STABILITY_CONFIG.spinnerLikeThreshold
  ) {
    reasons.push('loading-spinner');
  }

  if (
    metrics.placeholderAreaRatio >=
    HIGHLIGHT_LAYOUT_STABILITY_CONFIG.placeholderAreaRatioThreshold
  ) {
    reasons.push('placeholder-area');
  } else if (
    metrics.placeholderAreaRatio >=
    HIGHLIGHT_LAYOUT_STABILITY_CONFIG.placeholderAreaRatioProvisionalThreshold
  ) {
    reasons.push('minor-placeholder-area');
  }

  if (
    metrics.pendingImages > HIGHLIGHT_LAYOUT_STABILITY_CONFIG.readyPendingImages
  ) {
    reasons.push('pending-images');
  }

  const hasHardBlocker =
    reasons.includes('document-not-complete') ||
    reasons.includes('low-viewport-content') ||
    reasons.includes('skeleton-placeholders') ||
    reasons.includes('loading-spinner') ||
    reasons.includes('placeholder-area');

  let state: HighlightPageState = 'not_ready';
  if (
    !hasHardBlocker &&
    contentScore >= HIGHLIGHT_LAYOUT_STABILITY_CONFIG.readyContentScore &&
    metrics.pendingImages <= HIGHLIGHT_LAYOUT_STABILITY_CONFIG.readyPendingImages
  ) {
    state = 'ready';
  } else if (
    !hasHardBlocker &&
    contentScore >=
      HIGHLIGHT_LAYOUT_STABILITY_CONFIG.provisionalContentScore &&
    metrics.pendingImages <=
      HIGHLIGHT_LAYOUT_STABILITY_CONFIG.provisionalPendingImages
  ) {
    state = 'provisionally_ready';
  }

  return {
    ...metrics,
    state,
    pageReady: options.pageReady,
    visibilityState: options.visibilityState,
    contentScore,
    reasons,
  };
}

export function getHighlightReadinessRetryDelay(attempt: number): number {
  const delays = HIGHLIGHT_LAYOUT_STABILITY_CONFIG.quickRetryDelaysMs;
  if (delays.length === 0) {
    return 0;
  }

  const index = Math.max(0, Math.min(attempt - 1, delays.length - 1));
  return delays[index];
}

export function buildLayoutStabilityHelpersScript(): string {
  return `
    const layoutStabilityConfig = ${JSON.stringify(HIGHLIGHT_LAYOUT_STABILITY_CONFIG)};

    function didLayoutStabilityMetricsChange(previous, current) {
      return (
        previous.bodyHeight !== current.bodyHeight ||
        previous.scrollHeight !== current.scrollHeight ||
        previous.pendingImages !== current.pendingImages ||
        previous.viewportMediaCount !== current.viewportMediaCount ||
        previous.completeViewportMediaCount !== current.completeViewportMediaCount ||
        previous.textBlockCount !== current.textBlockCount ||
        previous.textCharCount !== current.textCharCount ||
        previous.visibleClickableCount !== current.visibleClickableCount ||
        previous.skeletonLikeCount !== current.skeletonLikeCount ||
        previous.spinnerLikeCount !== current.spinnerLikeCount ||
        previous.placeholderAreaRatio !== current.placeholderAreaRatio
      );
    }

    function getLayoutContentScore(metrics) {
      let score = 0;

      if (metrics.completeViewportMediaCount >= 2) {
        score += 1;
      }

      if (metrics.textBlockCount >= 6 || metrics.textCharCount >= 140) {
        score += 1;
      }

      if (metrics.visibleClickableCount >= 12) {
        score += 1;
      }

      if (metrics.visibleClickableCount >= 6 && metrics.textCharCount >= 80) {
        score += 2;
      }

      return score;
    }

    function hasMeaningfulViewportContent(metrics) {
      return getLayoutContentScore(metrics) >= 2;
    }

    function evaluateLayoutReadiness(metrics, options) {
      const reasons = [];
      const contentScore = getLayoutContentScore(metrics);

      if (!options.pageReady) {
        reasons.push('document-not-complete');
      }

      if (
        contentScore === 0 &&
        metrics.textCharCount < 40 &&
        metrics.visibleClickableCount < 3 &&
        metrics.completeViewportMediaCount === 0
      ) {
        reasons.push('low-viewport-content');
      }

      if (metrics.skeletonLikeCount >= layoutStabilityConfig.skeletonLikeThreshold) {
        reasons.push('skeleton-placeholders');
      }

      if (metrics.spinnerLikeCount >= layoutStabilityConfig.spinnerLikeThreshold) {
        reasons.push('loading-spinner');
      }

      if (
        metrics.placeholderAreaRatio >=
        layoutStabilityConfig.placeholderAreaRatioThreshold
      ) {
        reasons.push('placeholder-area');
      } else if (
        metrics.placeholderAreaRatio >=
        layoutStabilityConfig.placeholderAreaRatioProvisionalThreshold
      ) {
        reasons.push('minor-placeholder-area');
      }

      if (metrics.pendingImages > layoutStabilityConfig.readyPendingImages) {
        reasons.push('pending-images');
      }

      const hasHardBlocker =
        reasons.includes('document-not-complete') ||
        reasons.includes('low-viewport-content') ||
        reasons.includes('skeleton-placeholders') ||
        reasons.includes('loading-spinner') ||
        reasons.includes('placeholder-area');

      let state = 'not_ready';
      if (
        !hasHardBlocker &&
        contentScore >= layoutStabilityConfig.readyContentScore &&
        metrics.pendingImages <= layoutStabilityConfig.readyPendingImages
      ) {
        state = 'ready';
      } else if (
        !hasHardBlocker &&
        contentScore >= layoutStabilityConfig.provisionalContentScore &&
        metrics.pendingImages <= layoutStabilityConfig.provisionalPendingImages
      ) {
        state = 'provisionally_ready';
      }

      return {
        ...metrics,
        state,
        pageReady: options.pageReady,
        visibilityState: options.visibilityState,
        contentScore,
        reasons,
      };
    }
  `;
}
