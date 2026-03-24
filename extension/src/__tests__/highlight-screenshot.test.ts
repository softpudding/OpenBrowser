import { describe, expect, test } from 'bun:test';

import {
  calculateScreenshotCaptureScale,
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

  test('accounts for source DPR when clamping screenshot output size', () => {
    const scale = calculateScreenshotCaptureScale(
      1728,
      839,
      2,
      HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS,
    );

    expect(scale).toBeCloseTo(1920 / (1728 * 2), 3);
    expect(Math.round(1728 * 2 * scale)).toBe(1920);
    expect(Math.round(839 * 2 * scale)).toBe(932);
  });

  test('does not upscale small viewport captures', () => {
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
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.preferredFormat).toBe('jpeg');
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputWidth).toBe(1920);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.maxOutputHeight).toBe(1080);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(2);
    expect(HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS.settleBeforeCapture).toBeUndefined();
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupBeforeCapture).toBe(true);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.warmupMaxAttempts).toBe(3);
    expect(TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS.settleBeforeCapture).toBeUndefined();
  });
});
