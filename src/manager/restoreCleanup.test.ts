import { describe, expect, it } from 'vitest';

import { cleanupHistorySet } from './restoreCleanup';
import type { HistorySet, TabSnapshot } from '../tab-manager/types';
import { buildLayoutFromData } from '../tab-manager/layout';

const sampleSet: HistorySet = {
  id: 'set-1',
  name: 'window-1',
  createdAt: 1,
  windowId: 1,
  groups: [
    { uid: 'g-1', id: 1, title: 'Work', color: 'blue', index: 0 },
    { uid: 'g-2', id: 2, title: 'Read', color: 'red', index: 1 },
  ],
  tabs: [
    { uid: 't-1', title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
    { uid: 't-2', title: 'Mail', url: 'https://mail.example.com', index: 1, groupId: 1 },
    { uid: 't-3', title: 'News', url: 'https://news.example.com', index: 2, groupId: null },
    { uid: 't-4', title: 'Blog', url: 'https://blog.example.com', index: 3, groupId: 2 },
  ],
  layout: [],
};
sampleSet.layout = buildLayoutFromData(sampleSet.groups, sampleSet.tabs);

describe('cleanupHistorySet', () => {
  it('復元済みタブを削除し、空のグループを残す', () => {
    const restored: TabSnapshot[] = [
      { uid: 't-1', title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
      { uid: 't-4', title: 'Blog', url: 'https://blog.example.com', index: 3, groupId: 2 },
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
});
