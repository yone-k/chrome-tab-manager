import type { GroupSnapshot, TabSnapshot } from '../tab-manager/types';

type ExistingGroupInfo = {
  groupId: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  urls: Set<string>;
};

type WindowTabState = {
  groups: ExistingGroupInfo[];
  allUrls: Set<string>;
};

type MergeFilterResult = {
  tabsToRestore: TabSnapshot[];
  skippedTabs: TabSnapshot[];
  mergeTargets: Map<number, number>;
};

function queryTabGroups(windowId: number) {
  return new Promise<chrome.tabGroups.TabGroup[]>((resolve, reject) => {
    chrome.tabGroups.query({ windowId }, (groups) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(groups);
    });
  });
}

function queryTabs(windowId: number) {
  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ windowId }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });
}

export async function queryWindowTabState(windowId: number): Promise<WindowTabState> {
  const tabGroups = await queryTabGroups(windowId);
  const tabs = await queryTabs(windowId);
  const groups = tabGroups.map((group) => ({
    groupId: group.id,
    title: group.title ?? '',
    color: group.color,
    urls: new Set<string>(),
  }));
  const groupsById = new Map(groups.map((group) => [group.groupId, group]));
  const allUrls = new Set<string>();

  for (const tab of tabs) {
    if (!tab.url) {
      continue;
    }
    allUrls.add(tab.url);
    groupsById.get(tab.groupId)?.urls.add(tab.url);
  }

  return { groups, allUrls };
}

function buildMergeTargets(groups: GroupSnapshot[], windowState: WindowTabState) {
  const mergeTargets = new Map<number, number>();
  for (const group of groups) {
    if (group.title === '') {
      continue;
    }
    const existingGroup = windowState.groups.find((item) => item.title === group.title);
    if (!existingGroup) {
      continue;
    }
    mergeTargets.set(group.id, existingGroup.groupId);
  }
  return mergeTargets;
}

export function buildMergeFilter(
  tabs: TabSnapshot[],
  groups: GroupSnapshot[],
  windowState: WindowTabState,
): MergeFilterResult {
  const mergeTargets = buildMergeTargets(groups, windowState);
  const groupsById = new Map(windowState.groups.map((group) => [group.groupId, group]));
  const tabsToRestore: TabSnapshot[] = [];
  const skippedTabs: TabSnapshot[] = [];

  for (const tab of tabs) {
    if (tab.groupId === null) {
      if (windowState.allUrls.has(tab.url)) {
        skippedTabs.push(tab);
        continue;
      }
      tabsToRestore.push(tab);
      continue;
    }

    const mergeTargetGroupId = mergeTargets.get(tab.groupId);
    if (mergeTargetGroupId === undefined) {
      tabsToRestore.push(tab);
      continue;
    }

    const mergeTarget = groupsById.get(mergeTargetGroupId);
    if (mergeTarget?.urls.has(tab.url)) {
      skippedTabs.push(tab);
      continue;
    }
    tabsToRestore.push(tab);
  }

  return { tabsToRestore, skippedTabs, mergeTargets };
}
