import { DEFAULT_EXCLUSIONS, normalizeExclusions } from './exclusions';
import { formatHistorySetNameFromCreatedAt, normalizeManualHistorySetName } from './history';
import type { HistorySet, TabManagerState, ThemeMode } from './types';
import { normalizeLayout } from './layout';
import { createUid } from './uid';

export const STATE_KEY = 'tabManagerState';

export const CARD_HEIGHT_MIN = 360;
export const CARD_HEIGHT_MAX = 1080;
export const CARD_HEIGHT_DEFAULT = 540;

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
    themeMode: 'system',
    cardHeight: null,
  };
}

export function wrapChromeStorage(storageArea: chrome.storage.StorageArea): StorageAreaLike {
  return {
    get: (keys) =>
      new Promise((resolve, reject) => {
        storageArea.get(keys, (items: Record<string, unknown>) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(items ?? {});
        });
      }),
    set: (items) =>
      new Promise((resolve, reject) => {
        storageArea.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
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

function normalizeLocked(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return false;
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

export function clampCardHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.max(CARD_HEIGHT_MIN, Math.min(CARD_HEIGHT_MAX, value)));
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
        locked: normalizeLocked(group.locked),
      }));
      const normalizedTabs = tabs.filter(isRecord).map((tab) => {
        const favIconUrl =
          typeof tab.favIconUrl === 'string' && tab.favIconUrl.trim().length > 0
            ? tab.favIconUrl
            : undefined;
        return {
          uid: typeof tab.uid === 'string' ? tab.uid : createUid('tab'),
          title: typeof tab.title === 'string' ? tab.title : '',
          url: typeof tab.url === 'string' ? tab.url : '',
          ...(favIconUrl ? { favIconUrl } : {}),
          index: typeof tab.index === 'number' ? tab.index : 0,
          groupId: typeof tab.groupId === 'number' ? tab.groupId : null,
          locked: normalizeLocked(tab.locked),
        };
      });
      const normalizedSet: HistorySet = {
        id: typeof raw.id === 'string' ? raw.id : createUid('set'),
        name: normalizedName,
        createdAt,
        windowId: typeof raw.windowId === 'number' ? raw.windowId : 0,
        locked: normalizeLocked(raw.locked),
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
    themeMode: normalizeThemeMode(raw.themeMode),
    cardHeight: clampCardHeight(raw.cardHeight),
  };
}

function promoteLockedAncestorsInRawSet(raw: unknown) {
  if (!isRecord(raw)) {
    return raw;
  }
  const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter(isRecord) : [];
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  let hasGroupPromotion = false;
  const nextGroups = groups.map((group) => {
    if (!isRecord(group) || typeof group.id !== 'number') {
      return group;
    }
    const groupedTabs = tabs.filter((tab) => tab.groupId === group.id);
    const shouldLock =
      groupedTabs.length > 0 && groupedTabs.every((tab) => normalizeLocked(tab.locked));
    if (shouldLock && !normalizeLocked(group.locked)) {
      hasGroupPromotion = true;
      return {
        ...group,
        locked: true,
      };
    }
    return group;
  });
  const shouldLockSet = tabs.length > 0 && tabs.every((tab) => normalizeLocked(tab.locked));
  const hasSetPromotion = shouldLockSet && !normalizeLocked(raw.locked);
  if (!hasGroupPromotion && !hasSetPromotion) {
    return raw;
  }
  return {
    ...raw,
    locked: hasSetPromotion ? true : raw.locked,
    groups: nextGroups,
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

export async function prependHistorySet(
  historySet: HistorySet,
  maxHistorySets: number,
  storage: StorageAreaLike = wrapChromeStorage(chrome.storage.local),
) {
  const result = await storage.get([STATE_KEY]);
  const rawState = isRecord(result[STATE_KEY]) ? result[STATE_KEY] : {};
  const defaults = getDefaultState();
  const rawHistorySets = Array.isArray(rawState.historySets) ? rawState.historySets : [];
  const nextHistorySets = [historySet, ...rawHistorySets.map(promoteLockedAncestorsInRawSet)].slice(
    0,
    maxHistorySets,
  );
  const nextRawState: Record<string, unknown> = {
    version: 1,
    exclusions: Array.isArray(rawState.exclusions) ? rawState.exclusions : defaults.exclusions,
    restoreLoadingSuppressionEnabled:
      typeof rawState.restoreLoadingSuppressionEnabled === 'boolean'
        ? rawState.restoreLoadingSuppressionEnabled
        : defaults.restoreLoadingSuppressionEnabled,
    removeRestoredTabsEnabled:
      typeof rawState.removeRestoredTabsEnabled === 'boolean'
        ? rawState.removeRestoredTabsEnabled
        : defaults.removeRestoredTabsEnabled,
    themeMode: normalizeThemeMode(rawState.themeMode),
    cardHeight: clampCardHeight(rawState.cardHeight),
    historySets: nextHistorySets,
  };
  await storage.set({ [STATE_KEY]: nextRawState });
  return coerceState(nextRawState);
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
