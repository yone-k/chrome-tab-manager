import { useState } from 'react';

import { filterSavableTabs, getTabUrl } from '../tab-manager/exclusions';
import { buildHistorySet, createHistoryId } from '../tab-manager/history';
import { getState, updateState } from '../tab-manager/storage';
import type { GroupInput, TabInput } from '../tab-manager/history';
import { getPopupTitle } from './title';
import './popup.css';

async function queryCurrentWindowTabs() {
  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });
}

async function queryTabGroups(windowId: number) {
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

async function closeTabs(tabIds: number[]) {
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

async function openManagerTab() {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const existing = await new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ url: managerUrl }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });

  if (existing.length > 0 && existing[0].id !== undefined) {
    const target = existing[0];
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.update(target.id!, { active: true }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
    if (target.windowId !== undefined) {
      await new Promise<void>((resolve, reject) => {
        chrome.windows.update(target.windowId, { focused: true }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve();
        });
      });
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    chrome.tabs.create({ url: managerUrl }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

export function App() {
  const [status, setStatus] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const handleOpenManager = async () => {
    setStatus(null);
    try {
      await openManagerTab();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to open tab manager.');
    }
  };

  const handleSaveAndOpenManager = async () => {
    setIsWorking(true);
    setStatus('Saving current tabs...');
    try {
      const stored = await getState();
      const tabs = await queryCurrentWindowTabs();
      if (tabs.length === 0) {
        setStatus('No tabs found in the current window.');
        return;
      }
      const windowId = tabs[0]?.windowId;
      if (windowId === undefined) {
        setStatus('No active window found.');
        return;
      }
      const exclusions = stored.exclusions;
      const savableTabs = filterSavableTabs(tabs, exclusions);
      if (savableTabs.length === 0) {
        setStatus('No tabs to save. Everything is pinned or excluded.');
        await openManagerTab();
        return;
      }
      const groups = await queryTabGroups(windowId);
      const tabInputs: TabInput[] = savableTabs.map((tab) => ({
        title: tab.title ?? '',
        url: getTabUrl(tab),
        index: tab.index,
        groupId: tab.groupId,
      }));
      const groupInputs: GroupInput[] = groups.map((group) => ({
        id: group.id,
        title: group.title ?? '',
        color: group.color,
      }));
      const historySet = buildHistorySet({
        id: createHistoryId(),
        createdAt: Date.now(),
        windowId,
        tabs: tabInputs,
        groups: groupInputs,
      });

      const tabIds = savableTabs
        .map((tab) => tab.id)
        .filter((id): id is number => typeof id === 'number');
      await updateState((state) => ({
        ...state,
        historySets: [historySet, ...state.historySets],
      }));
      if (tabIds.length > 0) {
        await closeTabs(tabIds);
      }
      await openManagerTab();
      setStatus(`Saved ${savableTabs.length} tabs.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save tabs.');
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__badge">Chrome</span>
        <h1 className="popup__title">{getPopupTitle()}</h1>
        <p className="popup__subtitle">Manage your tabs quickly.</p>
      </header>
      <main className="popup__content">
        <button
          className="primary-button"
          type="button"
          onClick={handleOpenManager}
          disabled={isWorking}
        >
          Open tab manager
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={handleSaveAndOpenManager}
          disabled={isWorking}
        >
          {isWorking ? 'Working...' : 'Save & close tabs'}
        </button>
        {status ? <p className="popup__hint">{status}</p> : null}
      </main>
    </div>
  );
}
