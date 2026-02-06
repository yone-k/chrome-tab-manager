import { describe, expect, it } from 'vitest';

import { buildLayoutFromData } from '../tab-manager/layout';
import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';
import { deleteGroupFromHistorySet } from './groupState';

type SetInput = {
  id: string;
  groups: Array<Pick<GroupSnapshot, 'uid' | 'id' | 'title' | 'color'>>;
  tabs: Array<Pick<TabSnapshot, 'uid' | 'title' | 'url' | 'groupId'>>;
};

function makeSet(input: SetInput): HistorySet {
  const groups = input.groups.map((group, index) => ({ ...group, index }));
  const tabs = input.tabs.map((tab, index) => ({ ...tab, index }));
  return {
    id: input.id,
    name: input.id,
    createdAt: 1700000000000,
    windowId: 1,
    managerBinding: null,
    groups,
    tabs,
    layout: buildLayoutFromData(groups, tabs),
  };
}

describe('deleteGroupFromHistorySet', () => {
  it('グループ削除時に所属タブを未グループ化し、削除位置へ展開する', () => {
    const set = makeSet({
      id: 'set-a',
      groups: [{ uid: 'g-a', id: 1, title: 'A', color: 'blue' }],
      tabs: [
        { uid: 't-0', title: 'ungrouped-1', url: 'https://0.example.com', groupId: null },
        { uid: 't-1', title: 'grouped', url: 'https://1.example.com', groupId: 1 },
        { uid: 't-2', title: 'ungrouped-2', url: 'https://2.example.com', groupId: null },
      ],
    });

    const updated = deleteGroupFromHistorySet(set, 'g-a');

    expect(updated.groups).toEqual([]);
    expect(updated.tabs.find((tab) => tab.uid === 't-1')?.groupId).toBeNull();
    expect(updated.layout.map((item) => `${item.type}:${item.uid}`)).toEqual([
      'tab:t-0',
      'tab:t-1',
      'tab:t-2',
    ]);
  });

  it('空グループ削除時にレイアウトからのみ取り除く', () => {
    const set = makeSet({
      id: 'set-a',
      groups: [{ uid: 'g-a', id: 1, title: 'A', color: 'blue' }],
      tabs: [{ uid: 't-0', title: 'ungrouped-1', url: 'https://0.example.com', groupId: null }],
    });

    const updated = deleteGroupFromHistorySet(set, 'g-a');

    expect(updated.groups).toEqual([]);
    expect(updated.layout.map((item) => `${item.type}:${item.uid}`)).toEqual(['tab:t-0']);
  });
});
