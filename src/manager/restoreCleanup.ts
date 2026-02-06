import type { HistorySet, TabSnapshot } from '../tab-manager/types';
import { normalizeLayout } from '../tab-manager/layout';

type TabKey = string;

function buildTabKey(tab: TabSnapshot): TabKey {
  return `${tab.url}::${tab.index}`;
}

export function cleanupHistorySet(set: HistorySet, restoredTabs: TabSnapshot[]) {
  const restoredKeys = new Set(restoredTabs.map(buildTabKey));
  const remainingTabs = set.tabs.filter((tab) => !restoredKeys.has(buildTabKey(tab)));

  return {
    ...set,
    tabs: remainingTabs,
    groups: set.groups,
    layout: normalizeLayout(set.layout, set.groups, remainingTabs),
  };
}
