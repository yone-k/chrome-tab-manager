import { normalizeLayout } from '../tab-manager/layout';
import type { HistorySet, LayoutItem } from '../tab-manager/types';

export function deleteGroupFromHistorySet(set: HistorySet, groupUid: string): HistorySet {
  const group = set.groups.find((item) => item.uid === groupUid);
  if (!group) {
    return set;
  }

  const nextGroups = set.groups.filter((item) => item.uid !== groupUid);
  const nextTabs = set.tabs.map((tab) =>
    tab.groupId === group.id ? { ...tab, groupId: null } : tab,
  );
  const tabsInGroup = set.tabs
    .filter((tab) => tab.groupId === group.id)
    .sort((a, b) => a.index - b.index);
  const currentLayout = normalizeLayout(set.layout, set.groups, set.tabs);
  const replacedLayout: LayoutItem[] = [];

  for (const item of currentLayout) {
    if (item.type !== 'group' || item.uid !== groupUid) {
      replacedLayout.push(item);
      continue;
    }
    for (const tab of tabsInGroup) {
      replacedLayout.push({ type: 'tab', uid: tab.uid });
    }
  }

  return {
    ...set,
    groups: nextGroups,
    tabs: nextTabs,
    layout: normalizeLayout(replacedLayout, nextGroups, nextTabs),
  };
}
