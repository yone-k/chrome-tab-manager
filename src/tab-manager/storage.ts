import { DEFAULT_EXCLUSIONS, normalizeExclusions } from './exclusions';
import { formatHistorySetNameFromCreatedAt, normalizeManualHistorySetName } from './history';
import type { HistorySet, TabManagerState } from './types';
import { normalizeLayout } from './layout';
import { createUid } from './uid';

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

const TAB_GROUP_COLORS: ReadonlyArray<chrome.tabGroups.ColorEnum> = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

function isTabGroupColor(value: unknown): value is chrome.tabGroups.ColorEnum {
  return typeof value === 'string' && TAB_GROUP_COLORS.some((color) => color === value);
}

function normalizeManagerBinding(raw: unknown): HistorySet['managerBinding'] {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.managerTabId !== 'number' || typeof raw.managerWindowId !== 'number') {
    return null;
  }
  return {
    managerTabId: raw.managerTabId,
    managerWindowId: raw.managerWindowId,
  };
}

function normalizeHistorySets(rawSets: unknown): HistorySet[] {
  if (!Array.isArray(rawSets)) {
    return [];
  }

  return rawSets
    .map((raw) => {
      if (!isRecord(raw)) {
        return null;
      }
      const groups = Array.isArray(raw.groups) ? raw.groups : [];
      const tabs = Array.isArray(raw.tabs) ? raw.tabs : [];
      const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
      const normalizedName =
        typeof raw.name === 'string'
          ? normalizeManualHistorySetName(raw.name)
          : formatHistorySetNameFromCreatedAt(createdAt);
      const normalizedGroups = groups.filter(isRecord).map((group) => ({
        uid: typeof group.uid === 'string' ? group.uid : createUid('group'),
        id: typeof group.id === 'number' ? group.id : 0,
        title: typeof group.title === 'string' ? group.title : 'Untitled Group',
        color: isTabGroupColor(group.color) ? group.color : 'grey',
        index: typeof group.index === 'number' ? group.index : 0,
      }));
      const normalizedTabs = tabs.filter(isRecord).map((tab) => ({
        uid: typeof tab.uid === 'string' ? tab.uid : createUid('tab'),
        title: typeof tab.title === 'string' ? tab.title : '',
        url: typeof tab.url === 'string' ? tab.url : '',
        index: typeof tab.index === 'number' ? tab.index : 0,
        groupId: typeof tab.groupId === 'number' ? tab.groupId : null,
      }));
      const normalizedSet: HistorySet = {
        id: typeof raw.id === 'string' ? raw.id : createUid('set'),
        name: normalizedName,
        createdAt,
        windowId: typeof raw.windowId === 'number' ? raw.windowId : 0,
        managerBinding: normalizeManagerBinding(raw.managerBinding),
        groups: normalizedGroups,
        tabs: normalizedTabs,
        layout: normalizeLayout(raw.layout, normalizedGroups, normalizedTabs),
      };
      return normalizedSet;
    })
    .filter((set): set is HistorySet => set !== null);
}

function coerceState(raw: unknown): TabManagerState {
  const defaults = getDefaultState();
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    version: 1,
    historySets: normalizeHistorySets(raw.historySets),
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
