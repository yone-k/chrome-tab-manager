import { describe, expect, it } from 'vitest';

import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';
import { buildLayoutFromData } from '../tab-manager/layout';
import { applyDragReorder } from './dragReorder';

type SetInput = {
  id: string;
  groups: Array<Pick<GroupSnapshot, 'uid' | 'id' | 'title' | 'color'>>;
  tabs: Array<Pick<TabSnapshot, 'uid' | 'title' | 'url' | 'groupId'>>;
};

function makeSet(input: SetInput): HistorySet {
  const groups = input.groups.map((group, index) => ({
    ...group,
    index,
  }));
  const tabs = input.tabs.map((tab, index) => ({
    ...tab,
    index,
  }));
  return {
    id: input.id,
    name: input.id,
    createdAt: 1700000000000,
    windowId: 1,
    groups,
    tabs,
    layout: buildLayoutFromData(groups, tabs),
  };
}

function expectSequentialIndexes(tabs: TabSnapshot[]) {
  expect(tabs.map((tab) => tab.index)).toEqual(tabs.map((_, index) => index));
}

function expectGroupIndexesMatchTabs(set: HistorySet) {
  for (const group of set.groups) {
    const indexes = set.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.index);
    if (indexes.length === 0) {
      continue;
    }
    expect(group.index).toBe(Math.min(...indexes));
  }
}

describe('applyDragReorder', () => {
  it('セッションカードの順序を並び替える', () => {
    const result = applyDragReorder(
      [
        makeSet({ id: 'set-a', groups: [], tabs: [] }),
        makeSet({ id: 'set-b', groups: [], tabs: [] }),
      ],
      { type: 'set', setId: 'set-b' },
      { type: 'set-list', index: 0 },
    );

    expect(result.map((set) => set.id)).toEqual(['set-b', 'set-a']);
  });

  it('グループを別セッションへ移動し、ID衝突時は新しいIDを付与する', () => {
    const setA = makeSet({
      id: 'set-a',
      groups: [{ uid: 'g-a', id: 1, title: 'A', color: 'blue' }],
      tabs: [
        { uid: 't-a', title: 'A1', url: 'https://a.com', groupId: 1 },
        { uid: 't-a2', title: 'A2', url: 'https://a2.com', groupId: 1 },
      ],
    });
    const setB = makeSet({
      id: 'set-b',
      groups: [{ uid: 'g-b', id: 1, title: 'B', color: 'red' }],
      tabs: [{ uid: 't-b', title: 'B1', url: 'https://b.com', groupId: 1 }],
    });

    const result = applyDragReorder(
      [setA, setB],
      { type: 'group', setId: 'set-a', groupUid: 'g-a' },
      { type: 'block-list', setId: 'set-b', index: 1 },
    );

    const target = result.find((set) => set.id === 'set-b')!;
    const movedGroup = target.groups.find((group) => group.uid === 'g-a')!;

    expect(movedGroup.id).not.toBe(1);
    expect(target.groups.map((group) => group.uid)).toEqual(['g-b', 'g-a']);
    expect(target.tabs.filter((tab) => tab.uid === 't-a').length).toBe(1);
    expect(target.tabs.find((tab) => tab.uid === 't-a')?.groupId).toBe(movedGroup.id);
    expectSequentialIndexes(target.tabs);
    expectGroupIndexesMatchTabs(target);
  });

  it('タブを別セッションのグループへ移動する', () => {
    const setA = makeSet({
      id: 'set-a',
      groups: [{ uid: 'g-a', id: 1, title: 'A', color: 'blue' }],
      tabs: [{ uid: 't-a', title: 'A1', url: 'https://a.com', groupId: 1 }],
    });
    const setB = makeSet({
      id: 'set-b',
      groups: [{ uid: 'g-b', id: 2, title: 'B', color: 'red' }],
      tabs: [{ uid: 't-b', title: 'B1', url: 'https://b.com', groupId: 2 }],
    });

    const result = applyDragReorder(
      [setA, setB],
      { type: 'tab', setId: 'set-a', tabUid: 't-a' },
      { type: 'tab-list', setId: 'set-b', groupUid: 'g-b', index: 0 },
    );

    const source = result.find((set) => set.id === 'set-a')!;
    const target = result.find((set) => set.id === 'set-b')!;

    expect(source.groups.length).toBe(1);
    expect(target.tabs.map((tab) => tab.uid)).toEqual(['t-a', 't-b']);
    expect(target.tabs.find((tab) => tab.uid === 't-a')?.groupId).toBe(2);
    expectSequentialIndexes(target.tabs);
  });

  it('タブを未グループへ移動しても空グループを維持する', () => {
    const set = makeSet({
      id: 'set-a',
      groups: [{ uid: 'g-a', id: 1, title: 'A', color: 'blue' }],
      tabs: [
        { uid: 't-a', title: 'A1', url: 'https://a.com', groupId: 1 },
        { uid: 't-b', title: 'B1', url: 'https://b.com', groupId: null },
      ],
    });

    const result = applyDragReorder(
      [set],
      { type: 'tab', setId: 'set-a', tabUid: 't-a' },
      { type: 'block-list', setId: 'set-a', index: 2 },
    );

    const updated = result[0];
    expect(updated.groups.length).toBe(1);
    expect(updated.tabs.map((tab) => tab.uid)).toEqual(['t-b', 't-a']);
    expect(updated.tabs.find((tab) => tab.uid === 't-a')?.groupId).toBeNull();
    expectSequentialIndexes(updated.tabs);
    expect(updated.layout.map((item) => `${item.type}:${item.uid}`)).toEqual([
      'group:g-a',
      'tab:t-b',
      'tab:t-a',
    ]);
  });
});
