import { describe, expect, test } from 'bun:test';

import {
  calculateScreenshotCaptureScale,
  HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
  TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS,
} from '../utils/highlight-screenshot';

describe('Highlight Screenshot', () => {
  test('does not force a dedicated format or output clamp for highlight captures', () => {
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.preferredFormat).toBeUndefined();
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputWidth).toBeUndefined();
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputHeight).toBeUndefined();
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.minCaptureScale).toBeUndefined();
  });

  test('keeps highlight capture scale aligned with normal screenshots', () => {
    const scale = calculateScreenshotCaptureScale(
      1728,
      1080,
      2,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBe(2);
    expect(Math.round(1728 * scale)).toBe(3456);
    expect(Math.round(1080 * scale)).toBe(2160);
  });

  test('does not override small viewport captures', () => {
    const scale = calculateScreenshotCaptureScale(
      390,
      844,
      1,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBe(1);
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

  test('enables pre-capture warmup for background tab screenshots', () => {
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(3);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.settleBeforeCapture).toBeUndefined();
  });
});
