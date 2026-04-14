import { getOrCreateUUID } from '../uuid/uuidGenerator';
import type { RecordingLaunchMode } from '../types';
import { captureScreenshot, compressIfNeeded } from '../commands/screenshot';
import { debuggerSessionManager } from '../commands/debugger-manager';
import { annotateRecordingKeyframe } from './keyframe-annotation';
import {
  getRecordingAfterKeyframeWaitForRender,
  getRecordingKeyframeCaptureOptions,
  getRecordingKeyframeWaitForRender,
  getRecordingPreActionCaptureOptions,
  getRecordingPreActionWaitForRender,
  isInputLikeRecordingTarget,
  shouldCaptureAfterKeyframe,
  shouldCaptureRecordingKeyframe,
  shouldDiscardPostCaptureRecordingKeyframe,
} from './keyframe-policy';

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';
const DEFAULT_RECORDING_LAUNCH_MODE: RecordingLaunchMode = 'dedicated_window';
const RECORDING_GROUP_TITLE_PREFIX = 'OpenBrowser Recording';
const RECORDING_GROUP_COLOR = 'grey' as chrome.tabGroups.Color;
const RECORDING_GROUP_COLLAPSED = false;
const RECORDING_KEYFRAME_THRESHOLD_BYTES = 1024 * 1024;
const RECORDING_KEYFRAME_MIN_QUALITY = 65;
const RECORDING_SCREENSHOT_CONVERSATION_PREFIX = 'recording';
const ACTIVE_RECORDING_STORAGE_KEY = 'openbrowser_active_recording';
const PRE_ACTION_KEYFRAME_TTL_MS = 1500;
const FOCUS_CLICK_DEDUP_WINDOW_MS = 220;
const INPUT_ENTER_DEDUP_WINDOW_MS = 240;

interface RecordingScope {
  launchMode: RecordingLaunchMode;
  windowId: number | null;
  groupId: number | null;
  tabIds: Set<number>;
}

interface TabNavigationHistory {
  entries: string[];
  index: number;
}

interface RecordingNavigationState {
  tabHistories: Map<number, TabNavigationHistory>;
}

interface ActiveRecording {
  recordingId: string;
  startedAt: number;
  scope: RecordingScope;
  navigation: RecordingNavigationState;
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
  navigation?: {
    tabHistories?: Array<{
      tabId: number;
      entries: string[];
      index: number;
    }>;
  } | null;
}

interface ContentRecordingEventMessage {
  type: 'openbrowser:recording-event';
  event?: {
    type?: string;
    data?: Record<string, unknown>;
    timestamp?: number;
  };
}

interface ContentRecordingPreActionMessage {
  type: 'openbrowser:recording-pre-action';
  preAction?: {
    actionType?: string;
    data?: Record<string, unknown>;
    timestamp?: number;
  };
}

type RecordingPreActionType = 'click' | 'enter';
type RecordingTabNavigationEventType =
  | 'tab_navigated'
  | 'tab_back'
  | 'tab_forward';

interface PendingPreActionKeyframe {
  recordingId: string;
  tabId: number;
  actionType: RecordingPreActionType;
  pageUrl: string | null;
  targetSignature: string | null;
  formSignature: string | null;
  createdAt: number;
  matchedEventTypes: Set<string>;
  keyframePromise: Promise<Record<string, unknown> | null>;
}

interface PendingFocusEvent {
  recordingId: string;
  tabId: number;
  targetSignature: string;
  timeoutId: number;
  tab: chrome.tabs.Tab;
  eventData: Record<string, unknown>;
}

interface PendingInputEvent {
  recordingId: string;
  tabId: number;
  targetSignature: string;
  tab: chrome.tabs.Tab;
  latestEventData: Record<string, unknown>;
  sourceEventCount: number;
  boundaryTimeoutId: number | null;
}

let activeRecording: ActiveRecording | null = null;
let listenersInitialized = false;
const pendingPreActionKeyframes = new Map<string, PendingPreActionKeyframe>();
const pendingFocusEvents = new Map<string, PendingFocusEvent>();
const pendingInputEvents = new Map<string, PendingInputEvent>();

function createEmptyRecordingNavigationState(): RecordingNavigationState {
  return {
    tabHistories: new Map<number, TabNavigationHistory>(),
  };
}

function getRecordingScreenshotConversationId(recordingId: string): string {
  return `${RECORDING_SCREENSHOT_CONVERSATION_PREFIX}:${recordingId}`;
}

function getPendingPreActionKey(
  recordingId: string,
  tabId: number,
  actionType: RecordingPreActionType,
): string {
  return `${recordingId}:${tabId}:${actionType}`;
}

function getPendingFocusKey(
  recordingId: string,
  tabId: number,
  targetSignature: string,
): string {
  return `${recordingId}:${tabId}:focus:${targetSignature}`;
}

function getPendingInputKey(
  recordingId: string,
  tabId: number,
  targetSignature: string,
): string {
  return `${recordingId}:${tabId}:input:${targetSignature}`;
}

function normalizeComparableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function pushSignaturePart(
  parts: string[],
  label: string,
  value: unknown,
): void {
  const normalized = normalizeComparableString(value);
  if (normalized) {
    parts.push(`${label}:${normalized}`);
  }
}

function pushRoundedSignaturePart(
  parts: string[],
  label: string,
  value: unknown,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }

  parts.push(`${label}:${Math.round(value)}`);
}

function buildSerializedElementSignature(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const element = value as Record<string, unknown>;
  const parts: string[] = [];

  pushSignaturePart(parts, 'tag', element.tagName);
  pushSignaturePart(parts, 'selector', element.selector);
  pushSignaturePart(parts, 'id', element.id);
  pushSignaturePart(parts, 'href', element.href);
  pushSignaturePart(parts, 'role', element.role);
  pushSignaturePart(parts, 'aria', element.ariaLabel);
  pushSignaturePart(parts, 'title', element.title);
  pushSignaturePart(parts, 'name', element.name);
  pushSignaturePart(parts, 'placeholder', element.placeholder);
  pushSignaturePart(parts, 'text', element.text);
  pushSignaturePart(parts, 'parentText', element.parentText);
  pushSignaturePart(parts, 'inputType', element.inputType);
  pushSignaturePart(parts, 'selectedText', element.selectedText);

  const container =
    element.container && typeof element.container === 'object'
      ? (element.container as Record<string, unknown>)
      : null;
  if (container) {
    pushSignaturePart(parts, 'containerKind', container.kind);
    pushSignaturePart(parts, 'containerSelector', container.selector);
    pushSignaturePart(parts, 'containerTitle', container.title);
    pushSignaturePart(parts, 'containerHref', container.href);
  }

  const bbox =
    element.bbox && typeof element.bbox === 'object'
      ? (element.bbox as Record<string, unknown>)
      : null;
  if (bbox) {
    pushRoundedSignaturePart(parts, 'x', bbox.x);
    pushRoundedSignaturePart(parts, 'y', bbox.y);
    pushRoundedSignaturePart(parts, 'w', bbox.width);
    pushRoundedSignaturePart(parts, 'h', bbox.height);
  }

  return parts.length > 0 ? parts.join('|') : null;
}

function getEventDataPageUrl(
  eventData: Record<string, unknown>,
): string | null {
  const page = eventData.page;
  if (page && typeof page === 'object') {
    const url = normalizeComparableString((page as { url?: unknown }).url);
    if (url) {
      return url;
    }
  }

  const tab = eventData.tab;
  if (tab && typeof tab === 'object') {
    return normalizeComparableString((tab as { url?: unknown }).url);
  }

  return null;
}

function getSupportedRecordingPreActionType(
  value: unknown,
): RecordingPreActionType | null {
  return value === 'click' || value === 'enter' ? value : null;
}

function getPreActionBindingType(
  eventType: string,
  eventData: Record<string, unknown>,
): RecordingPreActionType | null {
  if (eventType === 'click' || eventType === 'drag_and_drop') {
    return 'click';
  }

  if (eventType === 'focus') {
    return isInputLikeRecordingTarget(eventData.element) ? 'click' : null;
  }

  if (eventType === 'keydown') {
    return normalizeComparableString(eventData.key) === 'Enter'
      ? 'enter'
      : null;
  }

  if (eventType === 'submit') {
    return 'enter';
  }

  return null;
}

function getPreActionTargetSignatureForEvent(
  eventType: string,
  eventData: Record<string, unknown>,
): string | null {
  if (eventType === 'submit') {
    return buildSerializedElementSignature(eventData.form);
  }

  return buildSerializedElementSignature(eventData.element);
}

function getPreActionFormSignatureForEvent(
  eventData: Record<string, unknown>,
): string | null {
  return buildSerializedElementSignature(eventData.form);
}

function pruneExpiredPendingPreActionKeyframes(): void {
  const now = Date.now();
  for (const [key, pending] of pendingPreActionKeyframes.entries()) {
    if (now - pending.createdAt > PRE_ACTION_KEYFRAME_TTL_MS) {
      pendingPreActionKeyframes.delete(key);
    }
  }
}

function clearPendingPreActionKeyframesForRecording(recordingId: string): void {
  for (const [key, pending] of pendingPreActionKeyframes.entries()) {
    if (pending.recordingId === recordingId) {
      pendingPreActionKeyframes.delete(key);
    }
  }
}

function clearPendingFocusEventsForRecording(recordingId: string): void {
  for (const [key, pending] of pendingFocusEvents.entries()) {
    if (pending.recordingId === recordingId) {
      clearTimeout(pending.timeoutId);
      pendingFocusEvents.delete(key);
    }
  }
}

function clearPendingInputEventsForRecording(recordingId: string): void {
  for (const [key, pending] of pendingInputEvents.entries()) {
    if (pending.recordingId === recordingId) {
      if (pending.boundaryTimeoutId !== null) {
        clearTimeout(pending.boundaryTimeoutId);
      }
      pendingInputEvents.delete(key);
    }
  }
}

function clearPendingInputBoundaryTimer(pending: PendingInputEvent): void {
  if (pending.boundaryTimeoutId !== null) {
    clearTimeout(pending.boundaryTimeoutId);
    pending.boundaryTimeoutId = null;
  }
}

function serializeRecordingNavigationForStorage(
  navigation: RecordingNavigationState,
): {
  tabHistories: Array<{ tabId: number; entries: string[]; index: number }>;
} {
  return {
    tabHistories: Array.from(navigation.tabHistories.entries())
      .map(([tabId, history]) => ({
        tabId,
        entries: [...history.entries],
        index: history.index,
      }))
      .sort((left, right) => left.tabId - right.tabId),
  };
}

function deserializeRecordingNavigation(
  value: unknown,
): RecordingNavigationState {
  const navigation = createEmptyRecordingNavigationState();
  if (!value || typeof value !== 'object') {
    return navigation;
  }

  const rawTabHistories = (value as { tabHistories?: unknown }).tabHistories;
  if (!Array.isArray(rawTabHistories)) {
    return navigation;
  }

  for (const candidate of rawTabHistories) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const tabId = (candidate as { tabId?: unknown }).tabId;
    const entries = (candidate as { entries?: unknown }).entries;
    const index = (candidate as { index?: unknown }).index;
    if (
      typeof tabId !== 'number' ||
      !Array.isArray(entries) ||
      entries.some((entry) => typeof entry !== 'string') ||
      typeof index !== 'number'
    ) {
      continue;
    }

    if (!entries.length) {
      continue;
    }

    const boundedIndex = Math.max(0, Math.min(index, entries.length - 1));
    navigation.tabHistories.set(tabId, {
      entries: [...entries],
      index: boundedIndex,
    });
  }

  return navigation;
}

function ensureTabNavigationHistory(
  recording: ActiveRecording,
  tabId: number,
  url: string | null | undefined,
): boolean {
  if (typeof tabId !== 'number' || !isRecordableUrl(url)) {
    return false;
  }

  if (recording.navigation.tabHistories.has(tabId)) {
    return false;
  }

  recording.navigation.tabHistories.set(tabId, {
    entries: [url],
    index: 0,
  });
  return true;
}

function forgetTabNavigationHistory(
  recording: ActiveRecording,
  tabId: number,
): boolean {
  return recording.navigation.tabHistories.delete(tabId);
}

function classifyAndRecordTabNavigation(
  recording: ActiveRecording,
  tabId: number,
  nextUrl: string,
): {
  eventType: RecordingTabNavigationEventType;
  previousUrl: string | null;
} {
  const existingHistory = recording.navigation.tabHistories.get(tabId);
  if (!existingHistory) {
    recording.navigation.tabHistories.set(tabId, {
      entries: [nextUrl],
      index: 0,
    });
    return {
      eventType: 'tab_navigated',
      previousUrl: null,
    };
  }

  const previousUrl = existingHistory.entries[existingHistory.index] ?? null;
  if (previousUrl === nextUrl) {
    return {
      eventType: 'tab_navigated',
      previousUrl,
    };
  }

  const backUrl =
    existingHistory.index > 0
      ? (existingHistory.entries[existingHistory.index - 1] ?? null)
      : null;
  if (backUrl === nextUrl) {
    existingHistory.index -= 1;
    return {
      eventType: 'tab_back',
      previousUrl,
    };
  }

  const forwardUrl =
    existingHistory.index < existingHistory.entries.length - 1
      ? (existingHistory.entries[existingHistory.index + 1] ?? null)
      : null;
  if (forwardUrl === nextUrl) {
    existingHistory.index += 1;
    return {
      eventType: 'tab_forward',
      previousUrl,
    };
  }

  existingHistory.entries = existingHistory.entries.slice(
    0,
    existingHistory.index + 1,
  );
  existingHistory.entries.push(nextUrl);
  existingHistory.index = existingHistory.entries.length - 1;
  return {
    eventType: 'tab_navigated',
    previousUrl,
  };
}

function isTextEntryRecordingTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const target = value as Record<string, unknown>;
  const tagName = normalizeComparableString(target.tagName)?.toLowerCase();
  const role = normalizeComparableString(target.role)?.toLowerCase();
  const inputType = normalizeComparableString(target.inputType)?.toLowerCase();

  if (tagName === 'textarea' || role === 'textbox' || role === 'searchbox') {
    return true;
  }

  if (tagName !== 'input') {
    return false;
  }

  return !new Set([
    'button',
    'submit',
    'reset',
    'checkbox',
    'radio',
    'file',
    'range',
    'color',
    'image',
  ]).has(inputType ?? '');
}

function getInputAggregationBoundaryReason(
  eventType: string,
  eventData: Record<string, unknown>,
): string {
  if (eventType === 'keydown') {
    return normalizeComparableString(eventData.key)?.toLowerCase() ?? 'keydown';
  }

  return eventType;
}

function getEventDataTabId(eventData: Record<string, unknown>): number | null {
  if (typeof eventData.tabId === 'number') {
    return eventData.tabId;
  }

  const tab = eventData.tab;
  if (tab && typeof tab === 'object') {
    const tabId = (tab as { tabId?: unknown }).tabId;
    if (typeof tabId === 'number') {
      return tabId;
    }
  }

  return null;
}

function bufferPendingInputEvent(
  recording: ActiveRecording,
  tab: chrome.tabs.Tab,
  eventData: Record<string, unknown>,
): boolean {
  if (!tab.id || !isTextEntryRecordingTarget(eventData.element)) {
    return false;
  }

  const targetSignature = buildSerializedElementSignature(eventData.element);
  if (!targetSignature) {
    return false;
  }

  const key = getPendingInputKey(
    recording.recordingId,
    tab.id,
    targetSignature,
  );
  const existing = pendingInputEvents.get(key);
  if (existing) {
    clearPendingInputBoundaryTimer(existing);
    existing.latestEventData = eventData;
    existing.tab = tab;
    existing.sourceEventCount += 1;
    pendingInputEvents.set(key, existing);
    return true;
  }

  pendingInputEvents.set(key, {
    recordingId: recording.recordingId,
    tabId: tab.id,
    targetSignature,
    tab,
    latestEventData: eventData,
    sourceEventCount: 1,
    boundaryTimeoutId: null,
  });
  return true;
}

async function flushPendingInputEventsForTab(
  recording: ActiveRecording,
  tabId: number,
  endedBy: string,
): Promise<number> {
  const matches = Array.from(pendingInputEvents.entries()).filter(
    ([, pending]) =>
      pending.recordingId === recording.recordingId && pending.tabId === tabId,
  );

  if (!matches.length) {
    return 0;
  }

  matches.sort(([, left], [, right]) => {
    const leftTimestamp =
      typeof left.latestEventData.timestamp === 'number'
        ? left.latestEventData.timestamp
        : 0;
    const rightTimestamp =
      typeof right.latestEventData.timestamp === 'number'
        ? right.latestEventData.timestamp
        : 0;
    return leftTimestamp - rightTimestamp;
  });

  for (const [key, pending] of matches) {
    clearPendingInputBoundaryTimer(pending);
    pendingInputEvents.delete(key);
    await postRecordingEventFor(recording, 'input', {
      ...pending.latestEventData,
      inputAggregation: {
        sourceEventCount: pending.sourceEventCount,
        endedBy,
      },
    });
  }

  return matches.length;
}

function hasPendingInputForTarget(
  recording: ActiveRecording,
  tabId: number,
  targetSignature: string | null,
): boolean {
  if (!targetSignature) {
    return false;
  }

  return pendingInputEvents.has(
    getPendingInputKey(recording.recordingId, tabId, targetSignature),
  );
}

function shouldIgnoreInteractionAsTypingBoundary(
  recording: ActiveRecording,
  tabId: number,
  eventData: Record<string, unknown>,
): boolean {
  const targetSignature = buildSerializedElementSignature(eventData.element);
  return hasPendingInputForTarget(recording, tabId, targetSignature);
}

function schedulePendingInputBoundaryFlush(
  recording: ActiveRecording,
  tab: chrome.tabs.Tab,
  eventData: Record<string, unknown>,
  endedBy: string,
  delayMs: number,
): boolean {
  if (!tab.id) {
    return false;
  }

  const targetSignature = buildSerializedElementSignature(eventData.element);
  if (!targetSignature) {
    return false;
  }

  const key = getPendingInputKey(
    recording.recordingId,
    tab.id,
    targetSignature,
  );
  const pending = pendingInputEvents.get(key);
  if (!pending) {
    return false;
  }

  clearPendingInputBoundaryTimer(pending);
  pending.boundaryTimeoutId = globalThis.setTimeout(() => {
    void flushPendingInputEventsForTab(recording, tab.id!, endedBy).catch(
      (error) => {
        console.error(
          `❌ [Recorder] Failed to flush buffered input events for delayed ${endedBy}:`,
          error,
        );
      },
    );
  }, delayMs);
  pendingInputEvents.set(key, pending);
  return true;
}

async function flushPendingInputEventsForRecording(
  recording: ActiveRecording,
  endedBy: string,
): Promise<void> {
  const tabIds = new Set<number>();
  for (const pending of pendingInputEvents.values()) {
    if (pending.recordingId === recording.recordingId) {
      tabIds.add(pending.tabId);
    }
  }

  for (const tabId of tabIds) {
    await flushPendingInputEventsForTab(recording, tabId, endedBy);
  }
}

async function flushPendingInputEventsBeforeLifecycleEvent(
  recording: ActiveRecording,
  eventType: string,
  eventData: Record<string, unknown>,
): Promise<void> {
  if (
    !new Set([
      'tab_activated',
      'tab_closed',
      'tab_navigated',
      'tab_back',
      'tab_forward',
    ]).has(eventType)
  ) {
    return;
  }

  const tabId = getEventDataTabId(eventData);
  if (typeof tabId !== 'number') {
    return;
  }

  if (
    eventType === 'tab_navigated' ||
    eventType === 'tab_back' ||
    eventType === 'tab_forward'
  ) {
    const nextUrl = getEventDataPageUrl(eventData);
    const pendingForTab = Array.from(pendingInputEvents.values()).filter(
      (pending) =>
        pending.recordingId === recording.recordingId &&
        pending.tabId === tabId,
    );
    const shouldFlush = pendingForTab.some((pending) => {
      const pendingUrl = getEventDataPageUrl(pending.latestEventData);
      return Boolean(nextUrl && pendingUrl && nextUrl !== pendingUrl);
    });

    if (!shouldFlush) {
      return;
    }
  }

  await flushPendingInputEventsForTab(recording, tabId, eventType);
}

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

function serializeRecordingScope(
  scope: RecordingScope,
): Record<string, unknown> {
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
    navigation: serializeRecordingNavigationForStorage(recording.navigation),
  };
}

function deserializeRecordingScope(value: unknown): RecordingScope | null {
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
    scope.launchMode === 'current_window'
      ? 'current_window'
      : 'dedicated_window';
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
    navigation: deserializeRecordingNavigation(raw.navigation),
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
    console.warn(
      '⚠️ [Recorder] Failed to restore active recording state:',
      error,
    );
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
    .then(async (recording) => {
      if (!recording) {
        return;
      }

      await flushPendingInputEventsBeforeLifecycleEvent(
        recording,
        eventType,
        eventData,
      );
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
  captureOptions = getRecordingKeyframeCaptureOptions(),
): Promise<Record<string, unknown> | null> {
  const conversationId = getRecordingScreenshotConversationId(recordingId);
  try {
    const screenshotResult = await captureScreenshot(
      tabId,
      conversationId,
      false,
      80,
      false,
      waitForRender,
      captureOptions,
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
    console.warn(
      `⚠️ [Recorder] Failed to capture keyframe for ${trigger}:`,
      error,
    );
    return null;
  } finally {
    await debuggerSessionManager
      .cleanupSession(conversationId)
      .catch((error) => {
        console.warn(
          `⚠️ [Recorder] Failed to cleanup debugger session for recording ${recordingId}:`,
          error,
        );
      });
  }
}

async function attachRecordingKeyframeToEventData(
  eventType: string,
  eventData: Record<string, unknown>,
  keyframe: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const annotation = await annotateRecordingKeyframe({
    imageData: String(keyframe.imageData || ''),
    eventType,
    eventData,
    viewportWidth:
      typeof keyframe.viewportWidth === 'number'
        ? keyframe.viewportWidth
        : null,
    viewportHeight:
      typeof keyframe.viewportHeight === 'number'
        ? keyframe.viewportHeight
        : null,
  }).catch((error) => {
    console.warn(
      `⚠️ [Recorder] Failed to annotate ${eventType} keyframe:`,
      error,
    );
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

function matchesPendingPreActionKeyframe(
  pending: PendingPreActionKeyframe,
  eventType: string,
  eventData: Record<string, unknown>,
): boolean {
  const pageUrl = getEventDataPageUrl(eventData);
  if (pending.pageUrl && pageUrl && pending.pageUrl !== pageUrl) {
    return false;
  }

  const targetSignature = getPreActionTargetSignatureForEvent(
    eventType,
    eventData,
  );
  const formSignature = getPreActionFormSignatureForEvent(eventData);

  if (eventType === 'submit') {
    if (pending.formSignature && formSignature) {
      return pending.formSignature === formSignature;
    }

    if (pending.targetSignature && targetSignature) {
      return pending.targetSignature === targetSignature;
    }

    return true;
  }

  if (pending.targetSignature && targetSignature) {
    return pending.targetSignature === targetSignature;
  }

  if (pending.formSignature && formSignature) {
    return pending.formSignature === formSignature;
  }

  return true;
}

async function consumePendingPreActionKeyframe(
  recording: ActiveRecording,
  eventType: string,
  tabId: number,
  eventData: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  pruneExpiredPendingPreActionKeyframes();

  const actionType = getPreActionBindingType(eventType, eventData);
  if (!actionType) {
    return null;
  }

  const key = getPendingPreActionKey(recording.recordingId, tabId, actionType);
  const pending = pendingPreActionKeyframes.get(key);
  if (!pending || pending.matchedEventTypes.has(eventType)) {
    return null;
  }

  if (!matchesPendingPreActionKeyframe(pending, eventType, eventData)) {
    return null;
  }

  pending.matchedEventTypes.add(eventType);
  if (!(pending.actionType === 'enter' && eventType === 'keydown')) {
    pendingPreActionKeyframes.delete(key);
  }

  const keyframe = await pending.keyframePromise;
  if (!keyframe) {
    pendingPreActionKeyframes.delete(key);
    return null;
  }

  return {
    ...keyframe,
    captureTiming: 'pre_action',
    preActionType: pending.actionType,
  };
}

async function flushPendingFocusEvent(key: string): Promise<void> {
  const pending = pendingFocusEvents.get(key);
  if (!pending) {
    return;
  }

  pendingFocusEvents.delete(key);

  const recording = await getActiveRecording();
  if (!recording || recording.recordingId !== pending.recordingId) {
    return;
  }

  try {
    const eventData = await enrichEventDataWithKeyframe(
      recording,
      'focus',
      pending.tab,
      pending.eventData,
    );
    await postRecordingEventFor(recording, 'focus', {
      ...eventData,
    });
  } catch (error) {
    console.error(
      '❌ [Recorder] Failed to upload buffered focus event:',
      error,
    );
  }
}

function schedulePendingFocusEvent(
  recording: ActiveRecording,
  tab: chrome.tabs.Tab,
  eventData: Record<string, unknown>,
): boolean {
  if (!tab.id || !isInputLikeRecordingTarget(eventData.element)) {
    return false;
  }

  const targetSignature = buildSerializedElementSignature(eventData.element);
  if (!targetSignature) {
    return false;
  }

  const key = getPendingFocusKey(
    recording.recordingId,
    tab.id,
    targetSignature,
  );
  const existing = pendingFocusEvents.get(key);
  if (existing) {
    clearTimeout(existing.timeoutId);
    pendingFocusEvents.delete(key);
  }

  const timeoutId = globalThis.setTimeout(() => {
    void flushPendingFocusEvent(key);
  }, FOCUS_CLICK_DEDUP_WINDOW_MS);

  pendingFocusEvents.set(key, {
    recordingId: recording.recordingId,
    tabId: tab.id,
    targetSignature,
    timeoutId,
    tab,
    eventData,
  });

  return true;
}

function cancelDuplicatePendingFocusEvent(
  recording: ActiveRecording,
  tabId: number,
  eventType: string,
  eventData: Record<string, unknown>,
): void {
  if (eventType !== 'click') {
    return;
  }

  const targetSignature = buildSerializedElementSignature(eventData.element);
  if (!targetSignature) {
    return;
  }

  const key = getPendingFocusKey(recording.recordingId, tabId, targetSignature);
  const pending = pendingFocusEvents.get(key);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingFocusEvents.delete(key);
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

  if (tab.id) {
    const preActionKeyframe = await consumePendingPreActionKeyframe(
      recording,
      eventType,
      tab.id,
      eventData,
    );
    if (preActionKeyframe) {
      const withBefore = await attachRecordingKeyframeToEventData(
        eventType,
        eventData,
        preActionKeyframe,
      );
      return attachAfterKeyframeIfApplicable(
        recording,
        eventType,
        tab,
        withBefore,
      );
    }
  }

  if (
    !shouldCaptureRecordingKeyframe(eventType, eventData) ||
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

  if (
    shouldDiscardPostCaptureRecordingKeyframe(eventType, eventData, keyframe)
  ) {
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

  // Fallback path (no pre-action keyframe): the captured keyframe already
  // reflects post-action state, so we don't capture an additional keyframeAfter.
  return attachRecordingKeyframeToEventData(eventType, eventData, keyframe);
}

async function attachAfterKeyframeIfApplicable(
  recording: ActiveRecording,
  eventType: string,
  tab: chrome.tabs.Tab,
  eventData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!tab.id || !shouldCaptureAfterKeyframe(eventType)) {
    return eventData;
  }

  const afterKeyframe = await buildRecordingKeyframe(
    tab.id,
    recording.recordingId,
    `after_${eventType}`,
    getRecordingAfterKeyframeWaitForRender(),
  );
  if (!afterKeyframe) {
    return eventData;
  }

  // Intentionally do NOT run shouldDiscardPostCaptureRecordingKeyframe: clicks
  // that navigate are expected to land on a new URL, and the destination page
  // is precisely what we want the compiler to see.
  afterKeyframe.annotationMessage = `Page state immediately after the ${eventType} action.`;
  return {
    ...eventData,
    keyframeAfter: afterKeyframe,
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
  ensureTabNavigationHistory(recording, tab.id, tab.url);
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
    throw new Error(
      'Failed to create initial tab for dedicated recording window',
    );
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
    throw new Error(
      'Failed to resolve the focused browser window for recording',
    );
  }

  const tabs =
    focusedWindow.tabs ??
    (await chrome.tabs.query({ windowId: focusedWindow.id }));
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

  if (scope.launchMode !== 'dedicated_window' || scope.windowId === null) {
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
    navigation: createEmptyRecordingNavigationState(),
  };

  for (const tabId of recording.scope.tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      ensureTabNavigationHistory(recording, tabId, tab.url);
    } catch {
      // Ignore tabs that disappear during recording bootstrap.
    }
  }

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

  await flushPendingInputEventsForRecording(
    recording,
    'recording_stopped',
  ).catch((error) => {
    console.error(
      '❌ [Recorder] Failed to flush buffered input events before stop:',
      error,
    );
  });

  await postRecordingEventFor(recording, 'recording_stopped', {
    stoppedAt: Date.now(),
    scope: serializeRecordingScope(recording.scope),
  }).catch((error) => {
    console.error('❌ [Recorder] Failed to upload recording_stopped:', error);
  });

  await debuggerSessionManager
    .cleanupSession(getRecordingScreenshotConversationId(recording.recordingId))
    .catch((error) => {
      console.warn(
        `⚠️ [Recorder] Failed to cleanup final debugger session for recording ${recording.recordingId}:`,
        error,
      );
    });

  clearPendingPreActionKeyframesForRecording(recording.recordingId);
  clearPendingFocusEventsForRecording(recording.recordingId);
  clearPendingInputEventsForRecording(recording.recordingId);
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

export async function handleContentRecordingPreAction(
  message: ContentRecordingPreActionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const recording = await getActiveRecording();
  if (!recording) {
    return;
  }

  const actionType = getSupportedRecordingPreActionType(
    message.preAction?.actionType,
  );
  if (!actionType) {
    return;
  }

  const tab = sender.tab;
  if (!tab?.id || !isTabRelatedToRecordingScope(recording.scope, tab)) {
    return;
  }

  if (!isRecordableUrl(tab.url)) {
    return;
  }

  void addTabToRecordingScope(recording, tab).catch((error) => {
    console.warn('⚠️ [Recorder] Failed to add pre-action tab to scope:', error);
  });

  pruneExpiredPendingPreActionKeyframes();

  const preActionData: Record<string, unknown> = {
    source: 'content',
    timestamp: message.preAction?.timestamp ?? Date.now(),
    frameId: typeof sender.frameId === 'number' ? sender.frameId : undefined,
    tab: serializeTab(tab),
    ...(message.preAction?.data ?? {}),
  };

  pendingPreActionKeyframes.set(
    getPendingPreActionKey(recording.recordingId, tab.id, actionType),
    {
      recordingId: recording.recordingId,
      tabId: tab.id,
      actionType,
      pageUrl: getEventDataPageUrl(preActionData),
      targetSignature: buildSerializedElementSignature(preActionData.element),
      formSignature: buildSerializedElementSignature(preActionData.form),
      createdAt: Date.now(),
      matchedEventTypes: new Set<string>(),
      keyframePromise: buildRecordingKeyframe(
        tab.id,
        recording.recordingId,
        `pre_${actionType}`,
        getRecordingPreActionWaitForRender(),
        getRecordingPreActionCaptureOptions(),
      ),
    },
  );
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
  const eventData: Record<string, unknown> = {
    source: 'content',
    timestamp: message.event?.timestamp ?? Date.now(),
    frameId: typeof sender.frameId === 'number' ? sender.frameId : undefined,
    tab: serializeTab(tab),
    ...(message.event?.data ?? {}),
  };

  if (
    eventType === 'input' &&
    bufferPendingInputEvent(recording, tab, eventData)
  ) {
    return;
  }

  if (tab.id) {
    if (
      eventType === 'change' &&
      isTextEntryRecordingTarget(eventData.element)
    ) {
      const flushedCount = await flushPendingInputEventsForTab(
        recording,
        tab.id,
        'change',
      );
      if (flushedCount > 0) {
        return;
      }
    } else if (eventType === 'keydown') {
      const key = normalizeComparableString(eventData.key);
      if (key === 'Enter') {
        schedulePendingInputBoundaryFlush(
          recording,
          tab,
          eventData,
          'enter',
          INPUT_ENTER_DEDUP_WINDOW_MS,
        );
      } else if (key === 'Tab') {
        await flushPendingInputEventsForTab(recording, tab.id, 'tab');
      }
    } else if (eventType === 'submit' || eventType === 'scroll') {
      await flushPendingInputEventsForTab(
        recording,
        tab.id,
        getInputAggregationBoundaryReason(eventType, eventData),
      );
    } else if (
      new Set(['click', 'focus']).has(eventType) &&
      !shouldIgnoreInteractionAsTypingBoundary(recording, tab.id, eventData)
    ) {
      await flushPendingInputEventsForTab(
        recording,
        tab.id,
        getInputAggregationBoundaryReason(eventType, eventData),
      );
    }
  }

  if (
    eventType === 'focus' &&
    schedulePendingFocusEvent(recording, tab, eventData)
  ) {
    return;
  }

  if (tab.id) {
    cancelDuplicatePendingFocusEvent(recording, tab.id, eventType, eventData);
  }

  const enrichedEventData = await enrichEventDataWithKeyframe(
    recording,
    eventType,
    tab,
    eventData,
  );

  await postRecordingEventFor(recording, eventType, {
    ...enrichedEventData,
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
        console.warn(
          '⚠️ [Recorder] Failed to add created tab to scope:',
          error,
        );
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
        forgetTabNavigationHistory(recording, tabId);
        await persistActiveRecording(recording);
        postRecordingEvent('tab_closed', {
          tabId,
          windowId: removeInfo.windowId,
          isWindowClosing: removeInfo.isWindowClosing,
        });
      })
      .catch((error) => {
        console.warn(
          '⚠️ [Recorder] Failed to update removed tab state:',
          error,
        );
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
          const { eventType, previousUrl } = classifyAndRecordTabNavigation(
            recording,
            tabId,
            changeInfo.url,
          );
          await persistActiveRecording(recording);
          postRecordingEvent(
            eventType,
            serializeTab(tab, {
              tabId,
              previousUrl,
            }),
          );
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

export const __testing__ = {
  classifyAndRecordTabNavigation,
  buildSerializedElementSignature,
  clearPendingPreActionKeyframes(): void {
    pendingPreActionKeyframes.clear();
  },
  clearPendingInputEvents(): void {
    clearPendingInputEventsForRecording(activeRecording?.recordingId ?? '');
  },
  async flushPendingInputEventsBeforeLifecycleEvent(
    recording: ActiveRecording,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    await flushPendingInputEventsBeforeLifecycleEvent(
      recording,
      eventType,
      eventData,
    );
  },
  setPendingPreActionKeyframe(
    recordingId: string,
    tabId: number,
    actionType: RecordingPreActionType,
    value: {
      pageUrl?: string | null;
      targetSignature?: string | null;
      formSignature?: string | null;
      createdAt?: number;
      keyframe?:
        | Record<string, unknown>
        | Promise<Record<string, unknown> | null>
        | null;
    },
  ): void {
    pendingPreActionKeyframes.set(
      getPendingPreActionKey(recordingId, tabId, actionType),
      {
        recordingId,
        tabId,
        actionType,
        pageUrl: value.pageUrl ?? null,
        targetSignature: value.targetSignature ?? null,
        formSignature: value.formSignature ?? null,
        createdAt: value.createdAt ?? Date.now(),
        matchedEventTypes: new Set<string>(),
        keyframePromise: Promise.resolve(value.keyframe ?? null),
      },
    );
  },
};
