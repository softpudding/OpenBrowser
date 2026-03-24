import { describe, expect, test } from 'bun:test';

import {
  HIGHLIGHT_CONSISTENCY_CONFIG,
  evaluateHighlightConsistency,
  isRepeatedHighlightDrift,
  type HighlightConsistencySample,
} from '../utils/highlight-consistency';

function createSample(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): HighlightConsistencySample {
  return {
    id,
    bbox: { x, y, width, height },
  };
}

describe('Highlight Consistency', () => {
  test('does not retry when all sampled elements stay near their detected positions', () => {
    const detected = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 300, 140, 120, 30),
      createSample('c', 640, 200, 90, 40),
    ];
    const current = [
      createSample('a', 104, 102, 80, 30),
      createSample('b', 297, 141, 120, 31),
      createSample('c', 641, 197, 90, 40),
    ];

    const result = evaluateHighlightConsistency(detected, current);

    expect(result.shouldRetry).toBe(false);
    expect(result.shiftedCount).toBe(0);
    expect(result.missingCount).toBe(0);
  });

  test('retries when a large portion of sampled elements drift significantly', () => {
    const detected = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 220, 100, 80, 30),
      createSample('c', 340, 100, 80, 30),
      createSample('d', 460, 100, 80, 30),
    ];
    const current = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 220, 100, 80, 30),
      createSample('c', 760, 620, 80, 30),
      createSample('d', 900, 680, 80, 30),
    ];

    const result = evaluateHighlightConsistency(detected, current);

    expect(result.shouldRetry).toBe(true);
    expect(result.shiftedCount).toBe(2);
    expect(result.maxCenterShift).toBeGreaterThan(
      HIGHLIGHT_CONSISTENCY_CONFIG.centerShiftThreshold,
    );
  });

  test('retries when too many sampled elements disappear by verification time', () => {
    const detected = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 220, 100, 80, 30),
      createSample('c', 340, 100, 80, 30),
      createSample('d', 460, 100, 80, 30),
    ];
    const current = [createSample('a', 100, 100, 80, 30)];

    const result = evaluateHighlightConsistency(detected, current);

    expect(result.shouldRetry).toBe(true);
    expect(result.missingCount).toBe(3);
  });

  test('tolerates a single shifted element when the rest of the sample is stable', () => {
    const detected = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 220, 100, 80, 30),
      createSample('c', 340, 100, 80, 30),
      createSample('d', 460, 100, 80, 30),
    ];
    const current = [
      createSample('a', 100, 100, 80, 30),
      createSample('b', 220, 100, 80, 30),
      createSample('c', 640, 480, 80, 30),
      createSample('d', 460, 100, 80, 30),
    ];

    const result = evaluateHighlightConsistency(detected, current);

    expect(result.shiftedCount).toBe(1);
    expect(result.shouldRetry).toBe(false);
  });

  test('detects repeated drift signatures so highlight can stop retrying early', () => {
    const previous = {
      checkedCount: 12,
      matchedCount: 12,
      missingCount: 0,
      shiftedCount: 5,
      maxCenterShift: 268,
      maxSizeDelta: 32,
      shouldRetry: true,
    };
    const current = {
      checkedCount: 12,
      matchedCount: 12,
      missingCount: 0,
      shiftedCount: 5,
      maxCenterShift: 274,
      maxSizeDelta: 30,
      shouldRetry: true,
    };

    expect(isRepeatedHighlightDrift(current, previous)).toBe(true);
  });

  test('does not treat materially different retry metrics as repeated drift', () => {
    const previous = {
      checkedCount: 12,
      matchedCount: 12,
      missingCount: 0,
      shiftedCount: 5,
      maxCenterShift: 268,
      maxSizeDelta: 32,
      shouldRetry: true,
    };
    const current = {
      checkedCount: 12,
      matchedCount: 9,
      missingCount: 3,
      shiftedCount: 2,
      maxCenterShift: 64,
      maxSizeDelta: 12,
      shouldRetry: true,
    };

    expect(isRepeatedHighlightDrift(current, previous)).toBe(false);
  });
});
