import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupSnapshot, TabSnapshot } from '../tab-manager/types';
import { restoreTabs } from './restoreTabs';

function group(overrides: Partial<GroupSnapshot> & Pick<GroupSnapshot, 'id' | 'title'>) {
  return {
    uid: `group-${overrides.id}`,
    id: overrides.id,
    title: overrides.title,
    color: overrides.color ?? 'blue',
    index: overrides.index ?? 0,
    locked: overrides.locked ?? false,
  } satisfies GroupSnapshot;
}

function tab(overrides: Partial<TabSnapshot> & Pick<TabSnapshot, 'uid' | 'url'>) {
  return {
    uid: overrides.uid,
    title: overrides.title ?? overrides.uid,
    url: overrides.url,
    index: overrides.index ?? 0,
    groupId: overrides.groupId ?? null,
    locked: overrides.locked ?? false,
    sessionId: overrides.sessionId,
  } satisfies TabSnapshot;
}

describe('restoreTabs', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('既存同名グループへマージし、重複URLは作成せず復元済みに含める', async () => {
    const existingGroupedDuplicate = tab({
      uid: 'tab-duplicate-grouped',
      url: 'https://docs.example.com',
      groupId: 1,
      index: 0,
    });
    const groupedFresh = tab({
      uid: 'tab-fresh-grouped',
      url: 'https://mail.example.com',
      groupId: 1,
      index: 1,
    });
    const existingUngroupedDuplicate = tab({
      uid: 'tab-duplicate-ungrouped',
      url: 'https://news.example.com',
      groupId: null,
      index: 2,
    });
    const ungroupedFresh = tab({
      uid: 'tab-fresh-ungrouped',
      url: 'https://new.example.com',
      groupId: null,
      index: 3,
    });
    const tabs = [
      existingGroupedDuplicate,
      groupedFresh,
      existingUngroupedDuplicate,
      ungroupedFresh,
    ];
    const groups = [group({ id: 1, title: 'Work', index: 0 })];
    const runtime = { lastError: null as Error | null };
    const tabGroupsQuery = vi.fn(
      (
        _queryInfo: chrome.tabGroups.QueryInfo,
        callback: (groups: chrome.tabGroups.TabGroup[]) => void,
      ) => {
        callback([{ id: 10, title: 'Work', color: 'blue' }] as chrome.tabGroups.TabGroup[]);
      },
    );
    const tabsQuery = vi.fn(
      (_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback([
          { id: 101, url: 'https://docs.example.com', groupId: 10 },
          { id: 102, url: 'https://news.example.com', groupId: -1 },
        ] as chrome.tabs.Tab[]);
      },
    );
    const tabsCreate = vi
      .fn()
      .mockImplementationOnce(
        (_options: chrome.tabs.CreateProperties, callback: (tab: chrome.tabs.Tab) => void) => {
          callback({ id: 201, url: 'https://mail.example.com', windowId: 7 } as chrome.tabs.Tab);
        },
      )
      .mockImplementationOnce(
        (_options: chrome.tabs.CreateProperties, callback: (tab: chrome.tabs.Tab) => void) => {
          callback({ id: 202, url: 'https://new.example.com', windowId: 7 } as chrome.tabs.Tab);
        },
      );
    const tabsGroup = vi.fn(
      (_options: chrome.tabs.GroupOptions, callback: (groupId: number) => void) => {
        callback(10);
      },
    );

    vi.stubGlobal('chrome', {
      runtime,
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        query: tabGroupsQuery,
      },
      tabs: {
        query: tabsQuery,
        create: tabsCreate,
        group: tabsGroup,
      },
    });

    const result = await restoreTabs(tabs, groups, 7, false, 4);

    expect(tabGroupsQuery).toHaveBeenCalledWith({ windowId: 7 }, expect.any(Function));
    expect(tabsQuery).toHaveBeenCalledWith({ windowId: 7 }, expect.any(Function));
    expect(tabsCreate).toHaveBeenCalledTimes(2);
    expect(tabsCreate).toHaveBeenNthCalledWith(
      1,
      { windowId: 7, url: 'https://mail.example.com', active: false, index: 5 },
      expect.any(Function),
    );
    expect(tabsCreate).toHaveBeenNthCalledWith(
      2,
      { windowId: 7, url: 'https://new.example.com', active: false, index: 7 },
      expect.any(Function),
    );
    expect(tabsGroup).toHaveBeenCalledTimes(1);
    expect(tabsGroup).toHaveBeenCalledWith({ groupId: 10, tabIds: [201] }, expect.any(Function));
    expect(result).toEqual({
      restoredTabs: [
        groupedFresh,
        ungroupedFresh,
        existingGroupedDuplicate,
        existingUngroupedDuplicate,
      ],
      failedTabs: [],
      sessionRestoredCount: 0,
      skippedDuplicateCount: 2,
    });
  });
});
