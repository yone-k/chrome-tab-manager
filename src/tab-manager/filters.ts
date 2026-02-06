import type { HistorySet, TabSnapshot } from './types';
import { buildLayoutFromData } from './layout';

export const GROUP_FILTER_ALL = 'all';
export const GROUP_FILTER_UNGROUPED = 'ungrouped';

type FilterOptions = {
  query: string;
  groupFilter: string;
};

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function matchesQuery(tab: TabSnapshot, query: string) {
  if (!query) {
    return true;
  }
  const loweredTitle = tab.title.toLowerCase();
  const loweredUrl = tab.url.toLowerCase();
  return loweredTitle.includes(query) || loweredUrl.includes(query);
}

function matchesGroup(tab: TabSnapshot, groupFilter: string, groupTitlesById: Map<number, string>) {
  if (groupFilter === GROUP_FILTER_ALL) {
    return true;
  }
  if (groupFilter === GROUP_FILTER_UNGROUPED) {
    return tab.groupId === null;
  }
  if (tab.groupId === null) {
    return false;
  }
  const groupTitle = groupTitlesById.get(tab.groupId);
  return groupTitle === groupFilter;
}

function buildGroupTitleMap(historySet: HistorySet) {
  return new Map(historySet.groups.map((group) => [group.id, group.title]));
}

export function filterHistorySets(historySets: HistorySet[], options: FilterOptions) {
  const query = normalizeQuery(options.query);

  return historySets
    .map((set) => {
      const groupTitlesById = buildGroupTitleMap(set);
      const filteredTabs = set.tabs.filter(
        (tab) =>
          matchesQuery(tab, query) && matchesGroup(tab, options.groupFilter, groupTitlesById),
      );
      if (filteredTabs.length === 0) {
        return null;
      }
      const groupIds = new Set<number>();
      for (const tab of filteredTabs) {
        if (tab.groupId !== null) {
          groupIds.add(tab.groupId);
        }
      }
      const filteredGroups = set.groups.filter((group) => groupIds.has(group.id));
      return {
        ...set,
        tabs: filteredTabs,
        groups: filteredGroups,
        layout: buildLayoutFromData(filteredGroups, filteredTabs),
      };
    })
    .filter((set): set is HistorySet => set !== null);
}

export function buildGroupFilterOptions(historySets: HistorySet[]) {
  const titles = new Set<string>();
  for (const set of historySets) {
    const groupIds = new Set<number>();
    for (const tab of set.tabs) {
      if (tab.groupId !== null) {
        groupIds.add(tab.groupId);
      }
    }
    for (const group of set.groups) {
      if (groupIds.has(group.id)) {
        titles.add(group.title);
      }
    }
  }

  return [GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED, ...Array.from(titles).sort()];
}
