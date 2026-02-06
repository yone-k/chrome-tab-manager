import { describe, expect, it } from 'vitest';

import { cleanupHistorySet } from './restoreCleanup';
import type { HistorySet, TabSnapshot } from '../tab-manager/types';
import { buildLayoutFromData } from '../tab-manager/layout';

const sampleSet: HistorySet = {
  id: 'set-1',
  name: 'window-1',
  createdAt: 1,
  windowId: 1,
  locked: false,
  managerBinding: null,
  groups: [
    { uid: 'g-1', id: 1, title: 'Work', color: 'blue', index: 0, locked: false },
    { uid: 'g-2', id: 2, title: 'Read', color: 'red', index: 1, locked: false },
  ],
  tabs: [
    {
      uid: 't-1',
      title: 'Docs',
      url: 'https://docs.example.com',
      index: 0,
      groupId: 1,
      locked: false,
    },
    {
      uid: 't-2',
      title: 'Mail',
      url: 'https://mail.example.com',
      index: 1,
      groupId: 1,
      locked: false,
    },
    {
      uid: 't-3',
      title: 'News',
      url: 'https://news.example.com',
      index: 2,
      groupId: null,
      locked: false,
    },
    {
      uid: 't-4',
      title: 'Blog',
      url: 'https://blog.example.com',
      index: 3,
      groupId: 2,
      locked: false,
    },
  ],
  layout: [],
};
sampleSet.layout = buildLayoutFromData(sampleSet.groups, sampleSet.tabs);

describe('cleanupHistorySet', () => {
  it('復元済みタブを削除し、空のグループを残す', () => {
    const restored: TabSnapshot[] = [
      {
        uid: 't-1',
        title: 'Docs',
        url: 'https://docs.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-4',
        title: 'Blog',
        url: 'https://blog.example.com',
        index: 3,
        groupId: 2,
        locked: false,
      },
    ];

    const result = cleanupHistorySet(sampleSet, restored);

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected result to be non-null');
    }

    expect(result.tabs.map((tab) => tab.title)).toEqual(['Mail', 'News']);
    expect(result.groups.map((group) => group.id)).toEqual([1, 2]);
    expect(result.layout.map((item) => `${item.type}:${item.uid}`)).toEqual([
      'group:g-1',
      'tab:t-3',
      'group:g-2',
    ]);
  });

  it('タブが残っていない場合でも空ウィンドウとして保持する', () => {
    const restored = sampleSet.tabs;

    const result = cleanupHistorySet(sampleSet, restored);

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected result to be non-null');
    }
    expect(result.tabs).toEqual([]);
    expect(result.groups).toEqual(sampleSet.groups);
  });

  it('pruneEmptyGroups=true の場合は空グループを削除する', () => {
    const restored: TabSnapshot[] = [
      {
        uid: 't-1',
        title: 'Docs',
        url: 'https://docs.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-4',
        title: 'Blog',
        url: 'https://blog.example.com',
        index: 3,
        groupId: 2,
        locked: false,
      },
    ];

    const result = cleanupHistorySet(sampleSet, restored, { pruneEmptyGroups: true });

    expect(result.groups.map((group) => group.id)).toEqual([1]);
    expect(result.layout.map((item) => `${item.type}:${item.uid}`)).toEqual([
      'group:g-1',
      'tab:t-3',
    ]);
  });

  it('pruneEmptyGroups=true かつ全タブ復元時は空グループをすべて削除する', () => {
    const result = cleanupHistorySet(sampleSet, sampleSet.tabs, { pruneEmptyGroups: true });

    expect(result.tabs).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  it('ロックされたタブは復元後も履歴に残す', () => {
    const setWithLockedTab: HistorySet = {
      ...sampleSet,
      tabs: sampleSet.tabs.map((tab) => (tab.uid === 't-1' ? { ...tab, locked: true } : tab)),
    };

    const result = cleanupHistorySet(setWithLockedTab, [setWithLockedTab.tabs[0]!]);

    expect(result.tabs.map((tab) => tab.uid)).toContain('t-1');
  });

  it('pruneEmptyGroups=true でもロックされたグループは残す', () => {
    const setWithLockedGroup: HistorySet = {
      ...sampleSet,
      groups: sampleSet.groups.map((group) =>
        group.uid === 'g-2' ? { ...group, locked: true } : group,
      ),
    };

    const result = cleanupHistorySet(setWithLockedGroup, sampleSet.tabs, {
      pruneEmptyGroups: true,
    });

    expect(result.groups.map((group) => group.uid)).toEqual(['g-2']);
  });
});
