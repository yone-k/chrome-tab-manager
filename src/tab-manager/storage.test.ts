import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultState, getState, setState, updateState, wrapChromeStorage } from './storage';

function createMemoryStorage(initial: Record<string, unknown> = {}) {
  let store = { ...initial };

  return {
    get: async (keys: string[]) => {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = store[key];
      }
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      store = { ...store, ...items };
    },
    dump: () => store,
  };
}

describe('storage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('保存がない場合はデフォルト状態を返す', async () => {
    const storage = createMemoryStorage();
    const state = await getState(storage);

    expect(state).toEqual(getDefaultState());
  });

  it('復元抑制のデフォルト値を補完する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
      },
    });

    const state = await getState(storage);

    expect(state.restoreLoadingSuppressionEnabled).toBe(true);
    expect(state.removeRestoredTabsEnabled).toBe(true);
    expect(state.themeMode).toBe('system');
  });

  it('themeMode の不正値は system に正規化する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        themeMode: 'unknown',
      },
    });

    const state = await getState(storage);
    expect(state.themeMode).toBe('system');
  });

  it('setState で状態を永続化する', async () => {
    const storage = createMemoryStorage();
    const nextState = {
      ...getDefaultState(),
      historySets: [
        {
          id: 'set-1',
          name: 'window-1',
          createdAt: 1,
          windowId: 2,
          locked: false,
          managerBinding: null,
          tabs: [],
          groups: [],
          layout: [],
        },
      ],
    };

    await setState(storage, nextState);
    const state = await getState(storage);

    expect(state).toEqual(nextState);
  });

  it('updateState で themeMode を保持できる', async () => {
    const storage = createMemoryStorage();
    const updated = await updateState(storage, (state) => ({
      ...state,
      themeMode: 'dark',
    }));

    expect(updated.themeMode).toBe('dark');
    const persisted = await getState(storage);
    expect(persisted.themeMode).toBe('dark');
  });

  it('正規化を伴う関数更新に対応する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [' Example.com '],
      },
    });

    const updated = await updateState(storage, (state) => ({
      ...state,
      historySets: [
        {
          id: 'set-2',
          name: 'window-2',
          createdAt: 2,
          windowId: 3,
          locked: false,
          managerBinding: null,
          tabs: [],
          groups: [],
          layout: [],
        },
      ],
    }));

    expect(updated.exclusions).toEqual(['example.com']);
    expect(updated.historySets).toHaveLength(1);
  });

  it('履歴セットのレイアウトを補完する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-3',
            createdAt: 3,
            windowId: 4,
            name: 'window-3',
            locked: false,
            managerBinding: { managerTabId: 99, managerWindowId: 4 },
            groups: [{ uid: 'g-1', id: 1, title: 'Work', color: 'blue', index: 0, locked: false }],
            tabs: [
              {
                uid: 't-1',
                title: 'Docs',
                url: 'https://docs.example.com',
                index: 0,
                groupId: 1,
                locked: false,
              },
              {
                uid: 't-2',
                title: 'Mail',
                url: 'https://mail.example.com',
                index: 1,
                groupId: null,
                locked: false,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.layout.map((item) => item.type)).toEqual(['group', 'tab']);
  });

  it('タブの favIconUrl は非空文字列のみ保持する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-favicon',
            createdAt: 3,
            windowId: 4,
            name: 'window-favicon',
            locked: false,
            managerBinding: null,
            groups: [],
            tabs: [
              {
                uid: 't-1',
                title: 'Docs',
                url: 'https://docs.example.com',
                index: 0,
                groupId: null,
                locked: false,
                favIconUrl: 'https://docs.example.com/favicon.ico',
              },
              {
                uid: 't-2',
                title: 'Mail',
                url: 'https://mail.example.com',
                index: 1,
                groupId: null,
                locked: false,
                favIconUrl: '   ',
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    const tabs = state.historySets[0]?.tabs ?? [];

    expect(tabs[0]?.favIconUrl).toBe('https://docs.example.com/favicon.ico');
    expect(tabs[1]?.favIconUrl).toBeUndefined();
  });

  it('name が無い履歴セットは createdAt 由来で補完する', async () => {
    const createdAt = 1700000000000;
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [{ id: 'set-4', createdAt, windowId: 1, groups: [], tabs: [] }],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.name).toBe(new Date(createdAt).toLocaleString());
    expect(state.historySets[0]?.managerBinding).toBeNull();
    expect(state.historySets[0]?.locked).toBe(false);
  });

  it('name が空文字の履歴セットは既定名へ補完する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-5',
            name: ' ',
            createdAt: 1,
            windowId: 1,
            locked: false,
            managerBinding: { managerTabId: 11, managerWindowId: 1 },
            groups: [],
            tabs: [],
          },
        ],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.name).toBe('新規ウィンドウ');
    expect(state.historySets[0]?.managerBinding).toEqual({
      managerTabId: 11,
      managerWindowId: 1,
    });
  });

  it('managerBinding が不正値の場合は null に正規化する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-6',
            name: 'window-6',
            createdAt: 1,
            windowId: 1,
            locked: false,
            managerBinding: { managerTabId: 'x', managerWindowId: 1 },
            groups: [],
            tabs: [],
          },
        ],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.managerBinding).toBeNull();
  });

  it('locked が欠損している既存データは false で補完する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-7',
            name: 'window-7',
            createdAt: 1,
            windowId: 1,
            managerBinding: null,
            groups: [{ uid: 'g-7', id: 7, title: 'g', color: 'grey', index: 0 }],
            tabs: [
              {
                uid: 't-7',
                title: 'tab',
                url: 'https://example.com',
                index: 0,
                groupId: 7,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    const set = state.historySets[0];

    expect(set?.locked).toBe(false);
    expect(set?.groups[0]?.locked).toBe(false);
    expect(set?.tabs[0]?.locked).toBe(false);
  });

  it('locked の互換値を boolean へ正規化する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-8',
            name: 'window-8',
            createdAt: 1,
            windowId: 1,
            locked: 'true',
            managerBinding: null,
            groups: [
              {
                uid: 'g-8',
                id: 8,
                title: 'g',
                color: 'grey',
                index: 0,
                locked: 1,
              },
            ],
            tabs: [
              {
                uid: 't-8',
                title: 'tab',
                url: 'https://example.com',
                index: 0,
                groupId: 8,
                locked: '1',
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    const set = state.historySets[0];

    expect(set?.locked).toBe(true);
    expect(set?.groups[0]?.locked).toBe(true);
    expect(set?.tabs[0]?.locked).toBe(true);
  });

  it('wrapChromeStorage は get の lastError を reject する', async () => {
    const runtimeLastError: chrome.runtime.LastError = { message: 'storage get failed' };

    vi.stubGlobal('chrome', {
      runtime: {
        get lastError() {
          return runtimeLastError;
        },
      },
    } as unknown as typeof chrome);

    const wrapped = wrapChromeStorage({
      get: (
        _keys: string[] | string | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void,
      ) => callback({}),
      set: (_items: Record<string, unknown>, callback: () => void) => callback(),
    } as unknown as chrome.storage.StorageArea);

    await expect(wrapped.get(['tabManagerState'])).rejects.toEqual(runtimeLastError);
  });

  it('wrapChromeStorage は set の lastError を reject する', async () => {
    const runtimeLastError: chrome.runtime.LastError = { message: 'storage set failed' };

    vi.stubGlobal('chrome', {
      runtime: {
        get lastError() {
          return runtimeLastError;
        },
      },
    } as unknown as typeof chrome);

    const wrapped = wrapChromeStorage({
      get: (
        _keys: string[] | string | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void,
      ) => callback({}),
      set: (_items: Record<string, unknown>, callback: () => void) => callback(),
    } as unknown as chrome.storage.StorageArea);

    await expect(wrapped.set({ tabManagerState: {} })).rejects.toEqual(runtimeLastError);
  });

  it('cardHeight が数値の場合は範囲内にクランプする', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: 500,
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBe(500);
  });

  it('cardHeight が範囲外の場合はクランプする', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: 100,
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBe(360);
  });

  it('cardHeight が上限超の場合はクランプする', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: 2000,
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBe(1080);
  });

  it('cardHeight が null の場合はそのまま null', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: null,
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBeNull();
  });

  it('cardHeight が非数値の場合は null に正規化する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: 'invalid',
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBeNull();
  });

  it('cardHeight が未定義の場合は null に正規化する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBeNull();
  });

  it('タブの sessionId は文字列のみ保持する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-session',
            createdAt: 3,
            windowId: 4,
            name: 'window-session',
            locked: false,
            managerBinding: null,
            groups: [],
            tabs: [
              {
                uid: 't-1',
                title: 'Docs',
                url: 'https://docs.example.com',
                index: 0,
                groupId: null,
                locked: false,
                sessionId: 'session-abc-123',
              },
              {
                uid: 't-2',
                title: 'Mail',
                url: 'https://mail.example.com',
                index: 1,
                groupId: null,
                locked: false,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    const tabs = state.historySets[0]?.tabs ?? [];

    expect(tabs[0]?.sessionId).toBe('session-abc-123');
    expect(tabs[1]?.sessionId).toBeUndefined();
  });

  it('sessionId が空文字の場合は除外される', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-empty-sid',
            createdAt: 1,
            windowId: 1,
            name: 'test',
            locked: false,
            managerBinding: null,
            groups: [],
            tabs: [
              {
                uid: 't-1',
                title: 'Tab',
                url: 'https://example.com',
                index: 0,
                groupId: null,
                locked: false,
                sessionId: '',
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBeUndefined();
  });

  it('sessionId が null の場合は除外される', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-null-sid',
            createdAt: 1,
            windowId: 1,
            name: 'test',
            locked: false,
            managerBinding: null,
            groups: [],
            tabs: [
              {
                uid: 't-1',
                title: 'Tab',
                url: 'https://example.com',
                index: 0,
                groupId: null,
                locked: false,
                sessionId: null,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBeUndefined();
  });

  it('sessionId が数値や真偽値の場合は除外される', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [
          {
            id: 'set-bad-sid',
            createdAt: 1,
            windowId: 1,
            name: 'test',
            locked: false,
            managerBinding: null,
            groups: [],
            tabs: [
              {
                uid: 't-num',
                title: 'Num',
                url: 'https://num.example.com',
                index: 0,
                groupId: null,
                locked: false,
                sessionId: 12345,
              },
              {
                uid: 't-bool',
                title: 'Bool',
                url: 'https://bool.example.com',
                index: 1,
                groupId: null,
                locked: false,
                sessionId: true,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);
    expect(state.historySets[0]?.tabs[0]?.sessionId).toBeUndefined();
    expect(state.historySets[0]?.tabs[1]?.sessionId).toBeUndefined();
  });

  it('cardHeight は小数を整数に丸める', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        historySets: [],
        exclusions: [],
        cardHeight: 500.7,
      },
    });

    const state = await getState(storage);
    expect(state.cardHeight).toBe(501);
  });
});
