import { normalizeLayout } from '../tab-manager/layout';
import type { HistorySet } from '../tab-manager/types';
import { syncAncestorLocksFromTabs } from './lockState';

export function deleteTabFromHistorySet(set: HistorySet, tabUid: string): HistorySet {
  const filteredTabs = set.tabs.filter((tab) => tab.uid !== tabUid);
  if (filteredTabs.length === set.tabs.length) {
    return set;
  }

  return syncAncestorLocksFromTabs({
    ...set,
    tabs: filteredTabs,
    layout: normalizeLayout(set.layout, set.groups, filteredTabs),
  });
}
