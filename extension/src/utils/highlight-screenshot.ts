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

export const HIGHLIGHT_SCREENSHOT_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
  // Keep highlight captures on the same baseline as regular action screenshots.
  // We no longer force JPEG or clamp output dimensions specifically for highlight flows.
};

export const TAB_VIEW_SCREENSHOT_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
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

  let captureScale = devicePixelRatio;

  if (options?.maxOutputWidth && options.maxOutputWidth > 0) {
    captureScale = Math.min(
      captureScale,
      options.maxOutputWidth / viewportWidth,
    );
  }

  if (options?.maxOutputHeight && options.maxOutputHeight > 0) {
    captureScale = Math.min(
      captureScale,
      options.maxOutputHeight / viewportHeight,
    );
  }

  const minCaptureScale = options?.minCaptureScale ?? 0.1;
  return Math.max(minCaptureScale, captureScale);
}
