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

function isAllTabsLocked(tabs: TabSnapshot[]) {
  return tabs.length > 0 && tabs.every((tab) => tab.locked);
}

export function syncAncestorLocksFromTabs(set: HistorySet): HistorySet {
  const groups = set.groups.map((group) => {
    const groupedTabs = set.tabs.filter((tab) => tab.groupId === group.id);
    if (groupedTabs.length === 0) {
      return group;
    }
    return {
      ...group,
      locked: groupedTabs.every((tab) => tab.locked),
    };
  });

  return {
    ...set,
    locked: set.tabs.length > 0 ? set.tabs.every((tab) => tab.locked) : set.locked,
    groups,
  };
}

export function toggleTabLockWithPropagation(set: HistorySet, tabUid: string): HistorySet {
  const targetTab = set.tabs.find((tab) => tab.uid === tabUid);
  if (!targetTab) {
    return set;
  }

  const nextTabLocked = !targetTab.locked;
  const tabs = set.tabs.map((tab) =>
    tab.uid === tabUid ? { ...tab, locked: nextTabLocked } : tab,
  );

  let groups = set.groups;
  if (targetTab.groupId !== null) {
    const groupedTabs = tabs.filter((tab) => tab.groupId === targetTab.groupId);
    const nextGroupLocked = nextTabLocked && isAllTabsLocked(groupedTabs);
    groups = set.groups.map((group) =>
      group.id === targetTab.groupId ? { ...group, locked: nextGroupLocked } : group,
    );
  }

  const nextSetLocked = nextTabLocked && isAllTabsLocked(tabs);
  return {
    ...set,
    locked: nextSetLocked,
    groups,
    tabs,
  };
}

export function toggleGroupLockWithPropagation(set: HistorySet, groupUid: string): HistorySet {
  const targetGroup = findGroupByUid(set, groupUid);
  if (!targetGroup) {
    return set;
  }

  const nextGroupLocked = !targetGroup.locked;
  const groups = set.groups.map((group) =>
    group.uid === groupUid ? { ...group, locked: nextGroupLocked } : group,
  );
  const tabs = set.tabs.map((tab) =>
    tab.groupId === targetGroup.id ? { ...tab, locked: nextGroupLocked } : tab,
  );
  const nextSetLocked = nextGroupLocked && isAllTabsLocked(tabs);
  return {
    ...set,
    locked: nextSetLocked,
    groups,
    tabs,
  };
}
