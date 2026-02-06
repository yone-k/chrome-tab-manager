import type { GroupSnapshot, HistorySet, TabSnapshot } from './types';
import { buildLayoutFromData } from './layout';
import { createUid } from './uid';

export const DEFAULT_NEW_WINDOW_NAME = '新規ウィンドウ';

export type TabInput = {
  title?: string;
  url?: string;
  index: number;
  groupId?: number;
};

export type GroupInput = {
  id: number;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
  index?: number;
};

type BuildHistorySetInput = {
  id: string;
  name: string;
  createdAt: number;
  windowId: number;
  tabs: TabInput[];
  groups: GroupInput[];
};

export function formatHistorySetNameFromCreatedAt(createdAt: number) {
  return new Date(createdAt).toLocaleString();
}

export function normalizeManualHistorySetName(name: string) {
  const normalized = name.trim();
  return normalized.length > 0 ? normalized : DEFAULT_NEW_WINDOW_NAME;
}

function normalizeTab(tab: TabInput): TabSnapshot {
  const title = tab.title?.trim() || tab.url || 'Untitled';
  const url = tab.url ?? '';
  const groupId = tab.groupId !== undefined && tab.groupId >= 0 ? tab.groupId : null;

  return {
    uid: createUid('tab'),
    title,
    url,
    index: tab.index,
    groupId,
  };
}

function normalizeGroup(group: GroupInput, fallbackIndex: number): GroupSnapshot {
  return {
    uid: createUid('group'),
    id: group.id,
    title: group.title?.trim() || 'Untitled Group',
    color: group.color ?? 'grey',
    index: group.index ?? fallbackIndex,
  };
}

export function buildHistorySet(input: BuildHistorySetInput): HistorySet {
  const tabs = [...input.tabs].sort((a, b) => a.index - b.index).map((tab) => normalizeTab(tab));

  const groupIds = new Set<number>();
  const groupIndexById = new Map<number, number>();
  for (const tab of tabs) {
    if (tab.groupId !== null) {
      groupIds.add(tab.groupId);
      const existingIndex = groupIndexById.get(tab.groupId);
      if (existingIndex === undefined || tab.index < existingIndex) {
        groupIndexById.set(tab.groupId, tab.index);
      }
    }
  }

  const groups = input.groups
    .filter((group) => groupIds.has(group.id))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((group) => normalizeGroup(group, groupIndexById.get(group.id) ?? 0))
    .sort((a, b) => a.index - b.index);

  return {
    id: input.id,
    name: normalizeManualHistorySetName(input.name),
    createdAt: input.createdAt,
    windowId: input.windowId,
    tabs,
    groups,
    layout: buildLayoutFromData(groups, tabs),
  };
}

export function createHistoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `set-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
