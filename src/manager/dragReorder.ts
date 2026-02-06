import type { GroupSnapshot, HistorySet, LayoutItem, TabSnapshot } from '../tab-manager/types';
import { normalizeLayout } from '../tab-manager/layout';

export type DragItem =
  | { type: 'set'; setId: string }
  | { type: 'group'; setId: string; groupUid: string }
  | { type: 'tab'; setId: string; tabUid: string };

export type DropTarget =
  | { type: 'set-list'; index: number }
  | { type: 'block-list'; setId: string; index: number }
  | { type: 'tab-list'; setId: string; groupUid: string; index: number };

type SetView = {
  set: HistorySet;
  groups: GroupSnapshot[];
  layout: LayoutItem[];
  tabsByGroupUid: Map<string, TabSnapshot[]>;
  ungroupedTabsByUid: Map<string, TabSnapshot>;
  groupById: Map<number, GroupSnapshot>;
  groupByUid: Map<string, GroupSnapshot>;
  tabByUid: Map<string, TabSnapshot>;
};

function clampIndex(index: number, length: number) {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length);
}

function arrayMove<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function moveLayoutItem(layout: LayoutItem[], fromIndex: number, toIndex: number) {
  const insertIndex = clampIndex(toIndex, layout.length);
  if (fromIndex === insertIndex || fromIndex + 1 === insertIndex) {
    return layout;
  }
  const adjustedIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
  return arrayMove(layout, fromIndex, adjustedIndex);
}

function buildSetView(set: HistorySet): SetView {
  const groups = [...set.groups];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupByUid = new Map(groups.map((group) => [group.uid, group]));
  const sortedTabs = [...set.tabs].sort((a, b) => a.index - b.index);
  const tabsByGroupUid = new Map<string, TabSnapshot[]>();
  const ungroupedTabsByUid = new Map<string, TabSnapshot>();
  const tabByUid = new Map<string, TabSnapshot>();

  for (const tab of sortedTabs) {
    tabByUid.set(tab.uid, tab);
    if (tab.groupId === null) {
      ungroupedTabsByUid.set(tab.uid, tab);
      continue;
    }
    const group = groupById.get(tab.groupId);
    if (!group) {
      ungroupedTabsByUid.set(tab.uid, { ...tab, groupId: null });
      continue;
    }
    const list = tabsByGroupUid.get(group.uid) ?? [];
    list.push(tab);
    tabsByGroupUid.set(group.uid, list);
  }

  const layout = normalizeLayout(set.layout, groups, sortedTabs);

  return {
    set,
    groups,
    layout,
    tabsByGroupUid,
    ungroupedTabsByUid,
    groupById,
    groupByUid,
    tabByUid,
  };
}

function materializeSet(view: SetView): HistorySet {
  const groupByUid = new Map(view.groups.map((group) => [group.uid, group]));
  const groupById = new Map(view.groups.map((group) => [group.id, group]));
  const orderedTabs: TabSnapshot[] = [];
  const seenTabUid = new Set<string>();

  for (const item of view.layout) {
    if (item.type === 'group') {
      const group = groupByUid.get(item.uid);
      if (!group) {
        continue;
      }
      const list = view.tabsByGroupUid.get(group.uid) ?? [];
      for (const tab of list) {
        orderedTabs.push({ ...tab, groupId: group.id });
        seenTabUid.add(tab.uid);
      }
      continue;
    }
    const tab = view.ungroupedTabsByUid.get(item.uid);
    if (!tab) {
      continue;
    }
    orderedTabs.push({ ...tab, groupId: null });
    seenTabUid.add(tab.uid);
  }

  for (const tab of view.tabByUid.values()) {
    if (seenTabUid.has(tab.uid)) {
      continue;
    }
    const group = tab.groupId !== null ? groupById.get(tab.groupId) : null;
    orderedTabs.push({ ...tab, groupId: group ? group.id : null });
    seenTabUid.add(tab.uid);
  }

  const normalizedTabs = orderedTabs.map((tab, index) => ({
    ...tab,
    index,
  }));

  const groupIndexById = new Map<number, number>();
  for (const tab of normalizedTabs) {
    if (tab.groupId === null || groupIndexById.has(tab.groupId)) {
      continue;
    }
    groupIndexById.set(tab.groupId, tab.index);
  }

  const normalizedGroups = view.groups.map((group) => ({
    ...group,
    index: groupIndexById.get(group.id) ?? group.index,
  }));

  return {
    ...view.set,
    groups: normalizedGroups,
    tabs: normalizedTabs,
    layout: normalizeLayout(view.layout, normalizedGroups, normalizedTabs),
  };
}

function findGroupByUid(set: HistorySet, groupUid: string) {
  return set.groups.find((group) => group.uid === groupUid);
}

function findTabByUid(set: HistorySet, tabUid: string) {
  return set.tabs.find((tab) => tab.uid === tabUid);
}

function nextGroupId(target: HistorySet) {
  const existing = target.groups.map((group) => group.id);
  if (existing.length === 0) {
    return 1;
  }
  return Math.max(...existing) + 1;
}

function updateGroupIdIfConflict(target: HistorySet, group: GroupSnapshot, tabs: TabSnapshot[]) {
  const conflict = target.groups.some((item) => item.id === group.id);
  if (!conflict) {
    return { group, tabs };
  }
  const newId = nextGroupId(target);
  return {
    group: { ...group, id: newId },
    tabs: tabs.map((tab) => ({ ...tab, groupId: newId })),
  };
}

export function applyDragReorder(
  historySets: HistorySet[],
  active: DragItem,
  target: DropTarget,
): HistorySet[] {
  if (active.type === 'set' && target.type === 'set-list') {
    const fromIndex = historySets.findIndex((set) => set.id === active.setId);
    if (fromIndex === -1) {
      return historySets;
    }
    const toIndex = clampIndex(target.index, historySets.length);
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) {
      return historySets;
    }
    const adjustedIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    return arrayMove(historySets, fromIndex, adjustedIndex);
  }

  if (active.type === 'group' && target.type === 'block-list') {
    const sourceIndex = historySets.findIndex((set) => set.id === active.setId);
    const targetIndex = historySets.findIndex((set) => set.id === target.setId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return historySets;
    }
    const source = historySets[sourceIndex];
    const targetSet = historySets[targetIndex];
    const group = findGroupByUid(source, active.groupUid);
    if (!group) {
      return historySets;
    }

    const sourceView = buildSetView(source);
    const targetView = sourceIndex === targetIndex ? sourceView : buildSetView(targetSet);
    const sourceLayoutIndex = sourceView.layout.findIndex(
      (item) => item.type === 'group' && item.uid === group.uid,
    );
    if (sourceLayoutIndex === -1) {
      return historySets;
    }

    if (sourceIndex === targetIndex) {
      const reorderedLayout = moveLayoutItem(sourceView.layout, sourceLayoutIndex, target.index);
      if (reorderedLayout === sourceView.layout) {
        return historySets;
      }
      const next = [...historySets];
      next[sourceIndex] = materializeSet({ ...sourceView, layout: reorderedLayout });
      return next;
    }

    const movedTabs = sourceView.tabsByGroupUid.get(group.uid) ?? [];
    const { group: movedGroup, tabs: movedGroupTabs } = updateGroupIdIfConflict(
      targetSet,
      group,
      movedTabs,
    );

    sourceView.layout = sourceView.layout.filter(
      (item) => !(item.type === 'group' && item.uid === group.uid),
    );
    sourceView.groups = sourceView.groups.filter((item) => item.uid !== group.uid);
    sourceView.groupByUid.delete(group.uid);
    sourceView.groupById.delete(group.id);
    sourceView.tabsByGroupUid.delete(group.uid);
    for (const tab of movedTabs) {
      sourceView.tabByUid.delete(tab.uid);
    }

    targetView.groups = [...targetView.groups, movedGroup];
    targetView.groupByUid.set(movedGroup.uid, movedGroup);
    targetView.groupById.set(movedGroup.id, movedGroup);
    targetView.tabsByGroupUid.set(movedGroup.uid, movedGroupTabs);
    for (const tab of movedGroupTabs) {
      targetView.tabByUid.set(tab.uid, tab);
    }
    const targetLayout = [...targetView.layout];
    targetLayout.splice(clampIndex(target.index, targetLayout.length), 0, {
      type: 'group',
      uid: movedGroup.uid,
    });
    targetView.layout = targetLayout;

    const next = [...historySets];
    next[sourceIndex] = materializeSet(sourceView);
    next[targetIndex] = materializeSet(targetView);
    return next;
  }

  if (active.type === 'tab' && target.type === 'block-list') {
    const sourceIndex = historySets.findIndex((set) => set.id === active.setId);
    const targetIndex = historySets.findIndex((set) => set.id === target.setId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return historySets;
    }
    const source = historySets[sourceIndex];
    const targetSet = historySets[targetIndex];
    const tab = findTabByUid(source, active.tabUid);
    if (!tab) {
      return historySets;
    }

    const sourceView = buildSetView(source);
    const targetView = sourceIndex === targetIndex ? sourceView : buildSetView(targetSet);
    const sourceGroup =
      tab.groupId !== null ? (sourceView.groupById.get(tab.groupId) ?? null) : null;
    const sourceLayoutIndex = sourceView.layout.findIndex(
      (item) => item.type === 'tab' && item.uid === tab.uid,
    );

    if (sourceIndex === targetIndex && !sourceGroup && sourceLayoutIndex !== -1) {
      const reorderedLayout = moveLayoutItem(sourceView.layout, sourceLayoutIndex, target.index);
      if (reorderedLayout === sourceView.layout) {
        return historySets;
      }
      const next = [...historySets];
      next[sourceIndex] = materializeSet({ ...sourceView, layout: reorderedLayout });
      return next;
    }

    if (sourceGroup) {
      const sourceList = sourceView.tabsByGroupUid.get(sourceGroup.uid) ?? [];
      const sourceTabIndex = sourceList.findIndex((item) => item.uid === tab.uid);
      if (sourceTabIndex === -1) {
        return historySets;
      }
      sourceList.splice(sourceTabIndex, 1);
      sourceView.tabsByGroupUid.set(sourceGroup.uid, sourceList);
    } else if (sourceLayoutIndex !== -1) {
      sourceView.layout = sourceView.layout.filter((_, index) => index !== sourceLayoutIndex);
      sourceView.ungroupedTabsByUid.delete(tab.uid);
    }

    if (sourceIndex !== targetIndex) {
      sourceView.tabByUid.delete(tab.uid);
    }

    const updatedTab: TabSnapshot = { ...tab, groupId: null };
    targetView.ungroupedTabsByUid.set(updatedTab.uid, updatedTab);
    if (sourceIndex !== targetIndex) {
      targetView.tabByUid.set(updatedTab.uid, updatedTab);
    }

    const targetLayout = [...targetView.layout];
    targetLayout.splice(clampIndex(target.index, targetLayout.length), 0, {
      type: 'tab',
      uid: updatedTab.uid,
    });
    targetView.layout = targetLayout;

    const next = [...historySets];
    next[sourceIndex] = materializeSet(sourceView);
    if (sourceIndex !== targetIndex) {
      next[targetIndex] = materializeSet(targetView);
    }
    return next;
  }

  if (active.type === 'tab' && target.type === 'tab-list') {
    const sourceIndex = historySets.findIndex((set) => set.id === active.setId);
    const targetIndex = historySets.findIndex((set) => set.id === target.setId);
    if (sourceIndex === -1 || targetIndex === -1) {
      return historySets;
    }
    const source = historySets[sourceIndex];
    const targetSet = historySets[targetIndex];
    const tab = findTabByUid(source, active.tabUid);
    if (!tab) {
      return historySets;
    }

    const sourceView = buildSetView(source);
    const targetView = sourceIndex === targetIndex ? sourceView : buildSetView(targetSet);

    const sourceGroup =
      tab.groupId !== null ? (sourceView.groupById.get(tab.groupId) ?? null) : null;
    const sourceList = sourceGroup ? (sourceView.tabsByGroupUid.get(sourceGroup.uid) ?? []) : null;
    const sourceTabIndex = sourceList ? sourceList.findIndex((item) => item.uid === tab.uid) : -1;

    const targetGroup = targetView.groupByUid.get(target.groupUid);
    if (!targetGroup) {
      return historySets;
    }
    const targetList = targetView.tabsByGroupUid.get(targetGroup.uid) ?? [];
    const toIndex = clampIndex(target.index, targetList.length);
    const updatedTab: TabSnapshot = { ...tab, groupId: targetGroup.id };

    if (sourceIndex === targetIndex && sourceGroup?.uid === targetGroup.uid) {
      if (sourceTabIndex === -1) {
        return historySets;
      }
      if (sourceTabIndex === toIndex || sourceTabIndex + 1 === toIndex) {
        return historySets;
      }
      const reordered = arrayMove(
        sourceList ?? [],
        sourceTabIndex,
        toIndex > sourceTabIndex ? toIndex - 1 : toIndex,
      );
      targetView.tabsByGroupUid.set(targetGroup.uid, reordered);
      const next = [...historySets];
      next[sourceIndex] = materializeSet(targetView);
      return next;
    }

    if (sourceGroup && sourceList) {
      if (sourceTabIndex === -1) {
        return historySets;
      }
      sourceList.splice(sourceTabIndex, 1);
      sourceView.tabsByGroupUid.set(sourceGroup.uid, sourceList);
    } else {
      const sourceLayoutIndex = sourceView.layout.findIndex(
        (item) => item.type === 'tab' && item.uid === tab.uid,
      );
      if (sourceLayoutIndex !== -1) {
        sourceView.layout = sourceView.layout.filter((_, index) => index !== sourceLayoutIndex);
      }
      sourceView.ungroupedTabsByUid.delete(tab.uid);
    }

    if (sourceIndex !== targetIndex) {
      sourceView.tabByUid.delete(tab.uid);
    }

    targetList.splice(toIndex, 0, updatedTab);
    targetView.tabsByGroupUid.set(targetGroup.uid, targetList);
    if (sourceIndex !== targetIndex) {
      targetView.tabByUid.set(updatedTab.uid, updatedTab);
    }

    const next = [...historySets];
    next[sourceIndex] = materializeSet(sourceView);
    if (sourceIndex !== targetIndex) {
      next[targetIndex] = materializeSet(targetView);
    }
    return next;
  }

  return historySets;
}
