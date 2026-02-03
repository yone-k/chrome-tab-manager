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
          createdAt: 1,
          windowId: 2,
          tabs: [],
          groups: [],
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
          createdAt: 2,
          windowId: 3,
          tabs: [],
          groups: [],
        },
      ],
    }));

    expect(updated.exclusions).toEqual(['example.com']);
    expect(updated.historySets).toHaveLength(1);
  });
});
