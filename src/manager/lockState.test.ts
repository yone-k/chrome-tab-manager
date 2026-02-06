import { describe, expect, it } from 'vitest';

import type { HistorySet } from '../tab-manager/types';
import {
  applyGroupLock,
  applySetLock,
  isGroupEffectivelyLocked,
  isTabEffectivelyLocked,
} from './lockState';

function createSet(): HistorySet {
  return {
    id: 'set-1',
    name: 'window-1',
    createdAt: 1,
    windowId: 1,
    locked: false,
    managerBinding: null,
    groups: [
      { uid: 'g-1', id: 1, title: 'group-1', color: 'blue', index: 0, locked: false },
      { uid: 'g-2', id: 2, title: 'group-2', color: 'red', index: 1, locked: true },
    ],
    tabs: [
      {
        uid: 't-1',
        title: 'tab-1',
        url: 'https://a.example.com',
        index: 0,
        groupId: 1,
        locked: false,
      },
      {
        uid: 't-2',
        title: 'tab-2',
        url: 'https://b.example.com',
        index: 1,
        groupId: 2,
        locked: false,
      },
      {
        uid: 't-3',
        title: 'tab-3',
        url: 'https://c.example.com',
        index: 2,
        groupId: null,
        locked: true,
      },
    ],
    layout: [],
  };
}

describe('isGroupEffectivelyLocked', () => {
  it('セットロック時は配下グループをロックとして扱う', () => {
    const set = { ...createSet(), locked: true };
    expect(isGroupEffectivelyLocked(set, 'g-1')).toBe(true);
  });

  it('グループ個別ロックを判定する', () => {
    const set = createSet();
    expect(isGroupEffectivelyLocked(set, 'g-1')).toBe(false);
    expect(isGroupEffectivelyLocked(set, 'g-2')).toBe(true);
  });
});

describe('isTabEffectivelyLocked', () => {
  it('セットロック時は配下タブをロックとして扱う', () => {
    const set = { ...createSet(), locked: true };
    expect(isTabEffectivelyLocked(set, set.tabs[0]!)).toBe(true);
  });

  it('タブ個別ロックを判定する', () => {
    const set = createSet();
    expect(isTabEffectivelyLocked(set, set.tabs[2]!)).toBe(true);
  });

  it('所属グループのロックを判定する', () => {
    const set = createSet();
    expect(isTabEffectivelyLocked(set, set.tabs[0]!)).toBe(false);
    expect(isTabEffectivelyLocked(set, set.tabs[1]!)).toBe(true);
  });
});

describe('applySetLock', () => {
  it('セットをロックしたとき配下グループとタブをロックする', () => {
    const set = createSet();
    const result = applySetLock(set, true);

    expect(result.locked).toBe(true);
    expect(result.groups.every((group) => group.locked)).toBe(true);
    expect(result.tabs.every((tab) => tab.locked)).toBe(true);
  });

  it('セットのロック解除時は配下グループとタブをすべて解除する', () => {
    const set = applySetLock(createSet(), true);
    const result = applySetLock(set, false);

    expect(result.locked).toBe(false);
    expect(result.groups.every((group) => !group.locked)).toBe(true);
    expect(result.tabs.every((tab) => !tab.locked)).toBe(true);
  });
});

describe('applyGroupLock', () => {
  it('グループをロックしたとき配下タブをロックする', () => {
    const set = createSet();
    const result = applyGroupLock(set, 'g-1', true);

    expect(result.groups.find((group) => group.uid === 'g-1')?.locked).toBe(true);
    expect(result.tabs.find((tab) => tab.uid === 't-1')?.locked).toBe(true);
  });

  it('グループのロック解除時は親セットをロックせず配下タブを解除する', () => {
    const set = applyGroupLock(createSet(), 'g-1', true);
    const result = applyGroupLock(set, 'g-1', false);

    expect(result.locked).toBe(false);
    expect(result.groups.find((group) => group.uid === 'g-1')?.locked).toBe(false);
    expect(result.tabs.find((tab) => tab.uid === 't-1')?.locked).toBe(false);
  });
});
