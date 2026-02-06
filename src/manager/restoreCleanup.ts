import type { HistorySet, TabSnapshot } from '../tab-manager/types';
import { normalizeLayout } from '../tab-manager/layout';

type TabKey = string;

function buildTabKey(tab: TabSnapshot): TabKey {
  return `${tab.url}::${tab.index}`;
}

type CleanupOptions = {
  pruneEmptyGroups?: boolean;
};

export function cleanupHistorySet(
  set: HistorySet,
  restoredTabs: TabSnapshot[],
  options: CleanupOptions = {},
) {
  const restoredKeys = new Set(restoredTabs.map(buildTabKey));
  const remainingTabs = set.tabs.filter((tab) => !restoredKeys.has(buildTabKey(tab)));
  const shouldPruneEmptyGroups = options.pruneEmptyGroups ?? false;
  const remainingGroupIds = new Set(
    remainingTabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is number => groupId !== null),
  );
  const remainingGroups = shouldPruneEmptyGroups
    ? set.groups.filter((group) => remainingGroupIds.has(group.id))
    : set.groups;

  return {
    ...set,
    tabs: remainingTabs,
    groups: remainingGroups,
    layout: normalizeLayout(set.layout, remainingGroups, remainingTabs),
  };
}
