import { describe, expect, it } from 'vitest';

import { buildHistorySet, createHistoryId } from './history';

describe('buildHistorySet', () => {
  it('タブ順序を保ち、参照されているグループのみを残す', () => {
    const result = buildHistorySet({
      id: 'set-1',
      name: 'window-1',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: {
        managerTabId: 10,
        managerWindowId: 5,
      },
      tabs: [
        { title: 'A', url: 'https://a.com', index: 2, groupId: 1 },
        { title: 'B', url: 'https://b.com', index: 1, groupId: -1 },
        { title: 'C', url: 'https://c.com', index: 3, groupId: 2 },
      ],
      groups: [
        { id: 1, title: 'Work', color: 'blue', index: 0 },
        { id: 2, title: 'Read', color: 'red', index: 1 },
        { id: 3, title: 'Unused', color: 'yellow', index: 2 },
      ],
    });

    expect(result.tabs.map((tab) => tab.title)).toEqual(['B', 'A', 'C']);
    expect(result.tabs[0].groupId).toBeNull();
    expect(result.groups.map((group) => group.id)).toEqual([1, 2]);
    expect(result.layout.map((item) => item.type)).toEqual(['tab', 'group', 'group']);
    expect(result).toMatchObject({
      id: 'set-1',
      name: 'window-1',
      createdAt: 1700000000000,
      windowId: 5,
      locked: false,
      managerBinding: { managerTabId: 10, managerWindowId: 5 },
    });
    expect(result.groups.every((group) => group.locked === false)).toBe(true);
    expect(result.tabs.every((tab) => tab.locked === false)).toBe(true);
  });

  it('名前が空文字の場合は既定名へフォールバックする', () => {
    const result = buildHistorySet({
      id: 'set-2',
      name: '   ',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: null,
      tabs: [],
      groups: [],
    });

    expect(result.name).toBe('新規ウィンドウ');
  });
});

describe('createHistoryId', () => {
  it('一意な識別子を返す', () => {
    const first = createHistoryId();
    const second = createHistoryId();

    expect(first).not.toBe(second);
    expect(typeof first).toBe('string');
  });
});
