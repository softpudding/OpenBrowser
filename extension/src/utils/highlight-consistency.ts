import type { InteractiveElement } from '../types';

export interface HighlightConsistencySample {
  id: string;
  bbox: InteractiveElement['bbox'];
}

export interface HighlightConsistencyResult {
  checkedCount: number;
  matchedCount: number;
  missingCount: number;
  shiftedCount: number;
  maxCenterShift: number;
  maxSizeDelta: number;
  shouldRetry: boolean;
}

export const HIGHLIGHT_CONSISTENCY_CONFIG = {
  maxSampleSize: 12,
  centerShiftThreshold: 24,
  sizeDeltaThreshold: 18,
  shiftedRatioThreshold: 0.3,
  missingRatioThreshold: 0.25,
} as const;

export const HIGHLIGHT_CONSISTENCY_REPEAT_CONFIG = {
  maxCenterShiftDelta: 16,
  maxSizeDeltaDelta: 6,
} as const;

function getCenterShift(
  a: InteractiveElement['bbox'],
  b: InteractiveElement['bbox'],
): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function getMaxSizeDelta(
  a: InteractiveElement['bbox'],
  b: InteractiveElement['bbox'],
): number {
  return Math.max(Math.abs(a.width - b.width), Math.abs(a.height - b.height));
}

export function evaluateHighlightConsistency(
  detected: HighlightConsistencySample[],
  current: HighlightConsistencySample[],
): HighlightConsistencyResult {
  const currentById = new Map(current.map((sample) => [sample.id, sample]));
  let matchedCount = 0;
  let missingCount = 0;
  let shiftedCount = 0;
  let maxCenterShift = 0;
  let maxSizeDelta = 0;

  for (const sample of detected) {
    const currentSample = currentById.get(sample.id);
    if (!currentSample) {
      missingCount++;
      continue;
    }

    matchedCount++;
    const centerShift = getCenterShift(sample.bbox, currentSample.bbox);
    const sizeDelta = getMaxSizeDelta(sample.bbox, currentSample.bbox);
    maxCenterShift = Math.max(maxCenterShift, centerShift);
    maxSizeDelta = Math.max(maxSizeDelta, sizeDelta);

    if (
      centerShift >= HIGHLIGHT_CONSISTENCY_CONFIG.centerShiftThreshold ||
      sizeDelta >= HIGHLIGHT_CONSISTENCY_CONFIG.sizeDeltaThreshold
    ) {
      shiftedCount++;
    }
  }

  const checkedCount = detected.length;
  const shiftedRatio = checkedCount > 0 ? shiftedCount / checkedCount : 0;
  const missingRatio = checkedCount > 0 ? missingCount / checkedCount : 0;

  return {
    checkedCount,
    matchedCount,
    missingCount,
    shiftedCount,
    maxCenterShift: Math.round(maxCenterShift),
    maxSizeDelta: Math.round(maxSizeDelta),
    shouldRetry:
      checkedCount > 0 &&
      (shiftedRatio >= HIGHLIGHT_CONSISTENCY_CONFIG.shiftedRatioThreshold ||
        missingRatio >= HIGHLIGHT_CONSISTENCY_CONFIG.missingRatioThreshold),
  };
}

export function isRepeatedHighlightDrift(
  current: HighlightConsistencyResult,
  previous: HighlightConsistencyResult | null,
): boolean {
  if (!previous || !current.shouldRetry || !previous.shouldRetry) {
    return false;
  }

  return (
    current.checkedCount === previous.checkedCount &&
    current.matchedCount === previous.matchedCount &&
    current.missingCount === previous.missingCount &&
    current.shiftedCount === previous.shiftedCount &&
    Math.abs(current.maxCenterShift - previous.maxCenterShift) <=
      HIGHLIGHT_CONSISTENCY_REPEAT_CONFIG.maxCenterShiftDelta &&
    Math.abs(current.maxSizeDelta - previous.maxSizeDelta) <=
      HIGHLIGHT_CONSISTENCY_REPEAT_CONFIG.maxSizeDeltaDelta
  );
}
