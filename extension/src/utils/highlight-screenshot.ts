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

export function calculateScreenshotOutputScale(
  imageWidth: number,
  imageHeight: number,
  options?: ScreenshotCaptureOptions,
): number {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return 1;
  }

  let outputScale = 1;

  if (options?.maxOutputWidth && options.maxOutputWidth > 0) {
    outputScale = Math.min(
      outputScale,
      options.maxOutputWidth / imageWidth,
    );
  }

  if (options?.maxOutputHeight && options.maxOutputHeight > 0) {
    outputScale = Math.min(
      outputScale,
      options.maxOutputHeight / imageHeight,
    );
  }

  const minCaptureScale = options?.minCaptureScale ?? 0.1;
  return Math.max(minCaptureScale, Math.min(1, outputScale));
}
