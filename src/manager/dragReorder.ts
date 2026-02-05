import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';

export type DragItem =
  | { type: 'set'; setId: string }
  | { type: 'group'; setId: string; groupUid: string }
  | { type: 'tab'; setId: string; tabUid: string };

export type DropTarget =
  | { type: 'set-list'; index: number }
  | { type: 'group-list'; setId: string; index: number }
  | { type: 'tab-list'; setId: string; groupUid: string | null; index: number };

type SetView = {
  set: HistorySet;
  groups: GroupSnapshot[];
  tabsByGroupUid: Map<string, TabSnapshot[]>;
  ungroupedTabs: TabSnapshot[];
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

function buildSetView(set: HistorySet): SetView {
  const groups = [...set.groups];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const tabsByGroupUid = new Map<string, TabSnapshot[]>();
  const ungroupedTabs: TabSnapshot[] = [];

  for (const tab of set.tabs) {
    if (tab.groupId === null) {
      ungroupedTabs.push(tab);
      continue;
    }
    const group = groupById.get(tab.groupId);
    if (!group) {
      ungroupedTabs.push({ ...tab, groupId: null });
      continue;
    }
    const list = tabsByGroupUid.get(group.uid) ?? [];
    list.push(tab);
    tabsByGroupUid.set(group.uid, list);
  }

  return { set, groups, tabsByGroupUid, ungroupedTabs };
}

function materializeSet(view: SetView): HistorySet {
  const groupsWithTabs = view.groups.filter((group) => {
    const list = view.tabsByGroupUid.get(group.uid) ?? [];
    return list.length > 0;
  });

  const normalizedGroups = groupsWithTabs.map((group, index) => ({
    ...group,
    index,
  }));

  const orderedTabs: TabSnapshot[] = [];
  for (const group of normalizedGroups) {
    const list = view.tabsByGroupUid.get(group.uid) ?? [];
    for (const tab of list) {
      orderedTabs.push({ ...tab, groupId: group.id });
    }
  }
  for (const tab of view.ungroupedTabs) {
    orderedTabs.push({ ...tab, groupId: null });
  }

  const normalizedTabs = orderedTabs.map((tab, index) => ({
    ...tab,
    index,
  }));

  return {
    ...view.set,
    groups: normalizedGroups,
    tabs: normalizedTabs,
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

function resolveTargetGroup(target: HistorySet, groupUid: string | null): GroupSnapshot | null {
  if (groupUid === null) {
    return null;
  }
  return findGroupByUid(target, groupUid) ?? null;
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

  if (active.type === 'group' && target.type === 'group-list') {
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

    const groupList = sourceView.groups.filter((item) => item.uid !== group.uid);
    const movedTabs = sourceView.tabsByGroupUid.get(group.uid) ?? [];

    if (sourceIndex === targetIndex) {
      const originalIndex = sourceView.groups.findIndex((item) => item.uid === group.uid);
      const insertIndex = clampIndex(target.index, sourceView.groups.length);
      if (originalIndex === insertIndex || originalIndex + 1 === insertIndex) {
        return historySets;
      }
      const adjustedIndex = insertIndex > originalIndex ? insertIndex - 1 : insertIndex;
      const reordered = arrayMove(sourceView.groups, originalIndex, adjustedIndex);
      const updated = materializeSet({
        ...sourceView,
        groups: reordered,
      });
      const next = [...historySets];
      next[sourceIndex] = updated;
      return next;
    }

    const { group: movedGroup, tabs: movedGroupTabs } = updateGroupIdIfConflict(
      targetSet,
      group,
      movedTabs,
    );
    const targetGroups = [...targetView.groups];
    const insertIndex = clampIndex(target.index, targetGroups.length);
    targetGroups.splice(insertIndex, 0, movedGroup);
    targetView.tabsByGroupUid.set(movedGroup.uid, movedGroupTabs);

    sourceView.groups = groupList;
    sourceView.tabsByGroupUid.delete(group.uid);

    const next = [...historySets];
    next[sourceIndex] = materializeSet(sourceView);
    next[targetIndex] = materializeSet({ ...targetView, groups: targetGroups });
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
      tab.groupId !== null ? source.groups.find((g) => g.id === tab.groupId) : null;
    const sourceList = sourceGroup?.uid
      ? (sourceView.tabsByGroupUid.get(sourceGroup.uid) ?? [])
      : sourceView.ungroupedTabs;
    const sourceTabIndex = sourceList.findIndex((item) => item.uid === tab.uid);
    if (sourceTabIndex === -1) {
      return historySets;
    }

    const targetGroup = resolveTargetGroup(targetSet, target.groupUid);
    const targetList = targetGroup?.uid
      ? (targetView.tabsByGroupUid.get(targetGroup.uid) ?? [])
      : targetView.ungroupedTabs;

    const toIndex = clampIndex(target.index, targetList.length);
    const updatedTab: TabSnapshot = {
      ...tab,
      groupId: targetGroup ? targetGroup.id : null,
    };

    if (sourceIndex === targetIndex && sourceList === targetList) {
      if (sourceTabIndex === toIndex || sourceTabIndex + 1 === toIndex) {
        return historySets;
      }
      const reordered = arrayMove(
        sourceList,
        sourceTabIndex,
        toIndex > sourceTabIndex ? toIndex - 1 : toIndex,
      );
      if (sourceGroup?.uid) {
        sourceView.tabsByGroupUid.set(sourceGroup.uid, reordered);
      } else {
        sourceView.ungroupedTabs = reordered;
      }
      const next = [...historySets];
      next[sourceIndex] = materializeSet(sourceView);
      return next;
    }

    sourceList.splice(sourceTabIndex, 1);
    targetList.splice(toIndex, 0, updatedTab);

    if (sourceGroup?.uid) {
      sourceView.tabsByGroupUid.set(sourceGroup.uid, sourceList);
    } else {
      sourceView.ungroupedTabs = sourceList;
    }
    if (targetGroup?.uid) {
      targetView.tabsByGroupUid.set(targetGroup.uid, targetList);
    } else {
      targetView.ungroupedTabs = targetList;
    }

    if (sourceGroup?.uid && sourceList.length === 0) {
      sourceView.groups = sourceView.groups.filter((group) => group.uid !== sourceGroup.uid);
      sourceView.tabsByGroupUid.delete(sourceGroup.uid);
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
