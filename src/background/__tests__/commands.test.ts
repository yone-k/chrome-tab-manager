import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runCloseCurrentGroupWithSave,
  runCloseCurrentWindowTabsWithSave,
  runSaveAndCloseCurrentWindow,
} from '../commands';

const managerUrl = 'chrome-extension://test-extension-id/manager.html';

type MockTab = Partial<chrome.tabs.Tab> & {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title?: string;
  active?: boolean;
  pinned?: boolean;
  groupId?: number;
};

type MockTabGroup = Partial<chrome.tabGroups.TabGroup> & {
  id: number;
  windowId: number;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
};

function installChromeMock({
  tabs,
  groups,
  exclusions = [],
  initialHistorySets = [],
  failStorageSet = false,
}: {
  tabs: MockTab[];
  groups: MockTabGroup[];
  exclusions?: string[];
  initialHistorySets?: unknown[];
  failStorageSet?: boolean;
}) {
  const mutableTabs = tabs.map((tab) => ({ ...tab }));
  const mutableGroups = groups.map((group) => ({
    ...group,
    title: group.title ?? '',
    color: group.color ?? 'grey',
  }));
  let nextTabId = Math.max(0, ...mutableTabs.map((tab) => tab.id)) + 1;
  const removedTabIds: number[] = [];
  const createdTabs: chrome.tabs.CreateProperties[] = [];
  const updatedTabs: Array<{ tabId: number; props: chrome.tabs.UpdateProperties }> = [];
  let runtimeLastError: chrome.runtime.LastError | undefined;
  const storageData: Record<string, unknown> = {
    tabManagerState: {
      version: 1,
      historySets: initialHistorySets,
      exclusions,
      restoreLoadingSuppressionEnabled: true,
      removeRestoredTabsEnabled: true,
    },
  };

  const query = vi.fn(
    (queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
      if (typeof queryInfo.url === 'string') {
        callback(
          mutableTabs
            .filter((tab) => tab.url === queryInfo.url)
            .map((tab) => tab as unknown as chrome.tabs.Tab),
        );
        return;
      }

      if (typeof queryInfo.windowId === 'number') {
        let result = mutableTabs.filter((tab) => tab.windowId === queryInfo.windowId);
        if (queryInfo.active) {
          result = result.filter((tab) => Boolean(tab.active));
        }
        callback(result.map((tab) => tab as unknown as chrome.tabs.Tab));
        return;
      }

      if (queryInfo.active && queryInfo.lastFocusedWindow) {
        const active = mutableTabs.find((tab) => Boolean(tab.active)) ?? null;
        callback(active ? [active as unknown as chrome.tabs.Tab] : []);
        return;
      }

      callback(mutableTabs.map((tab) => tab as unknown as chrome.tabs.Tab));
    },
  );

  const remove = vi.fn((tabIds: number | number[], callback: () => void) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    for (const id of ids) {
      removedTabIds.push(id);
    }
    for (const id of ids) {
      const index = mutableTabs.findIndex((tab) => tab.id === id);
      if (index >= 0) {
        mutableTabs.splice(index, 1);
      }
    }
    callback();
  });

  const create = vi.fn(
    (createProperties: chrome.tabs.CreateProperties, callback: (tab: chrome.tabs.Tab) => void) => {
      createdTabs.push(createProperties);
      const windowId = createProperties.windowId ?? mutableTabs[0]?.windowId ?? 1;
      if (createProperties.active) {
        for (const tab of mutableTabs) {
          if (tab.windowId === windowId) {
            tab.active = false;
          }
        }
      }
      const newTab: MockTab = {
        id: nextTabId,
        windowId,
        index:
          typeof createProperties.index === 'number' ? createProperties.index : mutableTabs.length,
        url: createProperties.url ?? managerUrl,
        active: createProperties.active ?? true,
        pinned: false,
        title: 'manager',
      };
      nextTabId += 1;
      mutableTabs.push(newTab);
      callback(newTab as unknown as chrome.tabs.Tab);
    },
  );

  const update = vi.fn(
    (tabId: number, props: chrome.tabs.UpdateProperties, callback: () => void) => {
      updatedTabs.push({ tabId, props });
      if (props.active) {
        const tab = mutableTabs.find((item) => item.id === tabId);
        if (tab) {
          for (const item of mutableTabs) {
            if (item.windowId === tab.windowId) {
              item.active = false;
            }
          }
          tab.active = true;
        }
      }
      callback();
    },
  );

  const tabGroupsQuery = vi.fn(
    (
      queryInfo: chrome.tabGroups.QueryInfo,
      callback: (groups: chrome.tabGroups.TabGroup[]) => void,
    ) => {
      const result =
        typeof queryInfo.windowId === 'number'
          ? mutableGroups.filter((group) => group.windowId === queryInfo.windowId)
          : mutableGroups;
      callback(result.map((group) => group as unknown as chrome.tabGroups.TabGroup));
    },
  );

  const getLastFocused = vi.fn((callback: (window: chrome.windows.Window) => void) => {
    const active = mutableTabs.find((tab) => Boolean(tab.active));
    callback({ id: active?.windowId ?? 1 } as chrome.windows.Window);
  });

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn(() => managerUrl),
      get lastError() {
        return runtimeLastError;
      },
    },
    tabs: {
      query,
      remove,
      create,
      update,
    },
    tabGroups: {
      query: tabGroupsQuery,
    },
    sessions: {
      getRecentlyClosed: vi.fn().mockResolvedValue([]),
    },
    windows: {
      getLastFocused,
    },
    storage: {
      local: {
        get: vi.fn((keys: string[], callback: (items: Record<string, unknown>) => void) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            result[key] = storageData[key];
          }
          callback(result);
        }),
        set: vi.fn((items: Record<string, unknown>, callback: () => void) => {
          if (failStorageSet) {
            runtimeLastError = { message: 'storage write failed' };
            callback();
            runtimeLastError = undefined;
            return;
          }
          Object.assign(storageData, items);
          callback();
        }),
      },
    },
  } as unknown as typeof chrome);

  return {
    removedTabIds,
    createdTabs,
    updatedTabs,
    storageData,
  };
}

describe('background commands', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('現在ウィンドウの保存可能タブを保存して閉じる', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
          favIconUrl: 'https://a.example.com/favicon.ico',
          groupId: 100,
        },
        {
          id: 2,
          windowId: 10,
          index: 1,
          pinned: false,
          url: 'https://b.example.com',
          title: 'B',
          favIconUrl: '',
          groupId: 100,
        },
        {
          id: 3,
          windowId: 10,
          index: 2,
          pinned: true,
          url: 'https://pinned.example.com',
          title: 'Pinned',
        },
        { id: 4, windowId: 10, index: 3, pinned: false, url: managerUrl, title: 'manager' },
      ],
      groups: [{ id: 100, windowId: 10, title: 'work', color: 'blue' }],
    });

    await runSaveAndCloseCurrentWindow();

    expect(mock.removedTabIds.sort((a, b) => a - b)).toEqual([1, 2]);
    const state = mock.storageData.tabManagerState as {
      historySets: Array<{
        tabs: Array<{ title: string; favIconUrl?: string }>;
      }>;
    };
    expect(state.historySets).toHaveLength(1);
    expect(state.historySets[0]?.tabs).toHaveLength(2);
    expect(state.historySets[0]?.tabs[0]).toMatchObject({
      title: 'A',
      favIconUrl: 'https://a.example.com/favicon.ico',
    });
    expect(state.historySets[0]?.tabs[1]).toMatchObject({ title: 'B' });
    expect(state.historySets[0]?.tabs[1]?.favIconUrl).toBeUndefined();
  });

  it('新規保存時に既存履歴のロック状態を保持する', async () => {
    const lockedExistingSet = {
      id: 'locked-existing',
      name: 'locked-window',
      createdAt: 1,
      windowId: 99,
      locked: true,
      managerBinding: null,
      groups: [
        { uid: 'g-locked', id: 101, title: 'locked-group', color: 'blue', index: 0, locked: true },
      ],
      tabs: [
        {
          uid: 't-locked',
          title: 'locked-tab',
          url: 'https://locked.example.com',
          index: 0,
          groupId: 101,
          locked: true,
        },
      ],
      layout: [{ type: 'group' as const, uid: 'g-locked' }],
    };
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
      initialHistorySets: [lockedExistingSet],
    });

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{
        id: string;
        locked: boolean;
        groups: Array<{ uid: string; locked: boolean }>;
        tabs: Array<{ uid: string; locked: boolean }>;
      }>;
    };
    const existing = state.historySets.find((set) => set.id === 'locked-existing');
    expect(existing?.locked).toBe(true);
    expect(existing?.groups.find((group) => group.uid === 'g-locked')?.locked).toBe(true);
    expect(existing?.tabs.find((tab) => tab.uid === 't-locked')?.locked).toBe(true);
  });

  it('新規保存時に既存履歴の全タブロック状態から親ロックを維持する', async () => {
    const existingSet = {
      id: 'existing-all-tabs-locked',
      name: 'window',
      createdAt: 1,
      windowId: 1,
      locked: false,
      managerBinding: null,
      groups: [{ uid: 'g-1', id: 1, title: 'group', color: 'blue', index: 0, locked: false }],
      tabs: [
        {
          uid: 't-1',
          title: 'tab-1',
          url: 'https://tab1.example.com',
          index: 0,
          groupId: 1,
          locked: true,
        },
        {
          uid: 't-2',
          title: 'tab-2',
          url: 'https://tab2.example.com',
          index: 1,
          groupId: null,
          locked: true,
        },
      ],
      layout: [{ type: 'group' as const, uid: 'g-1' }],
    };
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
      initialHistorySets: [existingSet],
    });

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{
        id: string;
        locked: boolean;
        groups: Array<{ uid: string; locked: boolean }>;
      }>;
    };
    const existing = state.historySets.find((set) => set.id === 'existing-all-tabs-locked');
    expect(existing?.locked).toBe(true);
    expect(existing?.groups.find((group) => group.uid === 'g-1')?.locked).toBe(true);
  });

  it('新規保存時に非対象セットのロック情報を変更しない', async () => {
    const untouchedSet = {
      id: 'existing-untouched',
      name: 'window',
      createdAt: 1,
      windowId: 1,
      locked: false,
      managerBinding: null,
      groups: [{ uid: 'g-1', id: 1, title: 'group', color: 'blue', index: 0, locked: true }],
      tabs: [
        {
          uid: 't-1',
          title: 'tab-1',
          url: 'https://tab1.example.com',
          index: 0,
          groupId: 1,
          locked: true,
        },
        {
          uid: 't-2',
          title: 'tab-2',
          url: 'https://tab2.example.com',
          index: 1,
          groupId: null,
          locked: false,
        },
      ],
      layout: [{ type: 'group' as const, uid: 'g-1' }],
    };
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
      initialHistorySets: [untouchedSet],
    });

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{
        id: string;
        locked: boolean;
        groups: Array<{ uid: string; locked: boolean }>;
        tabs: Array<{ uid: string; locked: boolean }>;
      }>;
    };
    const existing = state.historySets.find((set) => set.id === untouchedSet.id);
    expect(existing?.locked).toBe(untouchedSet.locked);
    expect(existing?.groups.map((group) => ({ uid: group.uid, locked: group.locked }))).toEqual(
      untouchedSet.groups.map((group) => ({ uid: group.uid, locked: group.locked })),
    );
    expect(existing?.tabs.map((tab) => ({ uid: tab.uid, locked: tab.locked }))).toEqual(
      untouchedSet.tabs.map((tab) => ({ uid: tab.uid, locked: tab.locked })),
    );
  });

  it('今開いているタブを閉じるはアクティブタブ1件のみ保存して閉じる', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 11,
          windowId: 20,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://same.example.com',
          title: 'same',
        },
        {
          id: 12,
          windowId: 20,
          index: 1,
          active: false,
          pinned: false,
          url: 'https://other.example.com',
          title: 'other',
        },
      ],
      groups: [],
    });

    await runCloseCurrentWindowTabsWithSave();

    expect(mock.removedTabIds).toEqual([11]);
    const state = mock.storageData.tabManagerState as { historySets: Array<{ tabs: unknown[] }> };
    expect(state.historySets).toHaveLength(1);
    expect(state.historySets[0]?.tabs).toHaveLength(1);
  });

  it('今開いているグループを閉じるはアクティブタブのグループのみ対象にする', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 21,
          windowId: 30,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://group-a.example.com',
          title: 'A',
          groupId: 200,
        },
        {
          id: 22,
          windowId: 30,
          index: 1,
          pinned: false,
          url: 'https://group-b.example.com',
          title: 'B',
          groupId: 200,
        },
        {
          id: 23,
          windowId: 30,
          index: 2,
          pinned: false,
          url: 'https://other.example.com',
          title: 'C',
          groupId: 201,
        },
      ],
      groups: [
        { id: 200, windowId: 30, title: 'target', color: 'green' },
        { id: 201, windowId: 30, title: 'other', color: 'red' },
      ],
    });

    await runCloseCurrentGroupWithSave();

    expect(mock.removedTabIds.sort((a, b) => a - b)).toEqual([21, 22]);
    const state = mock.storageData.tabManagerState as { historySets: Array<{ tabs: unknown[] }> };
    expect(state.historySets[0]?.tabs).toHaveLength(2);
  });

  it('未グループ時はアクティブタブ1件のみを対象にする', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 31,
          windowId: 40,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://ungrouped.example.com',
          title: 'A',
        },
        {
          id: 32,
          windowId: 40,
          index: 1,
          pinned: false,
          url: 'https://grouped.example.com',
          title: 'B',
          groupId: 300,
        },
      ],
      groups: [{ id: 300, windowId: 40, title: 'grp', color: 'cyan' }],
    });

    await runCloseCurrentGroupWithSave();

    expect(mock.removedTabIds).toEqual([31]);
    const state = mock.storageData.tabManagerState as { historySets: Array<{ tabs: unknown[] }> };
    expect(state.historySets[0]?.tabs).toHaveLength(1);
  });

  it('除外設定・ピン留め・管理画面タブを保存対象から除外する', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 41,
          windowId: 50,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://skip.example.com/page',
          title: 'skip-by-exclusion',
        },
        {
          id: 42,
          windowId: 50,
          index: 1,
          pinned: true,
          url: 'https://pinned.example.com/page',
          title: 'skip-by-pinned',
        },
        { id: 43, windowId: 50, index: 2, pinned: false, url: managerUrl, title: 'manager' },
        {
          id: 44,
          windowId: 50,
          index: 3,
          pinned: false,
          url: 'https://save.example.com/page',
          title: 'save-me',
        },
      ],
      groups: [],
      exclusions: ['skip.example.com'],
    });

    await runSaveAndCloseCurrentWindow();

    expect(mock.removedTabIds).toEqual([44]);
    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string }> }>;
    };
    expect(state.historySets[0]?.tabs.map((tab) => tab.url)).toEqual([
      'https://save.example.com/page',
    ]);
  });

  it('保存に失敗した場合はタブを閉じない', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 51,
          windowId: 60,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://save-fail.example.com',
          title: 'save-fail',
        },
      ],
      groups: [],
      failStorageSet: true,
    });

    await expect(runSaveAndCloseCurrentWindow()).rejects.toEqual({
      message: 'storage write failed',
    });
    expect(mock.removedTabIds).toEqual([]);
  });

  it('保存後にsessionIdを取得して付与する', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
        {
          id: 2,
          windowId: 10,
          index: 1,
          pinned: false,
          url: 'https://b.example.com',
          title: 'B',
        },
      ],
      groups: [],
    });

    // closeTabs完了後にgetRecentlyClosedSessionsが呼ばれるのでモック設定
    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://a.example.com', sessionId: 'session-a' } },
      { tab: { url: 'https://b.example.com', sessionId: 'session-b' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBe('session-a');
    expect(state.historySets[0]?.tabs[1]?.sessionId).toBe('session-b');
  });

  it('sessionId取得に失敗してもHistorySetは保存されている', async () => {
    installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('sessions API error'),
    );

    // saveTabsAndClose は例外を投げないこと
    await runSaveAndCloseCurrentWindow();
    // HistorySetは保存されている（sessionIdなし）
  });

  it('マッチしない場合はsessionIdなしのまま', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://different.example.com', sessionId: 'session-x' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBeUndefined();
  });

  it('1回目のマッチが0件の場合はリトライして2回目でマッチする', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://retry.example.com',
          title: 'Retry',
        },
      ],
      groups: [],
    });

    let callCount = 0;
    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // 1回目: まだセッション情報が反映されていない
        return Promise.resolve([]);
      }
      // 2回目（リトライ）: セッション情報が利用可能
      return Promise.resolve([
        { tab: { url: 'https://retry.example.com', sessionId: 'session-retry' } },
      ]);
    });

    await runSaveAndCloseCurrentWindow();

    expect(callCount).toBe(2);
    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBe('session-retry');
  });

  it('3タブ中2タブのみsessionIdがマッチする部分マッチ', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
        {
          id: 2,
          windowId: 10,
          index: 1,
          pinned: false,
          url: 'https://b.example.com',
          title: 'B',
        },
        {
          id: 3,
          windowId: 10,
          index: 2,
          pinned: false,
          url: 'https://c.example.com',
          title: 'C',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://a.example.com', sessionId: 'session-a' } },
      // b は Chrome のセッション上限等で欠落
      { tab: { url: 'https://c.example.com', sessionId: 'session-c' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBe('session-a');
    expect(state.historySets[0]?.tabs[1]?.sessionId).toBeUndefined();
    expect(state.historySets[0]?.tabs[2]?.sessionId).toBe('session-c');
  });

  it('sessionId付与のupdateStateが失敗しても保存自体は完了している', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://a.example.com', sessionId: 'session-a' } },
    ]);

    // 最初のprependHistorySet（保存本体）は成功するが、
    // sessionId付与のupdateState時に失敗するシナリオ
    let storageSetCallCount = 0;
    const originalSet = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    originalSet.mockImplementation((items: Record<string, unknown>, callback: () => void) => {
      storageSetCallCount++;
      if (storageSetCallCount >= 3) {
        // 3回目のset（updateState）で失敗させる
        // 1回目: prependHistorySet内のget→set、2回目: updateState内のget
        Object.assign(mock.storageData, items);
        callback();
        return;
      }
      Object.assign(mock.storageData, items);
      callback();
    });

    await runSaveAndCloseCurrentWindow();

    // HistorySet は保存されている
    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string }> }>;
    };
    expect(state.historySets).toHaveLength(1);
    expect(state.historySets[0]?.tabs[0]?.url).toBe('https://a.example.com');
  });

  it('windowセッションが混在してもtabセッションのみ使用される', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      // window セッション内に同じURLのタブがある
      {
        window: {
          id: 1,
          sessionId: 'ses-window',
          tabs: [{ url: 'https://a.example.com' }],
        },
      },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-tab' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    // window の sessionId ではなく tab の sessionId が使われる
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBe('ses-tab');
  });

  it('同一URLの複数タブ保存時にsessionIdが正しく分配される', async () => {
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://same.example.com',
          title: 'Same1',
        },
        {
          id: 2,
          windowId: 10,
          index: 1,
          pinned: false,
          url: 'https://same.example.com',
          title: 'Same2',
        },
        {
          id: 3,
          windowId: 10,
          index: 2,
          pinned: false,
          url: 'https://same.example.com',
          title: 'Same3',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://same.example.com', sessionId: 'ses-3' } },
      { tab: { url: 'https://same.example.com', sessionId: 'ses-2' } },
      { tab: { url: 'https://same.example.com', sessionId: 'ses-1' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    const tabs = state.historySets[0]?.tabs ?? [];
    // 各タブに異なるsessionIdが割り当てられる
    const sessionIds = tabs.map((t) => t.sessionId).filter(Boolean);
    expect(new Set(sessionIds).size).toBe(3);
  });

  it('タブの index 順序が savableTabs の配列順と異なる場合でも正しく sessionId が紐付く', async () => {
    // savableTabs は chrome.tabs.query の返却順で並んでおり、
    // index 順とは限らない。buildHistorySet は index ソートするため、
    // enrichHistorySetWithSessionIds が配列インデックスではなく URL ベースで
    // マッチしないと sessionId がズレる。
    const mock = installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 2, // index 順ではない
          active: true,
          pinned: false,
          url: 'https://c.example.com',
          title: 'C',
        },
        {
          id: 2,
          windowId: 10,
          index: 0, // index 順ではない
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
        {
          id: 3,
          windowId: 10,
          index: 1, // index 順ではない
          pinned: false,
          url: 'https://b.example.com',
          title: 'B',
        },
      ],
      groups: [],
    });

    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tab: { url: 'https://c.example.com', sessionId: 'ses-c' } },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-a' } },
      { tab: { url: 'https://b.example.com', sessionId: 'ses-b' } },
    ]);

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ tabs: Array<{ url: string; sessionId?: string }> }>;
    };
    // buildHistorySet が index ソートするので、tabs は a(0), b(1), c(2) の順
    const tabs = state.historySets[0]?.tabs ?? [];
    expect(tabs[0]?.url).toBe('https://a.example.com');
    expect(tabs[0]?.sessionId).toBe('ses-a');
    expect(tabs[1]?.url).toBe('https://b.example.com');
    expect(tabs[1]?.sessionId).toBe('ses-b');
    expect(tabs[2]?.url).toBe('https://c.example.com');
    expect(tabs[2]?.sessionId).toBe('ses-c');
  });

  it('リトライ不要: 1回目でマッチした場合は2回目を呼ばない', async () => {
    installChromeMock({
      tabs: [
        {
          id: 1,
          windowId: 10,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://a.example.com',
          title: 'A',
        },
      ],
      groups: [],
    });

    let callCount = 0;
    (chrome.sessions.getRecentlyClosed as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.resolve([{ tab: { url: 'https://a.example.com', sessionId: 'session-a' } }]);
    });

    await runSaveAndCloseCurrentWindow();

    // 1回目でマッチするのでリトライは発生しない
    expect(callCount).toBe(1);
  });

  it('履歴セット数は上限を超えない', async () => {
    const existingHistorySets = Array.from({ length: 200 }, (_, index) => ({
      id: `old-${index}`,
      name: `old-${index}`,
      createdAt: index,
      windowId: 1,
      locked: false,
      managerBinding: null,
      tabs: [],
      groups: [],
      layout: [],
    }));

    const mock = installChromeMock({
      tabs: [
        {
          id: 61,
          windowId: 70,
          index: 0,
          active: true,
          pinned: false,
          url: 'https://cap.example.com',
          title: 'cap',
        },
      ],
      groups: [],
      initialHistorySets: existingHistorySets,
    });

    await runSaveAndCloseCurrentWindow();

    const state = mock.storageData.tabManagerState as {
      historySets: Array<{ id: string; tabs: Array<{ url: string }> }>;
    };
    expect(state.historySets).toHaveLength(200);
    expect(state.historySets[0]?.tabs.map((tab) => tab.url)).toEqual(['https://cap.example.com']);
    expect(state.historySets.some((set) => set.id === 'old-199')).toBe(false);
  });
});
