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
  it('returns default state when nothing is stored', async () => {
    const storage = createMemoryStorage();
    const state = await getState(storage);

    expect(state).toEqual(getDefaultState());
  });

  it('fills in restore suppression defaults when missing', async () => {
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

  it('persists state through setState', async () => {
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

  it('supports functional updates with normalization', async () => {
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
