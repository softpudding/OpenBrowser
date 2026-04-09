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

    fetchMock = mock(async () => new Response('{}', { status: 200 }));
    (globalThis as any).fetch = fetchMock;

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: mock(
            async (keys?: string | string[] | Record<string, unknown>) => {
              if (typeof keys === 'string') {
                return { [keys]: storageState[keys] };
              }

              if (Array.isArray(keys)) {
                return Object.fromEntries(
                  keys.map((key) => [key, storageState[key]]),
                );
              }

              return { ...storageState };
            },
          ),
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
    const { getRecordingState, startRecording, stopRecording } =
      await import('../recording/recorder');
    const { debuggerSessionManager } =
      await import('../commands/debugger-manager');
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

    const clickRequest = fetchMock.mock.calls.at(-1)?.[1] as
      | RequestInit
      | undefined;
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

  test('focus on an input keeps a keyframe when no click follows', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-focus', 'dedicated_window');
    __testing__.clearPendingPreActionKeyframes();

    const input = {
      tagName: 'input',
      selector: '#Popover1-toggle',
      role: 'combobox',
      placeholder: '搜索',
      bbox: { x: 827, y: 19, width: 289, height: 24 },
    };

    __testing__.setPendingPreActionKeyframe('rec-focus', 11, 'click', {
      pageUrl: 'https://www.zhihu.com/',
      targetSignature: __testing__.buildSerializedElementSignature(input),
      keyframe: {
        imageData: 'data:image/png;base64,AAAA',
        viewportWidth: 1728,
        viewportHeight: 889,
        url: 'https://www.zhihu.com/',
      },
    });

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'focus',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-focus',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: input,
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

    await new Promise((resolve) => setTimeout(resolve, 280));

    const focusRequest = fetchMock.mock.calls.at(-1)?.[1] as
      | RequestInit
      | undefined;
    const focusPayload = JSON.parse(String(focusRequest?.body || '{}'));
    expect(focusPayload.event_type).toBe('focus');
    expect(focusPayload.event_data.keyframe.captureTiming).toBe('pre_action');
    expect(focusPayload.event_data.keyframe.preActionType).toBe('click');

    await stopRecording('rec-focus');
  });

  test('focus is suppressed when a matching click follows immediately', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-focus-click', 'dedicated_window');
    __testing__.clearPendingPreActionKeyframes();

    const input = {
      tagName: 'input',
      selector: '#Popover1-toggle',
      role: 'combobox',
      placeholder: '搜索',
      bbox: { x: 827, y: 19, width: 289, height: 24 },
    };

    const initialCallCount = fetchMock.mock.calls.length;

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'focus',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-focus-click',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: input,
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

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'click',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-focus-click',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: input,
            clientX: 900,
            clientY: 30,
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

    await new Promise((resolve) => setTimeout(resolve, 280));

    const newEventPayloads = fetchMock.mock.calls
      .slice(initialCallCount)
      .map((call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}')),
      )
      .filter(
        (payload) =>
          payload.event_type === 'focus' || payload.event_type === 'click',
      );

    expect(newEventPayloads.map((payload) => payload.event_type)).toEqual([
      'click',
    ]);

    await stopRecording('rec-focus-click');
  });

  test('enter ends a typing burst only after a short grace window', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-input-enter', 'dedicated_window');
    __testing__.clearPendingInputEvents();
    fetchMock.mockClear();

    const sender = {
      tab: {
        id: 11,
        windowId: 701,
        url: 'https://www.zhihu.com/',
        active: true,
        status: 'complete',
      },
      frameId: 0,
    } as chrome.runtime.MessageSender;

    const baseInput = {
      tagName: 'input',
      selector: '#Popover1-toggle',
      role: 'combobox',
      placeholder: '搜索',
      bbox: { x: 827, y: 19, width: 289, height: 24 },
    };

    const initialCallCount = fetchMock.mock.calls.length;

    for (const value of ['t', 'te', '特朗普']) {
      await handleContentRecordingEvent(
        {
          type: 'openbrowser:recording-event',
          event: {
            type: 'input',
            timestamp: Date.now(),
            data: {
              recordingId: 'rec-input-enter',
              page: {
                url: 'https://www.zhihu.com/',
                title: 'Zhihu',
              },
              element: {
                ...baseInput,
                value,
              },
            },
          },
        },
        sender,
      );
    }

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'keydown',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-enter',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            key: 'Enter',
            code: 'Enter',
            element: {
              ...baseInput,
              value: '特朗普',
            },
          },
        },
      },
      sender,
    );

    await new Promise((resolve) => setTimeout(resolve, 280));

    const newEventPayloads = fetchMock.mock.calls
      .slice(initialCallCount)
      .map((call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}')),
      )
      .filter(
        (payload) =>
          payload.event_type === 'input' || payload.event_type === 'keydown',
      );

    expect(newEventPayloads.map((payload) => payload.event_type)).toEqual([
      'keydown',
      'input',
    ]);
    expect(newEventPayloads[1].event_data.element.value).toBe('特朗普');
    expect(newEventPayloads[1].event_data.inputAggregation).toEqual({
      sourceEventCount: 3,
      endedBy: 'enter',
    });

    await stopRecording('rec-input-enter');
  });

  test('text input change flushes the merged input instead of recording a duplicate change', async () => {
    const {
      __testing__,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-input-change', 'dedicated_window');
    __testing__.clearPendingInputEvents();

    const sender = {
      tab: {
        id: 11,
        windowId: 701,
        url: 'https://www.zhihu.com/',
        active: true,
        status: 'complete',
      },
      frameId: 0,
    } as chrome.runtime.MessageSender;

    const input = {
      tagName: 'input',
      selector: '#Popover1-toggle',
      role: 'combobox',
      placeholder: '搜索',
      value: '特朗普',
      bbox: { x: 827, y: 19, width: 289, height: 24 },
    };

    const initialCallCount = fetchMock.mock.calls.length;

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'input',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-change',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: input,
          },
        },
      },
      sender,
    );

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'change',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-change',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: input,
          },
        },
      },
      sender,
    );

    const newEventPayloads = fetchMock.mock.calls
      .slice(initialCallCount)
      .map((call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}')),
      )
      .filter(
        (payload) =>
          payload.event_type === 'input' || payload.event_type === 'change',
      );

    expect(newEventPayloads.map((payload) => payload.event_type)).toEqual([
      'input',
    ]);
    expect(newEventPayloads[0].event_data.inputAggregation).toEqual({
      sourceEventCount: 1,
      endedBy: 'change',
    });

    await stopRecording('rec-input-change');
  });

  test('tab_ready does not split typing and enter is cancelled when more input follows', async () => {
    const {
      __testing__,
      getRecordingState,
      handleContentRecordingEvent,
      startRecording,
      stopRecording,
    } = await import('../recording/recorder');

    await startRecording('rec-input-ime', 'dedicated_window');
    __testing__.clearPendingInputEvents();
    fetchMock.mockClear();

    const sender = {
      tab: {
        id: 11,
        windowId: 701,
        url: 'https://www.zhihu.com/',
        active: true,
        status: 'complete',
      },
      frameId: 0,
    } as chrome.runtime.MessageSender;

    const input = {
      tagName: 'input',
      selector: '#Popover1-toggle',
      role: 'combobox',
      placeholder: '搜索',
      bbox: { x: 827, y: 19, width: 289, height: 24 },
    };

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'input',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-ime',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: {
              ...input,
              value: 'AI',
            },
          },
        },
      },
      sender,
    );

    const recordingState = await getRecordingState();
    expect(recordingState.active).toBe(true);

    await __testing__.flushPendingInputEventsBeforeLifecycleEvent(
      {
        recordingId: 'rec-input-ime',
        startedAt: Date.now(),
        scope: {
          launchMode: 'dedicated_window',
          windowId: 701,
          groupId: 88,
          tabIds: new Set([11]),
        },
        navigation: {
          tabHistories: new Map(),
        },
      },
      'tab_ready',
      {
        tab: {
          tabId: 11,
          url: 'https://www.zhihu.com/',
        },
      },
    );

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'input',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-ime',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: {
              ...input,
              value: 'AIA gen t',
            },
          },
        },
      },
      sender,
    );

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'keydown',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-ime',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            key: 'Enter',
            code: 'Enter',
            element: {
              ...input,
              value: 'AIA gen t',
            },
          },
        },
      },
      sender,
    );

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'input',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-ime',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            element: {
              ...input,
              value: 'AIAgent',
            },
          },
        },
      },
      sender,
    );

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'submit',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-input-ime',
            page: {
              url: 'https://www.zhihu.com/',
              title: 'Zhihu',
            },
            form: {
              tagName: 'form',
              selector: 'form.SearchBar',
              bbox: { x: 760, y: 12, width: 620, height: 48 },
            },
          },
        },
      },
      sender,
    );

    await new Promise((resolve) => setTimeout(resolve, 280));

    const newEventPayloads = fetchMock.mock.calls
      .map((call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}')),
      )
      .filter(
        (payload) =>
          payload.event_type === 'input' ||
          payload.event_type === 'keydown' ||
          payload.event_type === 'submit',
      );

    expect(newEventPayloads.map((payload) => payload.event_type)).toEqual([
      'keydown',
      'input',
      'submit',
    ]);
    expect(newEventPayloads[1].event_data.element.value).toBe('AIAgent');
    expect(newEventPayloads[1].event_data.inputAggregation).toEqual({
      sourceEventCount: 3,
      endedBy: 'submit',
    });

    await stopRecording('rec-input-ime');
  });

  test('select change is still recorded as change', async () => {
    const { handleContentRecordingEvent, startRecording, stopRecording } =
      await import('../recording/recorder');

    await startRecording('rec-select-change', 'dedicated_window');

    const initialCallCount = fetchMock.mock.calls.length;

    await handleContentRecordingEvent(
      {
        type: 'openbrowser:recording-event',
        event: {
          type: 'change',
          timestamp: Date.now(),
          data: {
            recordingId: 'rec-select-change',
            page: {
              url: 'https://finviz.com/screener.ashx',
              title: 'finviz',
            },
            element: {
              tagName: 'select',
              selector: '#fs_cap',
              value: 'largeover',
              selectedText: 'Large (> $10bln)',
              bbox: { x: 100, y: 160, width: 120, height: 28 },
            },
          },
        },
      },
      {
        tab: {
          id: 11,
          windowId: 701,
          url: 'https://finviz.com/screener.ashx',
          active: true,
          status: 'complete',
        },
        frameId: 0,
      } as chrome.runtime.MessageSender,
    );

    const newEventPayloads = fetchMock.mock.calls
      .slice(initialCallCount)
      .map((call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body || '{}')),
      )
      .filter((payload) => payload.event_type === 'change');

    expect(newEventPayloads).toHaveLength(1);
    expect(newEventPayloads[0].event_data.element.value).toBe('largeover');

    await stopRecording('rec-select-change');
  });

  test('classifies revisiting the previous URL as tab_back and next URL as tab_forward', async () => {
    const { __testing__ } = await import('../recording/recorder');

    const recording = {
      recordingId: 'rec-nav',
      startedAt: Date.now(),
      scope: {
        launchMode: 'dedicated_window' as const,
        windowId: 701,
        groupId: 88,
        tabIds: new Set([11]),
      },
      navigation: {
        tabHistories: new Map([
          [
            11,
            {
              entries: [
                'https://finviz.com/screener.ashx',
                'https://finviz.com/quote.ashx?t=BCE&p=d',
              ],
              index: 1,
            },
          ],
        ]),
      },
    };

    const backResult = __testing__.classifyAndRecordTabNavigation(
      recording,
      11,
      'https://finviz.com/screener.ashx',
    );
    expect(backResult).toEqual({
      eventType: 'tab_back',
      previousUrl: 'https://finviz.com/quote.ashx?t=BCE&p=d',
    });
    expect(recording.navigation.tabHistories.get(11)?.index).toBe(0);

    const forwardResult = __testing__.classifyAndRecordTabNavigation(
      recording,
      11,
      'https://finviz.com/quote.ashx?t=BCE&p=d',
    );
    expect(forwardResult).toEqual({
      eventType: 'tab_forward',
      previousUrl: 'https://finviz.com/screener.ashx',
    });
    expect(recording.navigation.tabHistories.get(11)?.index).toBe(1);
  });

  test('classifies new URL branches as tab_navigated and truncates forward history', async () => {
    const { __testing__ } = await import('../recording/recorder');

    const recording = {
      recordingId: 'rec-nav-branch',
      startedAt: Date.now(),
      scope: {
        launchMode: 'dedicated_window' as const,
        windowId: 701,
        groupId: 88,
        tabIds: new Set([11]),
      },
      navigation: {
        tabHistories: new Map([
          [
            11,
            {
              entries: [
                'https://finviz.com/screener.ashx',
                'https://finviz.com/quote.ashx?t=BCE&p=d',
                'https://finviz.com/quote.ashx?t=HMC&p=d',
              ],
              index: 1,
            },
          ],
        ]),
      },
    };

    const result = __testing__.classifyAndRecordTabNavigation(
      recording,
      11,
      'https://finviz.com/quote.ashx?t=TM&p=d',
    );
    expect(result).toEqual({
      eventType: 'tab_navigated',
      previousUrl: 'https://finviz.com/quote.ashx?t=BCE&p=d',
    });
    expect(recording.navigation.tabHistories.get(11)).toEqual({
      entries: [
        'https://finviz.com/screener.ashx',
        'https://finviz.com/quote.ashx?t=BCE&p=d',
        'https://finviz.com/quote.ashx?t=TM&p=d',
      ],
      index: 2,
    });
  });
});
