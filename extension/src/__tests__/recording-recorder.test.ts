import { beforeEach, describe, expect, mock, test } from 'bun:test';

describe('recording recorder cleanup', () => {
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

    (globalThis as any).fetch = mock(
      async () => new Response('{}', { status: 200 }),
    );

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
    expect(await getRecordingState()).toEqual({
      active: false,
      recording_id: null,
      scope: null,
    });
  });
});
