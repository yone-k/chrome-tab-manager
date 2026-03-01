import type { HistorySet, TabSnapshot } from '../tab-manager/types';
import { normalizeLayout } from '../tab-manager/layout';
import {
  isGroupEffectivelyLocked,
  isTabEffectivelyLocked,
  syncAncestorLocksFromTabs,
} from './lockState';

type CleanupOptions = {
  pruneEmptyGroups?: boolean;
};

export function cleanupHistorySet(
  set: HistorySet,
  restoredTabs: TabSnapshot[],
  options: CleanupOptions = {},
) {
  const restoredUids = new Set(restoredTabs.map((tab) => tab.uid));
  const remainingTabs = set.tabs.filter(
    (tab) => !restoredUids.has(tab.uid) || isTabEffectivelyLocked(set, tab),
  );
  const shouldPruneEmptyGroups = options.pruneEmptyGroups ?? false;
  const remainingGroupIds = new Set(
    remainingTabs
      .map((tab) => tab.groupId)
      .filter((groupId): groupId is number => groupId !== null),
  );
  const remainingGroups = shouldPruneEmptyGroups
    ? set.groups.filter(
        (group) => remainingGroupIds.has(group.id) || isGroupEffectivelyLocked(set, group.uid),
      )
    : set.groups;

  return syncAncestorLocksFromTabs({
    ...set,
    tabs: remainingTabs,
    groups: remainingGroups,
    layout: normalizeLayout(set.layout, remainingGroups, remainingTabs),
  });
}
