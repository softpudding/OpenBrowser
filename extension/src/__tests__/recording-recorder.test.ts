import { beforeEach, describe, expect, mock, test } from 'bun:test';

describe('recording recorder cleanup', () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    const storageState: Record<string, unknown> = {
      openbrowser_browser_uuid: 'browser-uuid-1',
      openbrowser_active_recording: null,
    };
    const tabsQuery = mock(async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.windowId === 701) {
        return [
          {
            id: 11,
            windowId: 701,
            groupId: 88,
            url: 'https://example.com',
            active: true,
          },
        ];
      }

      return [];
    });

    fetchMock = mock(
      async () => new Response('{}', { status: 200 }),
    );
    (globalThis as any).fetch = fetchMock;

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: mock(async (keys?: string | string[] | Record<string, unknown>) => {
            if (typeof keys === 'string') {
              return { [keys]: storageState[keys] };
            }

            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys.map((key) => [key, storageState[key]]),
              );
            }

            return { ...storageState };
          }),
          set: mock(async (values: Record<string, unknown>) => {
            Object.assign(storageState, values);
            return undefined;
          }),
        },
      },
      tabs: {
        query: tabsQuery,
        get: mock(async (tabId: number) => ({
          id: tabId,
          windowId: 701,
          groupId: 88,
          url: 'https://example.com',
          active: true,
          status: 'complete',
        })),
        group: mock(async () => 88),
        ungroup: mock(async () => undefined),
        sendMessage: mock(async () => undefined),
        onCreated: { addListener: mock(() => undefined) },
        onActivated: { addListener: mock(() => undefined) },
        onRemoved: { addListener: mock(() => undefined) },
        onUpdated: { addListener: mock(() => undefined) },
      },
      windows: {
        create: mock(async () => ({
          id: 701,
          tabs: [
            {
              id: 11,
              windowId: 701,
              groupId: -1,
              url: 'https://example.com',
              active: true,
            },
          ],
        })),
        remove: mock(async () => undefined),
      },
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        update: mock(async () => undefined),
      },
    };
  });

  test('stopRecording closes dedicated window and removes recording tab group', async () => {
    const { getRecordingState, startRecording, stopRecording } = await import(
      '../recording/recorder'
    );
    const { debuggerSessionManager } = await import('../commands/debugger-manager');
    const cleanupSession = mock(async () => undefined);
    debuggerSessionManager.cleanupSession = cleanupSession;

    await startRecording('rec-1', 'dedicated_window');
    expect(await getRecordingState()).toEqual({
      active: true,
      recording_id: 'rec-1',
      scope: {
        launch_mode: 'dedicated_window',
        window_id: 701,
        group_id: 88,
        tab_ids: [11],
      },
    });
    await stopRecording('rec-1');

    expect((globalThis as any).chrome.tabs.ungroup).toHaveBeenCalledWith([11]);
    expect((globalThis as any).chrome.windows.remove).toHaveBeenCalledWith(701);
    expect(cleanupSession).toHaveBeenCalledWith('recording:rec-1');
    expect(await getRecordingState()).toEqual({
      active: false,
      recording_id: null,
      scope: null,
    });
  });

  test('click events reuse a matching pre-action keyframe', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-1', 'dedicated_window');
    __testing__.clearPendingPreActionKeyframes();

    const element = {
      tagName: 'a',
      selector: 'a.SearchBar-queryResult',
      text: '特朗普',
      bbox: { x: 100, y: 120, width: 160, height: 28 },
    };

    __testing__.setPendingPreActionKeyframe('rec-1', 11, 'click', {
      pageUrl: 'https://www.zhihu.com/',
      targetSignature: __testing__.buildSerializedElementSignature(element),
      keyframe: {
        imageData: 'data:image/png;base64,AAAA',
        viewportWidth: 1728,
        viewportHeight: 858,
        url: 'https://www.zhihu.com/',
      },
    });

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'click',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-1',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element,
            clientX: 100,
            clientY: 120,
          },
        },
      },
      {
        tab: {
          id: 11,
          windowId: 701,
          url: 'https://www.zhihu.com/',
          active: true,
          status: 'complete',
        },
        frameId: 0,
      } as chrome.runtime.MessageSender,
    );

    const clickRequest = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    const clickPayload = JSON.parse(String(clickRequest?.body || '{}'));
    expect(clickPayload.event_type).toBe('click');
    expect(clickPayload.event_data.keyframe.captureTiming).toBe('pre_action');
    expect(clickPayload.event_data.keyframe.preActionType).toBe('click');

    await stopRecording('rec-1');
  });

  test('enter pre-action keyframes can be reused for keydown and submit', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-2', 'dedicated_window');
    __testing__.clearPendingPreActionKeyframes();

    const form = {
      tagName: 'form',
      selector: 'form.SearchBar',
      bbox: { x: 80, y: 12, width: 520, height: 44 },
    };
    const input = {
      tagName: 'input',
      selector: 'input.SearchBar-input',
      name: 'q',
      value: '西溪湿地 租房',
      bbox: { x: 120, y: 20, width: 320, height: 36 },
    };

    __testing__.setPendingPreActionKeyframe('rec-2', 11, 'enter', {
      pageUrl: 'https://www.zhihu.com/search',
      targetSignature: __testing__.buildSerializedElementSignature(input),
      formSignature: __testing__.buildSerializedElementSignature(form),
      keyframe: {
        imageData: 'data:image/png;base64,AAAA',
        viewportWidth: 1728,
        viewportHeight: 858,
        url: 'https://www.zhihu.com/search',
      },
    });

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'keydown',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-2',
            page: {
              url: 'https://www.zhihu.com/search',
              title: 'Zhihu Search',
            },
            key: 'Enter',
            code: 'Enter',
            element: input,
            form,
          },
        },
      },
      {
        tab: {
          id: 11,
          windowId: 701,
          url: 'https://www.zhihu.com/search',
          active: true,
          status: 'complete',
        },
        frameId: 0,
      } as chrome.runtime.MessageSender,
    );

    let request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    let payload = JSON.parse(String(request?.body || '{}'));
    expect(payload.event_type).toBe('keydown');
    expect(payload.event_data.keyframe.captureTiming).toBe('pre_action');
    expect(payload.event_data.keyframe.preActionType).toBe('enter');

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'submit',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-2',
            page: {
              url: 'https://www.zhihu.com/search',
              title: 'Zhihu Search',
            },
            form,
          },
        },
      },
      {
        tab: {
          id: 11,
          windowId: 701,
          url: 'https://www.zhihu.com/search',
          active: true,
          status: 'complete',
        },
        frameId: 0,
      } as chrome.runtime.MessageSender,
    );

    request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    payload = JSON.parse(String(request?.body || '{}'));
    expect(payload.event_type).toBe('submit');
    expect(payload.event_data.keyframe.captureTiming).toBe('pre_action');
    expect(payload.event_data.keyframe.preActionType).toBe('enter');

    await stopRecording('rec-2');
  });
});
