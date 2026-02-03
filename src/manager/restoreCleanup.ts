import type { HistorySet, TabSnapshot } from '../tab-manager/types';

type TabKey = string;

function buildTabKey(tab: TabSnapshot): TabKey {
  return `${tab.url}::${tab.index}`;
}

export function cleanupHistorySet(set: HistorySet, restoredTabs: TabSnapshot[]) {
  const restoredKeys = new Set(restoredTabs.map(buildTabKey));
  const remainingTabs = set.tabs.filter((tab) => !restoredKeys.has(buildTabKey(tab)));

  if (remainingTabs.length === 0) {
    return null;
  }

  const remainingGroupIds = new Set(
    remainingTabs.map((tab) => tab.groupId).filter((id): id is number => id !== null),
  );

  const remainingGroups = set.groups.filter((group) => remainingGroupIds.has(group.id));

  return {
    ...set,
    tabs: remainingTabs,
    groups: remainingGroups,
  };
}
