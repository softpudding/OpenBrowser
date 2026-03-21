import { describe, expect, test } from 'bun:test';

import {
  calculateScreenshotCaptureScale,
  HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
} from '../utils/highlight-screenshot';

describe('Highlight Screenshot', () => {
  test('caps highlight capture to roughly 720p output height', () => {
    const scale = calculateScreenshotCaptureScale(
      1728,
      1080,
      2,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBeCloseTo(720 / 1080, 3);
    expect(Math.round(1728 * scale)).toBe(1152);
    expect(Math.round(1080 * scale)).toBe(720);
  });

  test('does not upscale when viewport is already small', () => {
    const scale = calculateScreenshotCaptureScale(
      390,
      844,
      1,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBeCloseTo(720 / 844, 3);
    expect(scale).toBeLessThanOrEqual(1);
  });

  test('respects minimum capture scale guardrail', () => {
    const scale = calculateScreenshotCaptureScale(5000, 4000, 3, {
      preferredFormat: 'jpeg',
      maxOutputWidth: 100,
      maxOutputHeight: 100,
      minCaptureScale: 0.25,
    });

    expect(scale).toBe(0.25);
  });
});
