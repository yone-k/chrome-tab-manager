import type { HistorySet, TabSnapshot } from './types';
import { buildLayoutFromData } from './layout';

export const SET_FILTER_ALL = 'all-sets';
export const GROUP_FILTER_ALL = 'all';
export const GROUP_FILTER_UNGROUPED = 'ungrouped';

export type FilterOptions = {
  query: string;
  setFilter: string;
  groupFilter: string;
};

export type SetFilterOption = {
  value: string;
  label: string;
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

function filterSetsBySetFilter(historySets: HistorySet[], setFilter: string) {
  if (setFilter === SET_FILTER_ALL) {
    return historySets;
  }
  return historySets.filter((set) => set.id === setFilter);
}

export function filterHistorySets(historySets: HistorySet[], options: FilterOptions) {
  const query = normalizeQuery(options.query);
  const targetSets = filterSetsBySetFilter(historySets, options.setFilter);

  return targetSets
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

export function buildSetFilterOptions(historySets: HistorySet[]): SetFilterOption[] {
  return [
    { value: SET_FILTER_ALL, label: 'すべてのウィンドウ' },
    ...historySets.map((set) => ({
      value: set.id,
      label: `${set.name} (${set.tabs.length})`,
    })),
  ];
}

export function buildGroupFilterOptions(historySets: HistorySet[], setFilter: string) {
  const titles = new Set<string>();
  const targetSets = filterSetsBySetFilter(historySets, setFilter);

  for (const set of targetSets) {
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
