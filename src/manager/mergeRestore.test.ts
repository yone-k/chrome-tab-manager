import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMergeFilter, queryWindowTabState } from './mergeRestore';
import type { GroupSnapshot, TabSnapshot } from '../tab-manager/types';

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

describe('queryWindowTabState', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('復元先ウィンドウの既存グループと全URLを収集する', async () => {
    const tabGroupsQuery = vi.fn(
      (
        _queryInfo: chrome.tabGroups.QueryInfo,
        callback: (groups: chrome.tabGroups.TabGroup[]) => void,
      ) => {
        callback([
          { id: 10, title: 'Work', color: 'blue' },
          { id: 11, title: 'Read', color: 'red' },
        ] as chrome.tabGroups.TabGroup[]);
      },
    );
    const tabsQuery = vi.fn(
      (_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback([
          { id: 1, url: 'https://docs.example.com', groupId: 10 },
          { id: 2, url: 'https://mail.example.com', groupId: 10 },
          { id: 3, url: 'https://news.example.com', groupId: -1 },
          { id: 4, url: 'https://empty.example.com' },
        ] as chrome.tabs.Tab[]);
      },
    );
    vi.stubGlobal('chrome', {
      runtime: { lastError: null },
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        query: tabGroupsQuery,
      },
      tabs: {
        query: tabsQuery,
      },
    });

    const result = await queryWindowTabState(7);

    expect(tabGroupsQuery).toHaveBeenCalledWith({ windowId: 7 }, expect.any(Function));
    expect(tabsQuery).toHaveBeenCalledWith({ windowId: 7 }, expect.any(Function));
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ groupId: 10, title: 'Work', color: 'blue' });
    expect([...result.groups[0]!.urls]).toEqual([
      'https://docs.example.com',
      'https://mail.example.com',
    ]);
    expect([...result.groups[1]!.urls]).toEqual([]);
    expect([...result.allUrls]).toEqual([
      'https://docs.example.com',
      'https://mail.example.com',
      'https://news.example.com',
      'https://empty.example.com',
    ]);
  });

  it('Chrome API エラー時は例外を伝播する', async () => {
    const lastError = new Error('tabGroups query failed');
    const tabGroupsQuery = vi.fn(
      (
        _queryInfo: chrome.tabGroups.QueryInfo,
        callback: (groups: chrome.tabGroups.TabGroup[]) => void,
      ) => {
        chrome.runtime.lastError = lastError;
        callback([]);
      },
    );
    const tabsQuery = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { lastError: null },
      tabGroups: {
        TAB_GROUP_ID_NONE: -1,
        query: tabGroupsQuery,
      },
      tabs: {
        query: tabsQuery,
      },
    });

    await expect(queryWindowTabState(7)).rejects.toBe(lastError);
    expect(tabsQuery).not.toHaveBeenCalled();
  });
});

describe('buildMergeFilter', () => {
  it('同名グループが存在する場合に mergeTargets にマッピングする', () => {
    const tabs = [tab({ uid: 'tab-1', url: 'https://new.example.com', groupId: 1 })];
    const groups = [group({ id: 1, title: 'Work' })];

    const result = buildMergeFilter(tabs, groups, {
      groups: [{ groupId: 10, title: 'Work', color: 'blue', urls: new Set() }],
      allUrls: new Set(),
    });

    expect(result.mergeTargets.get(1)).toBe(10);
    expect(result.tabsToRestore).toEqual(tabs);
    expect(result.skippedTabs).toEqual([]);
  });

  it('同名グループが存在しない場合は全タブを復元対象に含める', () => {
    const tabs = [tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: 1 })];
    const groups = [group({ id: 1, title: 'Work' })];

    const result = buildMergeFilter(tabs, groups, {
      groups: [{ groupId: 10, title: 'Read', color: 'red', urls: new Set() }],
      allUrls: new Set(),
    });

    expect(result.mergeTargets.size).toBe(0);
    expect(result.tabsToRestore).toEqual(tabs);
    expect(result.skippedTabs).toEqual([]);
  });

  it('マージ先グループ内に同一URLのタブがある場合はスキップする', () => {
    const duplicate = tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: 1 });
    const fresh = tab({ uid: 'tab-2', url: 'https://mail.example.com', groupId: 1 });

    const result = buildMergeFilter([duplicate, fresh], [group({ id: 1, title: 'Work' })], {
      groups: [
        {
          groupId: 10,
          title: 'Work',
          color: 'blue',
          urls: new Set(['https://docs.example.com']),
        },
      ],
      allUrls: new Set(['https://docs.example.com']),
    });

    expect(result.skippedTabs).toEqual([duplicate]);
    expect(result.tabsToRestore).toEqual([fresh]);
  });

  it('マージ先グループ内にないURLのタブは復元対象に含める', () => {
    const fresh = tab({ uid: 'tab-1', url: 'https://new.example.com', groupId: 1 });

    const result = buildMergeFilter([fresh], [group({ id: 1, title: 'Work' })], {
      groups: [
        {
          groupId: 10,
          title: 'Work',
          color: 'blue',
          urls: new Set(['https://docs.example.com']),
        },
      ],
      allUrls: new Set(['https://docs.example.com']),
    });

    expect(result.tabsToRestore).toEqual([fresh]);
    expect(result.skippedTabs).toEqual([]);
  });

  it('未グループタブで同一URLが存在する場合はスキップする', () => {
    const duplicate = tab({ uid: 'tab-1', url: 'https://news.example.com', groupId: null });

    const result = buildMergeFilter([duplicate], [], {
      groups: [],
      allUrls: new Set(['https://news.example.com']),
    });

    expect(result.tabsToRestore).toEqual([]);
    expect(result.skippedTabs).toEqual([duplicate]);
  });

  it('未グループタブは既存グループ内に同一URLがある場合もスキップする', () => {
    const duplicate = tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: null });

    const result = buildMergeFilter([duplicate], [], {
      groups: [
        {
          groupId: 10,
          title: 'Work',
          color: 'blue',
          urls: new Set(['https://docs.example.com']),
        },
      ],
      allUrls: new Set(['https://docs.example.com']),
    });

    expect(result.tabsToRestore).toEqual([]);
    expect(result.skippedTabs).toEqual([duplicate]);
  });

  it('未グループタブで同一URLが存在しない場合は復元対象に含める', () => {
    const fresh = tab({ uid: 'tab-1', url: 'https://new.example.com', groupId: null });

    const result = buildMergeFilter([fresh], [], {
      groups: [],
      allUrls: new Set(['https://news.example.com']),
    });

    expect(result.tabsToRestore).toEqual([fresh]);
    expect(result.skippedTabs).toEqual([]);
  });

  it('空タイトルのグループはマージ対象にしない', () => {
    const tabs = [tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: 1 })];
    const groups = [group({ id: 1, title: '' })];

    const result = buildMergeFilter(tabs, groups, {
      groups: [{ groupId: 10, title: '', color: 'blue', urls: new Set() }],
      allUrls: new Set(),
    });

    expect(result.mergeTargets.size).toBe(0);
    expect(result.tabsToRestore).toEqual(tabs);
  });

  it('大文字小文字が異なるグループ名はマージしない', () => {
    const tabs = [tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: 1 })];
    const groups = [group({ id: 1, title: 'Work' })];

    const result = buildMergeFilter(tabs, groups, {
      groups: [{ groupId: 10, title: 'work', color: 'blue', urls: new Set() }],
      allUrls: new Set(),
    });

    expect(result.mergeTargets.size).toBe(0);
    expect(result.tabsToRestore).toEqual(tabs);
  });

  it('同名グループが複数ある場合は最初のグループにマッチする', () => {
    const tabs = [tab({ uid: 'tab-1', url: 'https://docs.example.com', groupId: 1 })];
    const groups = [group({ id: 1, title: 'Work' })];

    const result = buildMergeFilter(tabs, groups, {
      groups: [
        { groupId: 10, title: 'Work', color: 'blue', urls: new Set() },
        { groupId: 11, title: 'Work', color: 'red', urls: new Set() },
      ],
      allUrls: new Set(),
    });

    expect(result.mergeTargets.get(1)).toBe(10);
  });

  it('全タブがスキップされた場合に tabsToRestore が空になる', () => {
    const groupedDuplicate = tab({
      uid: 'tab-1',
      url: 'https://docs.example.com',
      groupId: 1,
    });
    const ungroupedDuplicate = tab({
      uid: 'tab-2',
      url: 'https://news.example.com',
      groupId: null,
    });

    const result = buildMergeFilter(
      [groupedDuplicate, ungroupedDuplicate],
      [group({ id: 1, title: 'Work' })],
      {
        groups: [
          {
            groupId: 10,
            title: 'Work',
            color: 'blue',
            urls: new Set(['https://docs.example.com']),
          },
        ],
        allUrls: new Set(['https://docs.example.com', 'https://news.example.com']),
      },
    );

    expect(result.tabsToRestore).toEqual([]);
    expect(result.skippedTabs).toEqual([groupedDuplicate, ungroupedDuplicate]);
  });
});
