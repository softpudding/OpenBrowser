export interface ScreenshotCaptureOptions {
  preferredFormat?: 'png' | 'jpeg';
  maxOutputWidth?: number;
  maxOutputHeight?: number;
  minCaptureScale?: number;
  warmupBeforeCapture?: boolean;
  warmupMaxAttempts?: number;
  settleBeforeCapture?: boolean;
  settleTimeoutMs?: number;
  settleQuietWindowMs?: number;
}

export const DEFAULT_SCREENSHOT_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
  preferredFormat: 'jpeg',
  maxOutputWidth: 1920,
  maxOutputHeight: 1080,
};

export const HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
  ...DEFAULT_SCREENSHOT_CAPTURE_OPTIONS,
  warmupBeforeCapture: true,
  warmupMaxAttempts: 2,
};

export const HIGHLIGHT_PRECONDITION_CAPTURE_OPTIONS: ScreenshotCaptureOptions =
  {
    ...DEFAULT_SCREENSHOT_CAPTURE_OPTIONS,
    warmupBeforeCapture: true,
    warmupMaxAttempts: 3,
  };

export const TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
  ...DEFAULT_SCREENSHOT_CAPTURE_OPTIONS,
  warmupBeforeCapture: true,
  warmupMaxAttempts: 3,
};

export function calculateScreenshotCaptureScale(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  options?: ScreenshotCaptureOptions,
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || devicePixelRatio <= 0) {
    return 1;
  }

  // Chrome's Page.captureScreenshot clip.scale composes with the source DPR.
  // A scale of 1 already produces device-pixel output on HiDPI displays.
  let captureScale = 1;

  if (options?.maxOutputWidth && options.maxOutputWidth > 0) {
    captureScale = Math.min(
      captureScale,
      options.maxOutputWidth / (viewportWidth * devicePixelRatio),
    );
  }

  if (options?.maxOutputHeight && options.maxOutputHeight > 0) {
    captureScale = Math.min(
      captureScale,
      options.maxOutputHeight / (viewportHeight * devicePixelRatio),
    );
  }

  const minCaptureScale = options?.minCaptureScale ?? 0.1;
  return Math.max(minCaptureScale, Math.min(1, captureScale));
}
