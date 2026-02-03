import { describe, expect, it } from 'vitest';

import { cleanupHistorySet } from './restoreCleanup';
import type { HistorySet, TabSnapshot } from '../tab-manager/types';

const sampleSet: HistorySet = {
  id: 'set-1',
  createdAt: 1,
  windowId: 1,
  groups: [
    { id: 1, title: 'Work', color: 'blue', index: 0 },
    { id: 2, title: 'Read', color: 'red', index: 1 },
  ],
  tabs: [
    { title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
    { title: 'Mail', url: 'https://mail.example.com', index: 1, groupId: 1 },
    { title: 'News', url: 'https://news.example.com', index: 2, groupId: null },
    { title: 'Blog', url: 'https://blog.example.com', index: 3, groupId: 2 },
  ],
};

describe('cleanupHistorySet', () => {
  it('復元済みタブを削除し、空のグループを取り除く', () => {
    const restored: TabSnapshot[] = [
      { title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
      { title: 'Blog', url: 'https://blog.example.com', index: 3, groupId: 2 },
    ];

    const result = cleanupHistorySet(sampleSet, restored);

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected result to be non-null');
    }

    expect(result.tabs.map((tab) => tab.title)).toEqual(['Mail', 'News']);
    expect(result.groups.map((group) => group.id)).toEqual([1]);
  });

  it('タブが残っていない場合は null を返す', () => {
    const restored = sampleSet.tabs;

    const result = cleanupHistorySet(sampleSet, restored);

    expect(result).toBeNull();
  });
});
