import { describe, expect, it } from 'vitest';

import { buildLayoutFromData, normalizeLayout } from '../tab-manager/layout';
import type { HistorySet } from '../tab-manager/types';
import { createGroupAtTop } from './groupCreate';

function createSet(): HistorySet {
  const set: HistorySet = {
    id: 'set-1',
    name: 'window',
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [
      { uid: 'g-1', id: 1, title: 'group-1', color: 'blue', index: 0, locked: false },
      { uid: 'g-2', id: 5, title: 'group-2', color: 'red', index: 1, locked: false },
    ],
    tabs: [
      {
        uid: 't-1',
        title: 't-1',
        url: 'https://1.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-2',
        title: 't-2',
        url: 'https://2.example.com',
        index: 1,
        groupId: null,
        locked: false,
      },
    ],
    layout: [],
  };

  set.layout = buildLayoutFromData(set.groups, set.tabs);
  return set;
}

describe('createGroupAtTop', () => {
  it('新規グループを先頭に追加し、既存レイアウトの先頭にも挿入する', () => {
    const set = createSet();
    const previousLayout = normalizeLayout(set.layout, set.groups, set.tabs);

    const updated = createGroupAtTop(set, 'g-new');

    expect(updated.groups[0]).toMatchObject({
      uid: 'g-new',
      id: 6,
      title: '新規グループ',
      color: 'grey',
      locked: false,
    });
    expect(updated.layout[0]).toEqual({ type: 'group', uid: 'g-new' });
    expect(updated.layout.slice(1)).toEqual(previousLayout);
  });

  it('既存グループがない場合は id=1 で作成する', () => {
    const set = { ...createSet(), groups: [], layout: [] };

    const updated = createGroupAtTop(set, 'g-first');

    expect(updated.groups).toHaveLength(1);
    expect(updated.groups[0]?.id).toBe(1);
    expect(updated.layout[0]).toEqual({ type: 'group', uid: 'g-first' });
  });
});
