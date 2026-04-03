import { getOrCreateUUID } from '../uuid/uuidGenerator';

const SERVER_HTTP_URL = 'http://127.0.0.1:8765';

interface ActiveRecording {
  recordingId: string;
  startedAt: number;
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

async function broadcastRecordingStateMessage(
  message: Record<string, unknown>,
): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id && isRecordableUrl(tab.url))
      .map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id!, message);
        } catch {
          // Some pages cannot receive messages. Ignore and continue.
        }
      }),
  );
}

export async function startRecording(recordingId: string): Promise<void> {
  if (activeRecording?.recordingId === recordingId) {
    return;
  }

  activeRecording = {
    recordingId,
    startedAt: Date.now(),
  };

  await broadcastRecordingStateMessage({
    type: 'openbrowser:start-recording',
    recording_id: recordingId,
  });

  postRecordingEvent('recording_started', {
    startedAt: activeRecording.startedAt,
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

  await broadcastRecordingStateMessage({
    type: 'openbrowser:stop-recording',
    recording_id: recording.recordingId,
  });

  await postRecordingEventFor(recording, 'recording_stopped', {
    stoppedAt: Date.now(),
  }).catch((error) => {
    console.error('❌ [Recorder] Failed to upload recording_stopped:', error);
  });

  activeRecording = null;
}

export function getRecordingState(): {
  active: boolean;
  recording_id: string | null;
} {
  return {
    active: activeRecording !== null,
    recording_id: activeRecording?.recordingId ?? null,
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
  await postRecordingEventFor(recording, eventType, {
    source: 'content',
    timestamp: message.event?.timestamp ?? Date.now(),
    frameId:
      typeof sender.frameId === 'number' ? sender.frameId : undefined,
    tab: tab ? serializeTab(tab) : null,
    ...(message.event?.data ?? {}),
  });
}

export function initializeRecordingEventListeners(): void {
  if (listenersInitialized) {
    return;
  }
  listenersInitialized = true;

  chrome.tabs.onCreated.addListener((tab) => {
    if (!activeRecording || !isRecordableUrl(tab.url)) {
      return;
    }
    postRecordingEvent('tab_created', serializeTab(tab));
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!activeRecording) {
      return;
    }

    void chrome.tabs
      .get(activeInfo.tabId)
      .then((tab) => {
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
    if (!activeRecording) {
      return;
    }
    postRecordingEvent('tab_closed', {
      tabId,
      windowId: removeInfo.windowId,
      isWindowClosing: removeInfo.isWindowClosing,
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const recording = activeRecording;
    if (!recording) {
      return;
    }

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
  });
}
