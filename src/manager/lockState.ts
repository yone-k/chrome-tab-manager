import type { HistorySet, TabSnapshot } from '../tab-manager/types';

function findGroupByUid(set: HistorySet, groupUid: string) {
  return set.groups.find((group) => group.uid === groupUid);
}

function findGroupById(set: HistorySet, groupId: number) {
  return set.groups.find((group) => group.id === groupId);
}

export function isGroupEffectivelyLocked(set: HistorySet, groupUid: string) {
  if (set.locked) {
    return true;
  }
  return findGroupByUid(set, groupUid)?.locked ?? false;
}

export function isTabEffectivelyLocked(set: HistorySet, tab: TabSnapshot) {
  if (set.locked || tab.locked) {
    return true;
  }
  if (tab.groupId === null) {
    return false;
  }
  return findGroupById(set, tab.groupId)?.locked ?? false;
}

export function applySetLock(set: HistorySet, locked: boolean): HistorySet {
  if (!locked) {
    return {
      ...set,
      locked: false,
      groups: set.groups.map((group) => ({ ...group, locked: false })),
      tabs: set.tabs.map((tab) => ({ ...tab, locked: false })),
    };
  }

  return {
    ...set,
    locked: true,
    groups: set.groups.map((group) => ({ ...group, locked: true })),
    tabs: set.tabs.map((tab) => ({ ...tab, locked: true })),
  };
}

export function applyGroupLock(set: HistorySet, groupUid: string, locked: boolean): HistorySet {
  const targetGroup = findGroupByUid(set, groupUid);
  if (!targetGroup) {
    return set;
  }

  const groups = set.groups.map((group) => (group.uid === groupUid ? { ...group, locked } : group));
  const tabs = set.tabs.map((tab) => (tab.groupId === targetGroup.id ? { ...tab, locked } : tab));
  return {
    ...set,
    groups,
    tabs,
  };
}
