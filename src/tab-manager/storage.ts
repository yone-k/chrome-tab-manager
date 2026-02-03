import { DEFAULT_EXCLUSIONS, normalizeExclusions } from './exclusions';
import type { TabManagerState } from './types';

export const STATE_KEY = 'tabManagerState';

export type StorageAreaLike = {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export function getDefaultState(): TabManagerState {
  return {
    version: 1,
    historySets: [],
    exclusions: normalizeExclusions(DEFAULT_EXCLUSIONS),
    restoreLoadingSuppressionEnabled: true,
    removeRestoredTabsEnabled: true,
  };
}

export function wrapChromeStorage(storageArea: chrome.storage.StorageArea): StorageAreaLike {
  return {
    get: (keys) =>
      new Promise((resolve) => {
        storageArea.get(keys, (items: Record<string, unknown>) => {
          resolve(items ?? {});
        });
      }),
    set: (items) =>
      new Promise((resolve) => {
        storageArea.set(items, () => {
          resolve();
        });
      }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceState(raw: unknown): TabManagerState {
  const defaults = getDefaultState();
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    version: 1,
    historySets: Array.isArray(raw.historySets) ? raw.historySets : [],
    exclusions: normalizeExclusions(
      Array.isArray(raw.exclusions) ? raw.exclusions.map(String) : defaults.exclusions,
    ),
    restoreLoadingSuppressionEnabled:
      typeof raw.restoreLoadingSuppressionEnabled === 'boolean'
        ? raw.restoreLoadingSuppressionEnabled
        : defaults.restoreLoadingSuppressionEnabled,
    removeRestoredTabsEnabled:
      typeof raw.removeRestoredTabsEnabled === 'boolean'
        ? raw.removeRestoredTabsEnabled
        : defaults.removeRestoredTabsEnabled,
  };
}

export async function getState(storage: StorageAreaLike = wrapChromeStorage(chrome.storage.local)) {
  const result = await storage.get([STATE_KEY]);
  return coerceState(result[STATE_KEY]);
}

export async function setState(
  storage: StorageAreaLike = wrapChromeStorage(chrome.storage.local),
  state: TabManagerState,
) {
  await storage.set({ [STATE_KEY]: state });
  return state;
}

export async function updateState(
  updater: (state: TabManagerState) => TabManagerState,
): Promise<TabManagerState>;
export async function updateState(
  storage: StorageAreaLike,
  updater: (state: TabManagerState) => TabManagerState,
): Promise<TabManagerState>;
export async function updateState(
  storageOrUpdater: StorageAreaLike | ((state: TabManagerState) => TabManagerState),
  maybeUpdater?: (state: TabManagerState) => TabManagerState,
) {
  if (typeof storageOrUpdater === 'function') {
    const storage = wrapChromeStorage(chrome.storage.local);
    const updater = storageOrUpdater;
    const current = await getState(storage);
    const next = updater(current);
    await setState(storage, next);
    return next;
  }

  if (!maybeUpdater) {
    throw new Error('Missing updater function.');
  }

  const storage = storageOrUpdater;
  const updater = maybeUpdater;

  const current = await getState(storage);
  const next = updater(current);
  await setState(storage, next);
  return next;
}
