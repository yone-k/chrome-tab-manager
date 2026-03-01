import { describe, expect, it } from 'vitest';

import type { HistorySet } from '../tab-manager/types';
import { removeSetsEmptiedSince } from './setCleanup';

function createSet(id: string, tabCount: number): HistorySet {
  return {
    id,
    name: id,
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [],
    tabs: Array.from({ length: tabCount }, (_, index) => ({
      uid: `${id}-tab-${index}`,
      title: `${id}-${index}`,
      url: `https://example.com/${id}/${index}`,
      index,
      groupId: null,
      locked: false,
    })),
    layout: [],
  };
}

describe('removeSetsEmptiedSince', () => {
  it('移動によって新たに空になったセットを除外する', () => {
    const previous = [createSet('a', 1), createSet('b', 1)];
    const next = [createSet('a', 0), createSet('b', 2)];

    const result = removeSetsEmptiedSince(previous, next);

    expect(result.map((set) => set.id)).toEqual(['b']);
  });

  it('もともと空のセットは維持する', () => {
    const previous = [createSet('a', 0), createSet('b', 1)];
    const next = [createSet('a', 0), createSet('b', 1)];

    const result = removeSetsEmptiedSince(previous, next);

    expect(result.map((set) => set.id)).toEqual(['a', 'b']);
  });
});
