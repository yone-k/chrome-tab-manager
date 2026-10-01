import { describe, expect, it } from 'vitest';
import { pinSetsToFront, resolveStoredSetDropIndex } from './pinnedOrder';

const sets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('pinSetsToFront', () => {
  it('ピン留め対象を先頭に移動し、それ以外の順序を保持する', () => {
    const result = pinSetsToFront(sets, (set) => set.id === 'c');
    expect(result.map((set) => set.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('複数のピン留め対象は元の順序を保持する', () => {
    const result = pinSetsToFront(sets, (set) => set.id === 'd' || set.id === 'b');
    expect(result.map((set) => set.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('ピン留め対象がなければ同じ配列を返す', () => {
    expect(pinSetsToFront(sets, () => false)).toBe(sets);
  });
});

describe('resolveStoredSetDropIndex', () => {
  const displaySets = pinSetsToFront(sets, (set) => set.id === 'c');

  it('表示上の挿入位置を、その位置にあるセットの保存順インデックスに変換する', () => {
    expect(resolveStoredSetDropIndex(sets, displaySets, 0)).toBe(2);
    expect(resolveStoredSetDropIndex(sets, displaySets, 1)).toBe(0);
    expect(resolveStoredSetDropIndex(sets, displaySets, 3)).toBe(3);
  });

  it('末尾への挿入は保存順の末尾に変換する', () => {
    expect(resolveStoredSetDropIndex(sets, displaySets, 4)).toBe(4);
  });
});
