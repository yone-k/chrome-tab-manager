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
        {
          title: 'A',
          url: 'https://a.com',
          index: 2,
          groupId: 1,
          favIconUrl: 'https://a.com/favicon.ico',
        },
        { title: 'B', url: 'https://b.com', index: 1, groupId: -1, favIconUrl: '   ' },
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
    expect(result.tabs[1]?.favIconUrl).toBe('https://a.com/favicon.ico');
    expect(result.tabs[0]?.favIconUrl).toBeUndefined();
  });

  it('sessionId 付きタブから正しい TabSnapshot が生成される', () => {
    const result = buildHistorySet({
      id: 'set-session',
      name: 'window-session',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: null,
      tabs: [
        {
          title: 'A',
          url: 'https://a.com',
          index: 0,
          sessionId: 'session-abc-123',
        },
      ],
      groups: [],
    });

    expect(result.tabs[0]?.sessionId).toBe('session-abc-123');
  });

  it('sessionId なしの場合は TabSnapshot に sessionId が含まれない', () => {
    const result = buildHistorySet({
      id: 'set-no-session',
      name: 'window-no-session',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: null,
      tabs: [
        {
          title: 'B',
          url: 'https://b.com',
          index: 0,
        },
      ],
      groups: [],
    });

    expect(result.tabs[0]?.sessionId).toBeUndefined();
    expect('sessionId' in result.tabs[0]!).toBe(false);
  });

  it('sessionId が空文字の場合は TabSnapshot に含まれない', () => {
    const result = buildHistorySet({
      id: 'set-empty-sid',
      name: 'test',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: null,
      tabs: [
        {
          title: 'Tab',
          url: 'https://example.com',
          index: 0,
          sessionId: '',
        },
      ],
      groups: [],
    });

    // normalizeTab は falsy チェック (tab.sessionId ?) で空文字を除外する
    expect(result.tabs[0]?.sessionId).toBeUndefined();
    expect('sessionId' in result.tabs[0]!).toBe(false);
  });

  it('sessionId 付きタブと sessionId なしタブが混在する場合', () => {
    const result = buildHistorySet({
      id: 'set-mixed',
      name: 'mixed',
      createdAt: 1700000000000,
      windowId: 5,
      managerBinding: null,
      tabs: [
        { title: 'With', url: 'https://with.com', index: 0, sessionId: 'ses-1' },
        { title: 'Without', url: 'https://without.com', index: 1 },
        { title: 'Also With', url: 'https://also.com', index: 2, sessionId: 'ses-2' },
      ],
      groups: [],
    });

    expect(result.tabs[0]?.sessionId).toBe('ses-1');
    expect(result.tabs[1]?.sessionId).toBeUndefined();
    expect('sessionId' in result.tabs[1]!).toBe(false);
    expect(result.tabs[2]?.sessionId).toBe('ses-2');
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
