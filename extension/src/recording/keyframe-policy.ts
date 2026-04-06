const ACTION_KEYFRAME_EVENT_TYPES = new Set(['click', 'submit']);
const DEFAULT_RECORDING_KEYFRAME_WAIT_MS = 180;
const ACTION_RECORDING_KEYFRAME_WAIT_MS = 60;

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

export function shouldCaptureRecordingKeyframe(eventType: string): boolean {
  return ACTION_KEYFRAME_EVENT_TYPES.has(eventType);
}

export function getRecordingKeyframeWaitForRender(eventType: string): number {
  return ACTION_KEYFRAME_EVENT_TYPES.has(eventType)
    ? ACTION_RECORDING_KEYFRAME_WAIT_MS
    : DEFAULT_RECORDING_KEYFRAME_WAIT_MS;
}

export function shouldDiscardPostCaptureRecordingKeyframe(
  eventType: string,
  eventData: Record<string, unknown>,
  keyframe: Record<string, unknown> | null | undefined,
): boolean {
  if (!ACTION_KEYFRAME_EVENT_TYPES.has(eventType) || !keyframe) {
    return false;
  }

  const sourcePageUrl = getSourcePageUrl(eventData);
  const keyframeUrl = normalizeComparableUrl(keyframe.url);
  return Boolean(sourcePageUrl && keyframeUrl && sourcePageUrl !== keyframeUrl);
}
