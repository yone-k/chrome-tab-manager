import { describe, expect, it } from 'vitest';

import { buildLayoutFromData } from '../tab-manager/layout';
import type { HistorySet } from '../tab-manager/types';
import { deleteTabFromHistorySet } from './tabState';

function createSet(): HistorySet {
  const set: HistorySet = {
    id: 'set-1',
    name: 'window-1',
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [{ uid: 'g-1', id: 1, title: 'group-1', color: 'blue', index: 0, locked: false }],
    tabs: [
      {
        uid: 't-unlocked',
        title: 'tab-unlocked',
        url: 'https://unlocked.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-locked',
        title: 'tab-locked',
        url: 'https://locked.example.com',
        index: 1,
        groupId: 1,
        locked: true,
      },
    ],
    layout: [],
  };
  set.layout = buildLayoutFromData(set.groups, set.tabs);
  return set;
}

describe('deleteTabFromHistorySet', () => {
  it('ロック解除タブを削除後に残存タブ基準で祖先ロックを再同期する', () => {
    const set = createSet();

    const updated = deleteTabFromHistorySet(set, 't-unlocked');

    expect(updated.tabs.map((tab) => tab.uid)).toEqual(['t-locked']);
    expect(updated.tabs.every((tab) => tab.locked)).toBe(true);
    expect(updated.groups.find((group) => group.uid === 'g-1')?.locked).toBe(true);
    expect(updated.locked).toBe(true);
  });

  it('対象タブが存在しない場合は変更しない', () => {
    const set = createSet();

    const updated = deleteTabFromHistorySet(set, 'missing');

    expect(updated).toBe(set);
  });
});
