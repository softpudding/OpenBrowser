import type { ScreenshotCaptureOptions } from '../utils/highlight-screenshot';

const ACTION_KEYFRAME_EVENT_TYPES = new Set([
  'click',
  'change',
  'submit',
  'drag_and_drop',
  'set_slider',
]);
const DEFAULT_RECORDING_KEYFRAME_WAIT_MS = 180;
const ACTION_RECORDING_KEYFRAME_WAIT_MS = 60;
const PRE_ACTION_RECORDING_KEYFRAME_WAIT_MS = 0;
const RECORDING_KEYFRAME_CAPTURE_OPTIONS: ScreenshotCaptureOptions = {
  preferredFormat: 'jpeg',
  maxOutputWidth: 960,
  maxOutputHeight: 540,
  warmupBeforeCapture: true,
  warmupMaxAttempts: 1,
  settleBeforeCapture: true,
  settleTimeoutMs: 450,
  settleQuietWindowMs: 160,
};
const PRE_ACTION_RECORDING_KEYFRAME_CAPTURE_OPTIONS: ScreenshotCaptureOptions =
  {
    preferredFormat: 'jpeg',
    maxOutputWidth: 960,
    maxOutputHeight: 540,
    warmupBeforeCapture: false,
    settleBeforeCapture: false,
  };

function normalizeComparableUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function getSourcePageUrl(eventData: Record<string, unknown>): string | null {
  const page = eventData.page;
  if (page && typeof page === 'object') {
    const pageUrl = normalizeComparableUrl((page as { url?: unknown }).url);
    if (pageUrl) {
      return pageUrl;
    }
  }

  const tab = eventData.tab;
  if (tab && typeof tab === 'object') {
    return normalizeComparableUrl((tab as { url?: unknown }).url);
  }

  return null;
}

function normalizeComparableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function isInputLikeRecordingTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const target = value as Record<string, unknown>;
  const tagName = normalizeComparableString(target.tagName)?.toLowerCase();
  const role = normalizeComparableString(target.role)?.toLowerCase();

  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    role === 'textbox' ||
    role === 'searchbox' ||
    role === 'combobox'
  );
}

export function shouldCaptureRecordingKeyframe(
  eventType: string,
  eventData?: Record<string, unknown>,
): boolean {
  if (eventType === 'focus') {
    return isInputLikeRecordingTarget(eventData?.element);
  }

  return ACTION_KEYFRAME_EVENT_TYPES.has(eventType);
}

export function getRecordingKeyframeWaitForRender(eventType: string): number {
  return ACTION_KEYFRAME_EVENT_TYPES.has(eventType)
    ? ACTION_RECORDING_KEYFRAME_WAIT_MS
    : DEFAULT_RECORDING_KEYFRAME_WAIT_MS;
}

export function getRecordingKeyframeCaptureOptions(): ScreenshotCaptureOptions {
  return { ...RECORDING_KEYFRAME_CAPTURE_OPTIONS };
}

export function getRecordingPreActionWaitForRender(): number {
  return PRE_ACTION_RECORDING_KEYFRAME_WAIT_MS;
}

export function getRecordingPreActionCaptureOptions(): ScreenshotCaptureOptions {
  return { ...PRE_ACTION_RECORDING_KEYFRAME_CAPTURE_OPTIONS };
}

export function shouldDiscardPostCaptureRecordingKeyframe(
  eventType: string,
  eventData: Record<string, unknown>,
  keyframe: Record<string, unknown> | null | undefined,
): boolean {
  if (
    (!ACTION_KEYFRAME_EVENT_TYPES.has(eventType) && eventType !== 'focus') ||
    !keyframe
  ) {
    return false;
  }

  const sourcePageUrl = getSourcePageUrl(eventData);
  const keyframeUrl = normalizeComparableUrl(keyframe.url);
  return Boolean(sourcePageUrl && keyframeUrl && sourcePageUrl !== keyframeUrl);
}
