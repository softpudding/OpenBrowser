import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { TabManager } from '../tab-manager';

describe('TabManager cleanup behavior', () => {
  beforeEach(() => {
    const tabRemovedListeners: Array<(tabId: number) => void> = [];
    const tabCreatedListeners: Array<(tab: chrome.tabs.Tab) => void> = [];
    const tabActivatedListeners: Array<
      (activeInfo: chrome.tabs.TabActiveInfo) => void
    > = [];
    const tabUpdatedListeners: Array<
      (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => void
    > = [];
    const tabGroupUpdatedListeners: Array<
      (group: chrome.tabGroups.TabGroup) => void
    > = [];
    const tabGroupRemovedListeners: Array<
      (group: chrome.tabGroups.TabGroup) => void
    > = [];

    (globalThis as any).__tabRemovedListeners = tabRemovedListeners;
    (globalThis as any).__tabCreatedListeners = tabCreatedListeners;
    (globalThis as any).__tabActivatedListeners = tabActivatedListeners;
    (globalThis as any).__tabUpdatedListeners = tabUpdatedListeners;
    (globalThis as any).__tabGroupUpdatedListeners = tabGroupUpdatedListeners;
    (globalThis as any).__tabGroupRemovedListeners = tabGroupRemovedListeners;

    (globalThis as any).chrome = {
      tabs: {
        query: mock(async () => []),
        remove: mock(async () => undefined),
        ungroup: mock(async () => undefined),
        get: mock(async (tabId: number) => ({
          id: tabId,
          groupId: -1,
          windowId: 1,
          active: false,
          url: 'https://example.com',
        })),
        onRemoved: {
          addListener: mock((listener: (tabId: number) => void) => {
            tabRemovedListeners.push(listener);
          }),
        },
        onCreated: {
          addListener: mock((listener: (tab: chrome.tabs.Tab) => void) => {
            tabCreatedListeners.push(listener);
          }),
        },
        onActivated: {
          addListener: mock(
            (listener: (activeInfo: chrome.tabs.TabActiveInfo) => void) => {
              tabActivatedListeners.push(listener);
            },
          ),
        },
        onUpdated: {
          addListener: mock(
            (
              listener: (
                tabId: number,
                changeInfo: chrome.tabs.TabChangeInfo,
                tab: chrome.tabs.Tab,
              ) => void,
            ) => {
              tabUpdatedListeners.push(listener);
            },
          ),
        },
      },
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        query: mock(async () => []),
        update: mock(async () => undefined),
        onUpdated: {
          addListener: mock(
            (listener: (group: chrome.tabGroups.TabGroup) => void) => {
              tabGroupUpdatedListeners.push(listener);
            },
          ),
        },
        onRemoved: {
          addListener: mock(
            (listener: (group: chrome.tabGroups.TabGroup) => void) => {
              tabGroupRemovedListeners.push(listener);
            },
          ),
        },
      },
    };
  });

  test('removes empty session and notifies tab-closed listeners when last tab closes', async () => {
    const manager = new TabManager();
    await manager.initialize();

    const session = {
      groupId: null,
      managedTabs: new Map([
        [
          11,
          {
            tabId: 11,
            windowId: 1,
            url: 'https://example.com',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
      ]),
      conversationId: 'conv-last-tab',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'active' as const,
      currentActiveTabId: 11,
    };
    (manager as any).sessions.set('conv-last-tab', session);

    const onTabClosed = mock(() => {});
    manager.addTabClosedListener(onTabClosed);

    const [tabRemovedListener] = (globalThis as any).__tabRemovedListeners as Array<
      (tabId: number) => void
    >;
    tabRemovedListener(11);

    expect(onTabClosed).toHaveBeenCalledWith('conv-last-tab', 11);
    expect((manager as any).sessions.has('conv-last-tab')).toBe(false);
  });

  test('cleanup sweep removes sessions whose tracked tabs are already gone', async () => {
    const chromeTabsQuery = (globalThis as any).chrome.tabs
      .query as ReturnType<typeof mock>;
    chromeTabsQuery.mockResolvedValue([{ id: 99 }]);

    const manager = new TabManager();
    await manager.initialize();

    (manager as any).sessions.set('conv-cleanup', {
      groupId: null,
      managedTabs: new Map([
        [
          42,
          {
            tabId: 42,
            windowId: 1,
            url: 'https://example.com',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        ],
      ]),
      conversationId: 'conv-cleanup',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'idle',
      currentActiveTabId: 42,
    });

    await manager.cleanup();

    expect((manager as any).sessions.has('conv-cleanup')).toBe(false);
  });
});
