import { getOrCreateUUID } from '../uuid/uuidGenerator';
import type { RecordingLaunchMode } from '../types';
import { captureScreenshot, compressIfNeeded } from '../commands/screenshot';
import type { ScreenshotCaptureOptions } from '../utils/highlight-screenshot';

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';
const DEFAULT_RECORDING_LAUNCH_MODE: RecordingLaunchMode = 'dedicated_window';
const RECORDING_GROUP_TITLE_PREFIX = 'OpenBrowser Recording';
const RECORDING_GROUP_COLOR = 'grey' as chrome.tabGroups.Color;
const RECORDING_GROUP_COLLAPSED = false;
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
const RECORDING_KEYFRAME_THRESHOLD_BYTES = 380 * 1024;
const RECORDING_KEYFRAME_MIN_QUALITY = 40;
const RECORDING_SCREENSHOT_CONVERSATION_PREFIX = 'recording';
const CRITICAL_KEYFRAME_EVENT_TYPES = new Set([
  'click',
  'submit',
  'tab_ready',
]);

interface RecordingScope {
  launchMode: RecordingLaunchMode;
  windowId: number | null;
  groupId: number | null;
  tabIds: Set<number>;
}

interface ActiveRecording {
  recordingId: string;
  startedAt: number;
  scope: RecordingScope;
}

interface ContentRecordingEventMessage {
  type: 'openbrowser:recording-event';
  event?: {
    type?: string;
    data?: Record<string, unknown>;
    timestamp?: number;
  };
}

let activeRecording: ActiveRecording | null = null;
let listenersInitialized = false;

function isOpenBrowserUiUrl(url?: string | null): boolean {
  if (typeof url !== 'string' || !url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.port === '8765' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function isRecordableUrl(url?: string | null): boolean {
  return (
    typeof url === 'string' &&
    /^(https?:|file:)/.test(url) &&
    !isOpenBrowserUiUrl(url)
  );
}

function getGroupTitle(recordingId: string): string {
  return `${RECORDING_GROUP_TITLE_PREFIX}-${recordingId.slice(0, 8)}`;
}

function serializeRecordingScope(scope: RecordingScope): Record<string, unknown> {
  return {
    launch_mode: scope.launchMode,
    window_id: scope.windowId,
    group_id: scope.groupId,
    tab_ids: Array.from(scope.tabIds.values()).sort((a, b) => a - b),
  };
}

function serializeTab(
  tab: chrome.tabs.Tab,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    openerTabId: tab.openerTabId ?? null,
    index: tab.index ?? null,
    active: tab.active ?? null,
    status: tab.status ?? null,
    groupId: tab.groupId ?? null,
    url: tab.url ?? null,
    title: tab.title ?? null,
    ...overrides,
  };
}

async function postRecordingEventFor(
  recording: ActiveRecording,
  eventType: string,
  eventData: Record<string, unknown> = {},
): Promise<void> {
  const browserId = await getOrCreateUUID();
  const response = await fetch(
    `${SERVER_HTTP_URL}/recordings/${recording.recordingId}/events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        browser_id: browserId,
        event_type: eventType,
        event_data: {
          recordedAt: Date.now(),
          ...eventData,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Recording event upload failed (${response.status}): ${
        errorText || response.statusText
      }`,
    );
  }
}

function postRecordingEvent(
  eventType: string,
  eventData: Record<string, unknown> = {},
): void {
  const recording = activeRecording;
  if (!recording) {
    return;
  }

  void postRecordingEventFor(recording, eventType, eventData).catch((error) => {
    console.error(`❌ [Recorder] Failed to upload ${eventType}:`, error);
  });
}

function shouldCaptureKeyframe(eventType: string): boolean {
  return CRITICAL_KEYFRAME_EVENT_TYPES.has(eventType);
}

async function buildRecordingKeyframe(
  tabId: number,
  recordingId: string,
  trigger: string,
  waitForRender: number = 180,
): Promise<Record<string, unknown> | null> {
  try {
    const screenshotResult = await captureScreenshot(
      tabId,
      `${RECORDING_SCREENSHOT_CONVERSATION_PREFIX}:${recordingId}`,
      false,
      65,
      false,
      waitForRender,
      RECORDING_KEYFRAME_CAPTURE_OPTIONS,
    );

    const compressedResult = await compressIfNeeded(
      screenshotResult,
      RECORDING_KEYFRAME_THRESHOLD_BYTES,
      RECORDING_KEYFRAME_MIN_QUALITY,
    );
    const finalResult =
      compressedResult &&
      typeof compressedResult === 'object' &&
      'imageData' in compressedResult
        ? (compressedResult as {
            imageData?: string;
            metadata?: Record<string, unknown>;
          })
        : screenshotResult;

    if (!finalResult?.imageData) {
      return null;
    }

    const metadata =
      finalResult.metadata && typeof finalResult.metadata === 'object'
        ? finalResult.metadata
        : {};

    return {
      trigger,
      capturedAt: Date.now(),
      imageData: finalResult.imageData,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
      url: metadata.url ?? null,
      title: metadata.title ?? null,
    };
  } catch (error) {
    console.warn(`⚠️ [Recorder] Failed to capture keyframe for ${trigger}:`, error);
    return null;
  }
}

async function enrichEventDataWithKeyframe(
  recording: ActiveRecording,
  eventType: string,
  tab: chrome.tabs.Tab,
  eventData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Do not attach screenshots to page_view. page_view is a lifecycle signal that
  // fires during content-script resume/start-recording immediately after reloads,
  // before the page has fully stabilized. Recording experiments showed that
  // capturing a keyframe in that early phase can shrink the live Chrome page
  // into the top-left corner. Use tab_ready for startup snapshots instead.
  if (eventType === 'page_view') {
    return eventData;
  }

  if (!shouldCaptureKeyframe(eventType) || !tab.id || !isRecordableUrl(tab.url)) {
    return eventData;
  }

  const keyframe = await buildRecordingKeyframe(tab.id, recording.recordingId, eventType);
  if (!keyframe) {
    return eventData;
  }

  return {
    ...eventData,
    keyframe,
  };
}

function isTabIdInRecordingScope(
  scope: RecordingScope,
  tabId?: number | null,
): boolean {
  return typeof tabId === 'number' && scope.tabIds.has(tabId);
}

function isTabRelatedToRecordingScope(
  scope: RecordingScope,
  tab?: chrome.tabs.Tab | null,
): boolean {
  if (!tab?.id) {
    return false;
  }

  return (
    scope.tabIds.has(tab.id) ||
    (scope.windowId !== null && tab.windowId === scope.windowId) ||
    (typeof tab.openerTabId === 'number' && scope.tabIds.has(tab.openerTabId))
  );
}

async function ensureTabIsGrouped(
  tabId: number,
  scope: RecordingScope,
): Promise<void> {
  if (!chrome.tabGroups || scope.groupId === null) {
    return;
  }

  try {
    const existingTab = await chrome.tabs.get(tabId);
    if (
      existingTab.groupId !== undefined &&
      existingTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
      existingTab.groupId !== scope.groupId
    ) {
      await chrome.tabs.ungroup([tabId]);
    }
  } catch {
    // Ignore tab inspection failures and try grouping directly.
  }

  try {
    await chrome.tabs.group({
      groupId: scope.groupId,
      tabIds: [tabId],
    });
  } catch (error) {
    console.warn(`⚠️ [Recorder] Failed to group tab ${tabId}:`, error);
  }
}

async function addTabToRecordingScope(
  recording: ActiveRecording,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (!tab.id) {
    return;
  }

  recording.scope.tabIds.add(tab.id);
  await ensureTabIsGrouped(tab.id, recording.scope);
}

async function createDedicatedWindowScope(
  recordingId: string,
): Promise<RecordingScope> {
  const createdWindow = await chrome.windows.create({
    focused: true,
  });

  if (!createdWindow.id) {
    throw new Error('Failed to create dedicated recording window');
  }

  const initialTab =
    createdWindow.tabs?.find((tab) => typeof tab.id === 'number') ??
    (await chrome.tabs.query({ windowId: createdWindow.id }))[0];

  if (!initialTab?.id) {
    throw new Error('Failed to create initial tab for dedicated recording window');
  }

  let groupId: number | null = null;
  if (chrome.tabGroups) {
    if (
      initialTab.groupId !== undefined &&
      initialTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      try {
        await chrome.tabs.ungroup([initialTab.id]);
      } catch {
        // Best effort only.
      }
    }

    groupId = await chrome.tabs.group({
      createProperties: { windowId: createdWindow.id },
      tabIds: [initialTab.id],
    });

    await chrome.tabGroups.update(groupId, {
      title: getGroupTitle(recordingId),
      color: RECORDING_GROUP_COLOR,
      collapsed: RECORDING_GROUP_COLLAPSED,
    });
  }

  return {
    launchMode: 'dedicated_window',
    windowId: createdWindow.id,
    groupId,
    tabIds: new Set([initialTab.id]),
  };
}

async function createCurrentWindowScope(): Promise<RecordingScope> {
  const focusedWindow = await chrome.windows.getLastFocused({
    populate: true,
  });

  if (!focusedWindow.id) {
    throw new Error('Failed to resolve the focused browser window for recording');
  }

  const tabs =
    focusedWindow.tabs ?? (await chrome.tabs.query({ windowId: focusedWindow.id }));
  const tabIds = new Set(
    tabs
      .map((tab) => tab.id)
      .filter((tabId): tabId is number => typeof tabId === 'number'),
  );

  if (tabIds.size === 0) {
    throw new Error('Focused window has no tabs to record');
  }

  return {
    launchMode: 'current_window',
    windowId: focusedWindow.id,
    groupId: null,
    tabIds,
  };
}

async function createRecordingScope(
  recordingId: string,
  launchMode?: RecordingLaunchMode,
): Promise<RecordingScope> {
  const resolvedLaunchMode = launchMode ?? DEFAULT_RECORDING_LAUNCH_MODE;
  if (resolvedLaunchMode === 'current_window') {
    return createCurrentWindowScope();
  }
  return createDedicatedWindowScope(recordingId);
}

async function sendRecordingStateMessageToScope(
  recording: ActiveRecording,
  message: Record<string, unknown>,
): Promise<void> {
  const tabIds = Array.from(recording.scope.tabIds.values());
  await Promise.all(
    tabIds.map(async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!isRecordableUrl(tab.url)) {
          return;
        }
        await chrome.tabs.sendMessage(tabId, message);
      } catch {
        // Some pages cannot receive messages or the tab may have been removed.
      }
    }),
  );
}

export async function startRecording(
  recordingId: string,
  launchMode?: RecordingLaunchMode,
): Promise<void> {
  if (activeRecording?.recordingId === recordingId) {
    return;
  }

  const scope = await createRecordingScope(recordingId, launchMode);
  const recording: ActiveRecording = {
    recordingId,
    startedAt: Date.now(),
    scope,
  };

  activeRecording = recording;

  await sendRecordingStateMessageToScope(recording, {
    type: 'openbrowser:start-recording',
    recording_id: recordingId,
  });

  postRecordingEvent('recording_started', {
    startedAt: recording.startedAt,
    scope: serializeRecordingScope(recording.scope),
  });
}

export async function stopRecording(recordingId?: string): Promise<void> {
  const recording = activeRecording;
  if (!recording) {
    return;
  }

  if (recordingId && recording.recordingId !== recordingId) {
    console.warn(
      `⚠️ [Recorder] Requested stop for ${recordingId}, but active recording is ${recording.recordingId}`,
    );
  }

  await sendRecordingStateMessageToScope(recording, {
    type: 'openbrowser:stop-recording',
    recording_id: recording.recordingId,
  });

  await postRecordingEventFor(recording, 'recording_stopped', {
    stoppedAt: Date.now(),
    scope: serializeRecordingScope(recording.scope),
  }).catch((error) => {
    console.error('❌ [Recorder] Failed to upload recording_stopped:', error);
  });

  activeRecording = null;
}

export function getRecordingState(): {
  active: boolean;
  recording_id: string | null;
  scope: Record<string, unknown> | null;
} {
  return {
    active: activeRecording !== null,
    recording_id: activeRecording?.recordingId ?? null,
    scope: activeRecording ? serializeRecordingScope(activeRecording.scope) : null,
  };
}

export async function handleContentRecordingEvent(
  message: ContentRecordingEventMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const recording = activeRecording;
  if (!recording) {
    return;
  }

  const eventType = message.event?.type;
  if (!eventType) {
    return;
  }

  const tab = sender.tab;
  if (!tab || !isTabRelatedToRecordingScope(recording.scope, tab)) {
    return;
  }

  await addTabToRecordingScope(recording, tab);

  const eventData = await enrichEventDataWithKeyframe(recording, eventType, tab, {
    source: 'content',
    timestamp: message.event?.timestamp ?? Date.now(),
    frameId:
      typeof sender.frameId === 'number' ? sender.frameId : undefined,
    tab: serializeTab(tab),
    ...(message.event?.data ?? {}),
  });

  await postRecordingEventFor(recording, eventType, {
    ...eventData,
  });
}

export function initializeRecordingEventListeners(): void {
  if (listenersInitialized) {
    return;
  }
  listenersInitialized = true;

  chrome.tabs.onCreated.addListener((tab) => {
    const recording = activeRecording;
    if (!recording || !isTabRelatedToRecordingScope(recording.scope, tab)) {
      return;
    }

    void addTabToRecordingScope(recording, tab)
      .then(() => {
        if (isRecordableUrl(tab.url)) {
          postRecordingEvent('tab_created', serializeTab(tab));
        }
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to add created tab to scope:', error);
      });
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    const recording = activeRecording;
    if (!recording) {
      return;
    }

    void chrome.tabs
      .get(activeInfo.tabId)
      .then(async (tab) => {
        if (!isTabRelatedToRecordingScope(recording.scope, tab)) {
          return;
        }

        await addTabToRecordingScope(recording, tab);
        if (!isRecordableUrl(tab.url)) {
          return;
        }

        postRecordingEvent('tab_activated', serializeTab(tab));
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to read activated tab:', error);
      });
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const recording = activeRecording;
    if (
      !recording ||
      (!isTabIdInRecordingScope(recording.scope, tabId) &&
        recording.scope.windowId !== removeInfo.windowId)
    ) {
      return;
    }

    recording.scope.tabIds.delete(tabId);
    postRecordingEvent('tab_closed', {
      tabId,
      windowId: removeInfo.windowId,
      isWindowClosing: removeInfo.isWindowClosing,
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const recording = activeRecording;
    if (!recording || !isTabRelatedToRecordingScope(recording.scope, tab)) {
      return;
    }

    void addTabToRecordingScope(recording, tab)
      .then(() => {
        if (changeInfo.url && isRecordableUrl(changeInfo.url)) {
          postRecordingEvent('tab_navigated', serializeTab(tab, { tabId }));
        }

        if (changeInfo.status === 'complete' && isRecordableUrl(tab.url)) {
          void chrome.tabs
            .sendMessage(tabId, {
              type: 'openbrowser:start-recording',
              recording_id: recording.recordingId,
            })
            .catch(() => {
              // Ignore tabs that cannot receive content-script messages.
            });
          void enrichEventDataWithKeyframe(
            recording,
            'tab_ready',
            tab,
            serializeTab(tab, { tabId }),
          )
            .then((eventData) => {
              postRecordingEvent('tab_ready', eventData);
            })
            .catch((error) => {
              console.warn('⚠️ [Recorder] Failed to enrich tab_ready keyframe:', error);
              postRecordingEvent('tab_ready', serializeTab(tab, { tabId }));
            });
        }
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to update recording scope:', error);
      });
  });
}
