export interface LayoutStabilityMetrics {
  bodyHeight: number;
  scrollHeight: number;
  pendingImages: number;
  viewportMediaCount: number;
  completeViewportMediaCount: number;
  textBlockCount: number;
  textCharCount: number;
  visibleClickableCount: number;
}

export const HIGHLIGHT_LAYOUT_STABILITY_CONFIG = {
  quietWindowMs: 350,
  minWaitMs: 250,
  maxWaitMs: 2200,
  pollIntervalMs: 100,
  metricsSampleIntervalMs: 250,
  meaningfulContentGraceMs: 1200,
} as const;

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
    previous.visibleClickableCount !== current.visibleClickableCount
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
        previous.visibleClickableCount !== current.visibleClickableCount
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
  `;
}
