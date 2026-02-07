import type { GroupSnapshot, LayoutItem, TabSnapshot } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLayoutItem(value: unknown): value is LayoutItem {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'group') {
    return typeof value.uid === 'string';
  }
  if (value.type === 'tab') {
    return typeof value.uid === 'string';
  }
  return false;
}

function buildLayoutFromTabs(groups: GroupSnapshot[], tabs: TabSnapshot[]): LayoutItem[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const layout: LayoutItem[] = [];
  const seenGroupUid = new Set<string>();
  const seenTabUid = new Set<string>();

  for (const tab of sortedTabs) {
    if (tab.groupId === null) {
      if (!seenTabUid.has(tab.uid)) {
        layout.push({ type: 'tab', uid: tab.uid });
        seenTabUid.add(tab.uid);
      }
      continue;
    }
    const group = groupById.get(tab.groupId);
    if (!group) {
      if (!seenTabUid.has(tab.uid)) {
        layout.push({ type: 'tab', uid: tab.uid });
        seenTabUid.add(tab.uid);
      }
      continue;
    }
    if (!seenGroupUid.has(group.uid)) {
      layout.push({ type: 'group', uid: group.uid });
      seenGroupUid.add(group.uid);
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.index - b.index);
  for (const group of sortedGroups) {
    if (!seenGroupUid.has(group.uid)) {
      layout.push({ type: 'group', uid: group.uid });
      seenGroupUid.add(group.uid);
    }
  }

  return layout;
}

export function normalizeLayout(
  layout: unknown,
  groups: GroupSnapshot[],
  tabs: TabSnapshot[],
): LayoutItem[] {
  const rawItems = Array.isArray(layout) ? layout : [];
  if (rawItems.length === 0) {
    return buildLayoutFromTabs(groups, tabs);
  }
  const groupByUid = new Map(groups.map((group) => [group.uid, group]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const tabByUid = new Map(tabs.map((tab) => [tab.uid, tab]));
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const normalized: LayoutItem[] = [];
  const seenGroupUid = new Set<string>();
  const seenTabUid = new Set<string>();

  for (const rawItem of rawItems) {
    if (!isLayoutItem(rawItem)) {
      continue;
    }
    if (rawItem.type === 'group') {
      const group = groupByUid.get(rawItem.uid);
      if (group && !seenGroupUid.has(group.uid)) {
        normalized.push({ type: 'group', uid: group.uid });
        seenGroupUid.add(group.uid);
      }
      continue;
    }
    const tab = tabByUid.get(rawItem.uid);
    if (!tab || seenTabUid.has(tab.uid)) {
      continue;
    }
    const group = tab.groupId !== null ? groupById.get(tab.groupId) : null;
    if (tab.groupId === null || !group) {
      normalized.push({ type: 'tab', uid: tab.uid });
      seenTabUid.add(tab.uid);
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.index - b.index);
  for (const group of sortedGroups) {
    if (!seenGroupUid.has(group.uid)) {
      normalized.push({ type: 'group', uid: group.uid });
      seenGroupUid.add(group.uid);
    }
  }

  for (const tab of sortedTabs) {
    if (seenTabUid.has(tab.uid)) {
      continue;
    }
    const group = tab.groupId !== null ? groupById.get(tab.groupId) : null;
    if (tab.groupId === null || !group) {
      normalized.push({ type: 'tab', uid: tab.uid });
      seenTabUid.add(tab.uid);
    }
  }

  return normalized;
}

export function buildLayoutFromData(groups: GroupSnapshot[], tabs: TabSnapshot[]): LayoutItem[] {
  return buildLayoutFromTabs(groups, tabs);
}
