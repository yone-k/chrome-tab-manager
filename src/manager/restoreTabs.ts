import type { GroupSnapshot, TabSnapshot } from '../tab-manager/types';
import { addTabsToExistingGroup, restoreGroupWithRetry } from './groupRestore';
import { buildMergeFilter, queryWindowTabState } from './mergeRestore';
import { shouldSuppressRestoreLoading } from './restorePolicy';
import { restoreSession, moveTabToWindow, ungroupTab } from './sessionRestore';
import { matchesExpectedUrl } from './urlMatch';

async function createTab(windowId: number, url: string, index: number) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create({ windowId, url, active: false, index }, (tab: chrome.tabs.Tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tab);
    });
  });
}

async function discardTab(tabId: number) {
  return new Promise<void>((resolve) => {
    chrome.tabs.discard(tabId, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to discard tab (non-blocking)', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

async function waitForTabUrl(tabId: number, expectedUrl: string, timeoutMs = 3000) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (matched: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve(matched);
    };

    const handleUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (matchesExpectedUrl(expectedUrl, tab, changeInfo)) {
        finish(true);
      }
    };

    const timeoutId = setTimeout(() => {
      console.debug('Discard wait timeout reached', { tabId, expectedUrl, timeoutMs });
      finish(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        return;
      }
      if (matchesExpectedUrl(expectedUrl, tab)) {
        finish(true);
      }
    });
  });
}

export async function restoreTabs(
  tabs: TabSnapshot[],
  groups: GroupSnapshot[],
  windowId: number,
  restoreLoadingSuppressionEnabled: boolean,
  baseTabIndex: number,
) {
  const windowState = await queryWindowTabState(windowId);
  const { tabsToRestore, skippedTabs, mergeTargets } = buildMergeFilter(tabs, groups, windowState);
  const sortedTabs = [...tabsToRestore].sort((a, b) => a.index - b.index);
  const shouldDiscard = shouldSuppressRestoreLoading({
    enabled: restoreLoadingSuppressionEnabled,
    tabCount: sortedTabs.length,
  });

  const sessionRestoredTabs: Array<{ snapshot: TabSnapshot; tab: chrome.tabs.Tab }> = [];
  const fallbackTabs: TabSnapshot[] = [];
  let sessionRestoredCount = 0;

  for (const tab of sortedTabs) {
    if (!tab.sessionId) {
      fallbackTabs.push(tab);
      continue;
    }
    try {
      const session = await restoreSession(tab.sessionId);
      const restoredTab = session.tab;
      if (!restoredTab) {
        fallbackTabs.push(tab);
        continue;
      }
      const restoredTabId = restoredTab.id;
      if (restoredTabId === undefined) {
        fallbackTabs.push(tab);
        continue;
      }
      sessionRestoredCount++;

      try {
        if (restoredTab.windowId !== windowId) {
          await moveTabToWindow(restoredTabId, windowId, baseTabIndex + tab.index);
        }
      } catch (err) {
        console.warn('Failed to move session-restored tab to target window', err);
      }

      try {
        if (restoredTab.groupId !== undefined && restoredTab.groupId !== -1) {
          await ungroupTab(restoredTabId);
        }
      } catch (err) {
        console.warn('Failed to ungroup session-restored tab', err);
      }

      sessionRestoredTabs.push({ snapshot: tab, tab: restoredTab });
    } catch (err) {
      console.warn('Failed to restore session, falling back to createTab', err);
      fallbackTabs.push(tab);
    }
  }

  const creationResults = await Promise.allSettled(
    fallbackTabs.map((tab) => createTab(windowId, tab.url, baseTabIndex + tab.index)),
  );
  const createdTabs: Array<{ snapshot: TabSnapshot; tab: chrome.tabs.Tab }> = [];
  const failedTabs: TabSnapshot[] = [];
  creationResults.forEach((result, index) => {
    const snapshot = fallbackTabs[index];
    if (!snapshot) {
      return;
    }
    if (result.status === 'fulfilled') {
      createdTabs.push({ snapshot, tab: result.value });
      return;
    }
    console.error('Failed to create tab', result.reason);
    failedTabs.push(snapshot);
  });

  const allRestoredTabs = [...sessionRestoredTabs, ...createdTabs];

  const groupTabIds = new Map<number, number[]>();
  for (const { snapshot, tab } of allRestoredTabs) {
    if (snapshot.groupId === null || tab.id === undefined) {
      continue;
    }
    const list = groupTabIds.get(snapshot.groupId) ?? [];
    list.push(tab.id);
    groupTabIds.set(snapshot.groupId, list);
  }

  const sortedGroups = [...groups].sort((a, b) => a.index - b.index);
  for (const group of sortedGroups) {
    const tabIds = groupTabIds.get(group.id);
    if (!tabIds || tabIds.length === 0) {
      continue;
    }
    const mergeTargetGroupId = mergeTargets.get(group.id);
    if (mergeTargetGroupId !== undefined) {
      try {
        await addTabsToExistingGroup(mergeTargetGroupId, tabIds);
      } catch (err) {
        console.warn('Failed to add tabs to existing tab group', err);
      }
      continue;
    }
    const newGroupId = await restoreGroupWithRetry(
      windowId,
      tabIds,
      group.title,
      group.color,
      baseTabIndex + group.index,
    );
    if (newGroupId === null) {
      continue;
    }
  }

  if (shouldDiscard) {
    const restoredSnapshots = await Promise.all(
      allRestoredTabs.map(async ({ snapshot, tab }) => {
        if (tab.id === undefined) {
          return snapshot;
        }
        const matched = await waitForTabUrl(tab.id, snapshot.url);
        if (!matched) {
          console.warn('Skip discard because tab url confirmation failed', {
            tabId: tab.id,
            expectedUrl: snapshot.url,
          });
          return snapshot;
        }
        await discardTab(tab.id);
        return snapshot;
      }),
    );
    return {
      restoredTabs: [...restoredSnapshots, ...skippedTabs],
      failedTabs,
      sessionRestoredCount,
      skippedDuplicateCount: skippedTabs.length,
    };
  }

  return {
    restoredTabs: [...allRestoredTabs.map((item) => item.snapshot), ...skippedTabs],
    failedTabs,
    sessionRestoredCount,
    skippedDuplicateCount: skippedTabs.length,
  };
}
