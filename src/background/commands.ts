import { filterSavableTabs, getTabUrl } from '../tab-manager/exclusions';
import {
  buildHistorySet,
  createHistoryId,
  formatHistorySetNameFromCreatedAt,
  type GroupInput,
  type TabInput,
} from '../tab-manager/history';
import { getState, prependHistorySet, updateState } from '../tab-manager/storage';
import type { HistorySet } from '../tab-manager/types';
import {
  ensureManagerTabInWindow,
  filterOutManagerTabs,
  openManagerTabInCurrentWindow,
} from './managerTab';
import { getRecentlyClosedSessions, matchSessionIds } from './sessions';

const MAX_HISTORY_SETS = 200;

type WindowContext = {
  windowId: number;
  activeTab: chrome.tabs.Tab | null;
};

function queryWindowTabs(windowId: number) {
  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ windowId }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });
}

function queryTabGroups(windowId: number) {
  return new Promise<chrome.tabGroups.TabGroup[]>((resolve, reject) => {
    chrome.tabGroups.query({ windowId }, (groups: chrome.tabGroups.TabGroup[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(groups);
    });
  });
}

function queryActiveTabInWindow(windowId: number) {
  return new Promise<chrome.tabs.Tab | null>((resolve, reject) => {
    chrome.tabs.query({ windowId, active: true }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs[0] ?? null);
    });
  });
}

function queryActiveTabInLastFocusedWindow() {
  return new Promise<chrome.tabs.Tab | null>((resolve, reject) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs[0] ?? null);
    });
  });
}

function closeTabs(tabIds: number[]) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabs.remove(tabIds, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function resolveWindowContext(clickedTab?: chrome.tabs.Tab): Promise<WindowContext> {
  const clickedWindowId =
    typeof clickedTab?.windowId === 'number' ? clickedTab.windowId : undefined;

  if (typeof clickedWindowId === 'number') {
    const activeTab = await queryActiveTabInWindow(clickedWindowId);
    return { windowId: clickedWindowId, activeTab };
  }

  const activeTab = await queryActiveTabInLastFocusedWindow();
  if (!activeTab || typeof activeTab.windowId !== 'number') {
    throw new Error('アクティブなウィンドウが見つかりません。');
  }
  return {
    windowId: activeTab.windowId,
    activeTab,
  };
}

function enrichHistorySetWithSessionIds(
  set: HistorySet,
  urlToSessionIds: Map<string, string[]>,
): HistorySet {
  if (urlToSessionIds.size === 0) {
    return set;
  }
  // 各 URL の sessionId を貪欲に消費するためにコピーを作成
  const remaining = new Map<string, string[]>();
  for (const [url, ids] of urlToSessionIds) {
    remaining.set(url, [...ids]);
  }
  return {
    ...set,
    tabs: set.tabs.map((tab) => {
      const ids = remaining.get(tab.url);
      if (!ids || ids.length === 0) {
        return tab;
      }
      const sessionId = ids.shift();
      if (sessionId === undefined) {
        return tab;
      }
      return { ...tab, sessionId };
    }),
  };
}

async function saveTabsAndClose(
  windowId: number,
  sourceTabs: chrome.tabs.Tab[],
  activeTab: chrome.tabs.Tab | null,
) {
  const stored = await getState();

  const managerUrl = chrome.runtime.getURL('manager.html');
  const savableTabs = filterOutManagerTabs(
    filterSavableTabs(sourceTabs, stored.exclusions),
    managerUrl,
  );

  if (savableTabs.length === 0) {
    console.info('No savable tabs found.');
    await openManagerTabInCurrentWindow(windowId);
    return;
  }

  const groups = await queryTabGroups(windowId);
  const managerBinding = await ensureManagerTabInWindow(
    windowId,
    typeof activeTab?.index === 'number' ? activeTab.index + 1 : undefined,
  );
  const tabInputs: TabInput[] = savableTabs.map((tab) => ({
    title: tab.title ?? '',
    url: getTabUrl(tab),
    favIconUrl: tab.favIconUrl,
    index: tab.index ?? 0,
    groupId: tab.groupId,
  }));
  const groupInputs: GroupInput[] = groups.map((group) => ({
    id: group.id,
    title: group.title ?? '',
    color: group.color,
  }));
  const createdAt = Date.now();
  const historySet = buildHistorySet({
    id: createHistoryId(),
    name: formatHistorySetNameFromCreatedAt(createdAt),
    createdAt,
    windowId,
    managerBinding,
    tabs: tabInputs,
    groups: groupInputs,
  });

  await prependHistorySet(historySet, MAX_HISTORY_SETS);

  const tabIds = savableTabs
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');

  if (tabIds.length === 0) {
    await openManagerTabInCurrentWindow(windowId);
    return;
  }

  await closeTabs(tabIds);

  // sessionId 取得・付与（ベストエフォート）
  try {
    const closedTabUrls = savableTabs.map((tab) => getTabUrl(tab));
    let sessions = await getRecentlyClosedSessions(closedTabUrls.length + 10);
    let sessionIdMap = matchSessionIds(closedTabUrls, sessions);
    // マッチ件数が0の場合は100ms待機して1回リトライ
    if (sessionIdMap.size === 0 && closedTabUrls.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      sessions = await getRecentlyClosedSessions(closedTabUrls.length + 10);
      sessionIdMap = matchSessionIds(closedTabUrls, sessions);
    }
    if (sessionIdMap.size > 0) {
      // sessionIdMap (key: closedTabUrls index, value: sessionId) を
      // URL → sessionId[] のマップに変換。buildHistorySet でタブが index ソートされるため、
      // 配列インデックスではなく URL ベースで HistorySet のタブと照合する。
      const urlToSessionIds = new Map<string, string[]>();
      for (const [urlIdx, sessionId] of sessionIdMap) {
        const url = closedTabUrls[urlIdx];
        if (url === undefined) continue;
        const list = urlToSessionIds.get(url) ?? [];
        list.push(sessionId);
        urlToSessionIds.set(url, list);
      }
      await updateState((current) => ({
        ...current,
        historySets: current.historySets.map((item) => {
          if (item.id !== historySet.id) {
            return item;
          }
          return enrichHistorySetWithSessionIds(item, urlToSessionIds);
        }),
      }));
    }
  } catch (err) {
    console.warn('Failed to enrich history set with session IDs', err);
  }
}

export async function runOpenManagerInCurrentWindow(clickedTab?: chrome.tabs.Tab) {
  const context = await resolveWindowContext(clickedTab);
  await openManagerTabInCurrentWindow(context.windowId);
}

export async function runSaveAndCloseCurrentWindow(clickedTab?: chrome.tabs.Tab) {
  const context = await resolveWindowContext(clickedTab);
  const tabs = await queryWindowTabs(context.windowId);
  if (tabs.length === 0) {
    console.info('No tabs found in current window.');
    await openManagerTabInCurrentWindow(context.windowId);
    return;
  }
  await saveTabsAndClose(context.windowId, tabs, context.activeTab);
}

export async function runCloseCurrentWindowTabsWithSave(clickedTab?: chrome.tabs.Tab) {
  const context = await resolveWindowContext(clickedTab);
  const tabs = await queryWindowTabs(context.windowId);
  if (tabs.length === 0) {
    console.info('No tabs found in current window.');
    await openManagerTabInCurrentWindow(context.windowId);
    return;
  }

  const activeTab =
    context.activeTab ??
    tabs.find(
      (tab) => tab.active && typeof tab.windowId === 'number' && tab.windowId === context.windowId,
    ) ??
    null;

  if (!activeTab) {
    console.info('No active tab found for current-tab action.');
    return;
  }

  await saveTabsAndClose(context.windowId, [activeTab], activeTab);
}

export async function runCloseCurrentGroupWithSave(clickedTab?: chrome.tabs.Tab) {
  const context = await resolveWindowContext(clickedTab);
  const tabs = await queryWindowTabs(context.windowId);
  if (tabs.length === 0) {
    console.info('No tabs found in current window.');
    await openManagerTabInCurrentWindow(context.windowId);
    return;
  }

  const activeTab =
    context.activeTab ??
    tabs.find(
      (tab) => tab.active && typeof tab.windowId === 'number' && tab.windowId === context.windowId,
    ) ??
    null;

  if (!activeTab) {
    console.info('No active tab found for current group action.');
    return;
  }

  const sourceTabs =
    typeof activeTab.groupId === 'number'
      ? tabs.filter((tab) => tab.groupId === activeTab.groupId)
      : [activeTab];

  await saveTabsAndClose(context.windowId, sourceTabs, activeTab);
}
