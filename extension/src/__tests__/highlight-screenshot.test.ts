import { describe, expect, test } from 'bun:test';

import {
  calculateScreenshotOutputScale,
  DEFAULT_SCREENSHOT_CAPTURE_OPTIONS,
  HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
  TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
} from '../utils/highlight-screenshot';

describe('Highlight Screenshot', () => {
  test('caps regular screenshots to 1080p-class JPEG output', () => {
    expect(DEFAULT_SCREENSHOT_CAPTURE_OPTIONS.preferredFormat).toBe('jpeg');
    expect(DEFAULT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputWidth).toBe(1920);
    expect(DEFAULT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputHeight).toBe(1080);
  });

  test('downscales captured device-pixel screenshots to the configured bounds', () => {
    const scale = calculateScreenshotOutputScale(
      3456,
      1678,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBeCloseTo(1920 / 3456, 3);
    expect(Math.round(3456 * scale)).toBe(1920);
    expect(Math.round(1678 * scale)).toBe(932);
  });

  test('does not upscale small screenshots', () => {
    const scale = calculateScreenshotOutputScale(
      390,
      844,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBe(1);
  });

  test('respects minimum output scale guardrail', () => {
    const scale = calculateScreenshotOutputScale(5000, 4000, {
      preferredFormat: 'jpeg',
      maxOutputWidth: 100,
      maxOutputHeight: 100,
      minCaptureScale: 0.25,
    });

    expect(scale).toBe(0.25);
  });

  test('enables pre-capture warmup for background tab screenshots', () => {
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.preferredFormat).toBe('jpeg');
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputWidth).toBe(1920);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputHeight).toBe(1080);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(2);
    expect(
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.settleBeforeCapture,
    ).toBeUndefined();
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(3);
    expect(
      TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.settleBeforeCapture,
    ).toBeUndefined();
  });
});
