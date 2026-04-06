import { getOrCreateUUID } from '../uuid/uuidGenerator';
import type { RecordingLaunchMode } from '../types';
import { captureScreenshot, compressIfNeeded } from '../commands/screenshot';
import { annotateRecordingKeyframe } from './keyframe-annotation';
import {
  getRecordingKeyframeCaptureOptions,
  getRecordingKeyframeWaitForRender,
  shouldCaptureRecordingKeyframe,
  shouldDiscardPostCaptureRecordingKeyframe,
} from './keyframe-policy';

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';
const DEFAULT_RECORDING_LAUNCH_MODE: RecordingLaunchMode = 'dedicated_window';
const RECORDING_GROUP_TITLE_PREFIX = 'OpenBrowser Recording';
const RECORDING_GROUP_COLOR = 'grey' as chrome.tabGroups.Color;
const RECORDING_GROUP_COLLAPSED = false;
const RECORDING_KEYFRAME_THRESHOLD_BYTES = 380 * 1024;
const RECORDING_KEYFRAME_MIN_QUALITY = 40;
const RECORDING_SCREENSHOT_CONVERSATION_PREFIX = 'recording';
const ACTIVE_RECORDING_STORAGE_KEY = 'openbrowser_active_recording';

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

interface PersistedRecordingScope {
  launchMode: RecordingLaunchMode;
  windowId: number | null;
  groupId: number | null;
  tabIds: number[];
}

interface PersistedActiveRecording {
  recordingId: string;
  startedAt: number;
  scope: PersistedRecordingScope;
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

function serializeRecordingScopeForStorage(
  scope: RecordingScope,
): PersistedRecordingScope {
  return {
    launchMode: scope.launchMode,
    windowId: scope.windowId,
    groupId: scope.groupId,
    tabIds: Array.from(scope.tabIds.values()).sort((a, b) => a - b),
  };
}

function serializeActiveRecordingForStorage(
  recording: ActiveRecording,
): PersistedActiveRecording {
  return {
    recordingId: recording.recordingId,
    startedAt: recording.startedAt,
    scope: serializeRecordingScopeForStorage(recording.scope),
  };
}

function deserializeRecordingScope(
  value: unknown,
): RecordingScope | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const scope = value as {
    launchMode?: unknown;
    windowId?: unknown;
    groupId?: unknown;
    tabIds?: unknown;
  };
  const launchMode =
    scope.launchMode === 'current_window' ? 'current_window' : 'dedicated_window';
  const tabIds = Array.isArray(scope.tabIds)
    ? scope.tabIds.filter((tabId): tabId is number => typeof tabId === 'number')
    : [];

  return {
    launchMode,
    windowId: typeof scope.windowId === 'number' ? scope.windowId : null,
    groupId: typeof scope.groupId === 'number' ? scope.groupId : null,
    tabIds: new Set(tabIds),
  };
}

function deserializeActiveRecording(value: unknown): ActiveRecording | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as {
    recordingId?: unknown;
    startedAt?: unknown;
    scope?: unknown;
  };
  if (
    typeof raw.recordingId !== 'string' ||
    typeof raw.startedAt !== 'number'
  ) {
    return null;
  }

  const scope = deserializeRecordingScope(raw.scope);
  if (!scope) {
    return null;
  }

  return {
    recordingId: raw.recordingId,
    startedAt: raw.startedAt,
    scope,
  };
}

async function persistActiveRecording(
  recording: ActiveRecording | null,
): Promise<void> {
  await chrome.storage.local.set({
    [ACTIVE_RECORDING_STORAGE_KEY]: recording
      ? serializeActiveRecordingForStorage(recording)
      : null,
  });
}

async function loadActiveRecordingFromStorage(): Promise<ActiveRecording | null> {
  try {
    const stored = await chrome.storage.local.get(ACTIVE_RECORDING_STORAGE_KEY);
    const restored = deserializeActiveRecording(
      stored?.[ACTIVE_RECORDING_STORAGE_KEY],
    );
    activeRecording = restored;
    return restored;
  } catch (error) {
    console.warn('⚠️ [Recorder] Failed to restore active recording state:', error);
    activeRecording = null;
    return null;
  }
}

async function getActiveRecording(): Promise<ActiveRecording | null> {
  if (activeRecording) {
    return activeRecording;
  }

  return loadActiveRecordingFromStorage();
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
  void getActiveRecording()
    .then((recording) => {
      if (!recording) {
        return;
      }

      return postRecordingEventFor(recording, eventType, eventData);
    })
    .catch((error) => {
      console.error(`❌ [Recorder] Failed to upload ${eventType}:`, error);
    });
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
      getRecordingKeyframeCaptureOptions(),
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
      viewportWidth: metadata.viewportWidth ?? null,
      viewportHeight: metadata.viewportHeight ?? null,
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
  // into the top-left corner. Keep page_view as a lifecycle signal only.
  if (eventType === 'page_view') {
    return eventData;
  }

  if (
    !shouldCaptureRecordingKeyframe(eventType) ||
    !tab.id ||
    !isRecordableUrl(tab.url)
  ) {
    return eventData;
  }

  const keyframe = await buildRecordingKeyframe(
    tab.id,
    recording.recordingId,
    eventType,
    getRecordingKeyframeWaitForRender(eventType),
  );
  if (!keyframe) {
    return eventData;
  }

  if (shouldDiscardPostCaptureRecordingKeyframe(eventType, eventData, keyframe)) {
    console.warn(
      `⚠️ [Recorder] Discarding ${eventType} keyframe because capture drifted to another page`,
      {
        tabId: tab.id,
        eventUrl:
          (eventData.page &&
          typeof eventData.page === 'object' &&
          'url' in eventData.page
            ? (eventData.page as { url?: unknown }).url
            : undefined) ??
          (eventData.tab &&
          typeof eventData.tab === 'object' &&
          'url' in eventData.tab
            ? (eventData.tab as { url?: unknown }).url
            : undefined) ??
          null,
        capturedUrl: keyframe.url ?? null,
      },
    );
    return eventData;
  }

  const annotation = await annotateRecordingKeyframe({
    imageData: String(keyframe.imageData || ''),
    eventType,
    eventData,
    viewportWidth:
      typeof keyframe.viewportWidth === 'number' ? keyframe.viewportWidth : null,
    viewportHeight:
      typeof keyframe.viewportHeight === 'number'
        ? keyframe.viewportHeight
        : null,
  }).catch((error) => {
    console.warn(`⚠️ [Recorder] Failed to annotate ${eventType} keyframe:`, error);
    return null;
  });

  const annotatedKeyframe = annotation
    ? {
        ...keyframe,
        imageData: annotation.imageData,
        annotationMessage: annotation.annotationMessage,
      }
    : keyframe;

  return {
    ...eventData,
    keyframe: annotatedKeyframe,
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
  await persistActiveRecording(recording);
}

async function createDedicatedWindowScope(
  recordingId: string,
): Promise<RecordingScope> {
  const createdWindow = await chrome.windows.create({
    focused: true,
  });

  const windowId = createdWindow?.id;
  if (typeof windowId !== 'number') {
    throw new Error('Failed to create dedicated recording window');
  }

  const initialTab =
    createdWindow?.tabs?.find((tab) => typeof tab.id === 'number') ??
    (await chrome.tabs.query({ windowId }))[0];

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
      createProperties: { windowId },
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
    windowId,
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
  const tabs =
    recording.scope.windowId !== null
      ? await chrome.tabs.query({ windowId: recording.scope.windowId })
      : await Promise.all(
          Array.from(recording.scope.tabIds.values()).map(async (tabId) => {
            try {
              return await chrome.tabs.get(tabId);
            } catch {
              return null;
            }
          }),
        );

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab?.id) {
        return;
      }

      try {
        if (!isRecordableUrl(tab.url)) {
          return;
        }
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Some pages cannot receive messages or the tab may have been removed.
      }
    }),
  );
}

async function cleanupRecordingTabGroup(scope: RecordingScope): Promise<void> {
  if (!chrome.tabGroups || scope.groupId === null) {
    return;
  }

  try {
    const tabsInWindow =
      scope.windowId !== null
        ? await chrome.tabs.query({ windowId: scope.windowId })
        : await chrome.tabs.query({});

    const groupedTabIds = tabsInWindow
      .filter(
        (tab): tab is chrome.tabs.Tab & { id: number } =>
          typeof tab.id === 'number' && tab.groupId === scope.groupId,
      )
      .map((tab) => tab.id);

    if (groupedTabIds.length === 0) {
      return;
    }

    const [firstTabId, ...otherTabIds] = groupedTabIds;
    await chrome.tabs.ungroup([firstTabId, ...otherTabIds]);
  } catch (error) {
    console.warn(
      `⚠️ [Recorder] Failed to ungroup recording tab group ${scope.groupId}:`,
      error,
    );
  }
}

async function cleanupRecordingScope(scope: RecordingScope): Promise<void> {
  await cleanupRecordingTabGroup(scope);

  if (
    scope.launchMode !== 'dedicated_window' ||
    scope.windowId === null
  ) {
    return;
  }

  try {
    await chrome.windows.remove(scope.windowId);
  } catch (error) {
    console.warn(
      `⚠️ [Recorder] Failed to close dedicated recording window ${scope.windowId}:`,
      error,
    );
  }
}

export async function startRecording(
  recordingId: string,
  launchMode?: RecordingLaunchMode,
): Promise<void> {
  const existingRecording = await getActiveRecording();
  if (existingRecording?.recordingId === recordingId) {
    return;
  }

  const scope = await createRecordingScope(recordingId, launchMode);
  const recording: ActiveRecording = {
    recordingId,
    startedAt: Date.now(),
    scope,
  };

  activeRecording = recording;
  await persistActiveRecording(recording);

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
  const recording = await getActiveRecording();
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

  await cleanupRecordingScope(recording.scope);
  activeRecording = null;
  await persistActiveRecording(null);
}

export async function getRecordingState(): Promise<{
  active: boolean;
  recording_id: string | null;
  scope: Record<string, unknown> | null;
}> {
  const recording = await getActiveRecording();
  return {
    active: recording !== null,
    recording_id: recording?.recordingId ?? null,
    scope: recording ? serializeRecordingScope(recording.scope) : null,
  };
}

export async function handleContentRecordingEvent(
  message: ContentRecordingEventMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const recording = await getActiveRecording();
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
    void getActiveRecording()
      .then(async (recording) => {
        if (!recording || !isTabRelatedToRecordingScope(recording.scope, tab)) {
          return;
        }

        await addTabToRecordingScope(recording, tab);
        if (isRecordableUrl(tab.url)) {
          postRecordingEvent('tab_created', serializeTab(tab));
        }
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to add created tab to scope:', error);
      });
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    void getActiveRecording()
      .then((recording) => {
        if (!recording) {
          return;
        }

        return chrome.tabs.get(activeInfo.tabId).then(async (tab) => {
          if (!isTabRelatedToRecordingScope(recording.scope, tab)) {
            return;
          }

          await addTabToRecordingScope(recording, tab);
          if (!isRecordableUrl(tab.url)) {
            return;
          }

          postRecordingEvent('tab_activated', serializeTab(tab));
        });
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to read activated tab:', error);
      });
  });

  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    void getActiveRecording()
      .then(async (recording) => {
        if (
          !recording ||
          (!isTabIdInRecordingScope(recording.scope, tabId) &&
            recording.scope.windowId !== removeInfo.windowId)
        ) {
          return;
        }

        recording.scope.tabIds.delete(tabId);
        await persistActiveRecording(recording);
        postRecordingEvent('tab_closed', {
          tabId,
          windowId: removeInfo.windowId,
          isWindowClosing: removeInfo.isWindowClosing,
        });
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to update removed tab state:', error);
      });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void getActiveRecording()
      .then(async (recording) => {
        if (!recording || !isTabRelatedToRecordingScope(recording.scope, tab)) {
          return;
        }

        await addTabToRecordingScope(recording, tab);
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
          postRecordingEvent('tab_ready', serializeTab(tab, { tabId }));
        }
      })
      .catch((error) => {
        console.warn('⚠️ [Recorder] Failed to update recording scope:', error);
      });
  });
}
