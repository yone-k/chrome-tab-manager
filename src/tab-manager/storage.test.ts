import { describe, expect, it } from 'vitest';

import { getDefaultState, getState, setState, updateState } from './storage';

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
            groups: [{ uid: 'g-1', id: 1, title: 'Work', color: 'blue', index: 0 }],
            tabs: [
              { uid: 't-1', title: 'Docs', url: 'https://docs.example.com', index: 0, groupId: 1 },
              {
                uid: 't-2',
                title: 'Mail',
                url: 'https://mail.example.com',
                index: 1,
                groupId: null,
              },
            ],
          },
        ],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.layout.map((item) => item.type)).toEqual(['group', 'tab']);
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
  });

  it('name が空文字の履歴セットは既定名へ補完する', async () => {
    const storage = createMemoryStorage({
      tabManagerState: {
        version: 1,
        exclusions: [],
        historySets: [{ id: 'set-5', name: ' ', createdAt: 1, windowId: 1, groups: [], tabs: [] }],
      },
    });

    const state = await getState(storage);

    expect(state.historySets[0]?.name).toBe('新規ウィンドウ');
  });
});
