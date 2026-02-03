import { useEffect, useMemo, useState } from 'react';

import {
  buildGroupFilterOptions,
  filterHistorySets,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from '../tab-manager/filters';
import { getState, updateState } from '../tab-manager/storage';
import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';
import './manager.css';

type LoadState = 'loading' | 'ready' | 'error';

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function groupTabsById(tabs: TabSnapshot[]) {
  const grouped = new Map<number | null, TabSnapshot[]>();
  for (const tab of tabs) {
    const key = tab.groupId ?? null;
    const existing = grouped.get(key) ?? [];
    existing.push(tab);
    grouped.set(key, existing);
  }
  return grouped;
}

async function getCurrentWindowId() {
  return new Promise<number>((resolve, reject) => {
    chrome.windows.getCurrent((window: chrome.windows.Window | undefined) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!window?.id) {
        reject(new Error('No active window found.'));
        return;
      }
      resolve(window.id);
    });
  });
}

async function createTab(windowId: number, url: string) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create({ windowId, url, active: false }, (tab: chrome.tabs.Tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tab);
    });
  });
}

async function groupTabs(windowId: number, tabIds: number[]) {
  return new Promise<number>((resolve, reject) => {
    chrome.tabs.group({ createProperties: { windowId }, tabIds }, (groupId: number) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(groupId);
    });
  });
}

async function updateTabGroup(groupId: number, group: GroupSnapshot) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabGroups.update(groupId, { title: group.title, color: group.color }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function moveTabGroup(groupId: number, index: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabGroups.move(groupId, { index }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

async function restoreTabs(tabs: TabSnapshot[], groups: GroupSnapshot[], windowId: number) {
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const createdTabs: Array<{ snapshot: TabSnapshot; tab: chrome.tabs.Tab }> = [];

  for (const tab of sortedTabs) {
    const created = await createTab(windowId, tab.url);
    createdTabs.push({ snapshot: tab, tab: created });
  }

  const groupTabIds = new Map<number, number[]>();
  for (const { snapshot, tab } of createdTabs) {
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
    const newGroupId = await groupTabs(windowId, tabIds);
    await updateTabGroup(newGroupId, group);
    try {
      await moveTabGroup(newGroupId, group.index);
    } catch {
      // ignore move failures (e.g. index out of range)
    }
  }
}

export function ManagerApp() {
  const [state, setState] = useState<{ status: LoadState; data?: HistorySet[]; error?: string }>({
    status: 'loading',
  });
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState(GROUP_FILTER_ALL);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = await getState();
        if (cancelled) {
          return;
        }
        setState({ status: 'ready', data: stored.historySets });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to load history.',
          });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSets = useMemo(() => {
    if (state.status !== 'ready' || !state.data) {
      return [];
    }
    return filterHistorySets(state.data, { query, groupFilter });
  }, [groupFilter, query, state]);

  const fullSets = state.status === 'ready' && state.data ? state.data : [];

  const groupOptions = useMemo(() => {
    if (state.status !== 'ready' || !state.data) {
      return [GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED];
    }
    return buildGroupFilterOptions(state.data);
  }, [state]);

  const refreshState = async (nextSets: HistorySet[]) => {
    setState({ status: 'ready', data: nextSets });
  };

  const handleDeleteSet = async (setId: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.filter((set) => set.id !== setId),
    }));
    await refreshState(updated.historySets);
  };

  const handleDeleteTab = async (setId: string, tabToDelete: TabSnapshot) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        const filteredTabs = set.tabs.filter(
          (tab) => !(tab.index === tabToDelete.index && tab.url === tabToDelete.url),
        );
        const remainingGroupIds = new Set(
          filteredTabs.map((tab) => tab.groupId).filter((id): id is number => id !== null),
        );
        return {
          ...set,
          tabs: filteredTabs,
          groups: set.groups.filter((group) => remainingGroupIds.has(group.id)),
        };
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleRestoreSet = async (set: HistorySet) => {
    setActionMessage('Restoring tabs...');
    try {
      const targetSet = fullSets.find((item) => item.id === set.id) ?? set;
      const windowId = await getCurrentWindowId();
      await restoreTabs(targetSet.tabs, targetSet.groups, windowId);
      setActionMessage('Tabs restored.');
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : 'Failed to restore tabs. Please try again.',
      );
    }
  };

  const handleRestoreGroup = async (set: HistorySet, groupId: number) => {
    const targetSet = fullSets.find((item) => item.id === set.id) ?? set;
    const group = targetSet.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    setActionMessage('Restoring group...');
    try {
      const windowId = await getCurrentWindowId();
      const tabs = targetSet.tabs.filter((tab) => tab.groupId === groupId);
      await restoreTabs(tabs, [group], windowId);
      setActionMessage('Group restored.');
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to restore group.');
    }
  };

  const handleRestoreTab = async (tab: TabSnapshot) => {
    setActionMessage('Restoring tab...');
    try {
      const windowId = await getCurrentWindowId();
      await restoreTabs([tab], [], windowId);
      setActionMessage('Tab restored.');
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to restore tab.');
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="manager manager--center">
        <p>Loading tab history...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="manager manager--center">
        <p className="manager__error">{state.error}</p>
      </div>
    );
  }

  return (
    <div className="manager">
      <header className="manager__header">
        <span className="manager__badge">Tab Manager</span>
        <h1 className="manager__title">Saved tab sessions</h1>
        <p className="manager__subtitle">
          Restore, search, and filter across your saved tab sessions.
        </p>
      </header>

      <section className="manager__controls">
        <input
          className="manager__search"
          type="search"
          placeholder="Search titles or URLs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="manager__select"
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
        >
          {groupOptions.map((option) => (
            <option key={option} value={option}>
              {option === GROUP_FILTER_ALL
                ? 'All groups'
                : option === GROUP_FILTER_UNGROUPED
                  ? 'Ungrouped'
                  : option}
            </option>
          ))}
        </select>
        {actionMessage ? <span className="manager__status">{actionMessage}</span> : null}
      </section>

      <main className="manager__content">
        {filteredSets.length === 0 ? (
          <p className="manager__empty">No tabs match the current filters.</p>
        ) : (
          filteredSets.map((set) => {
            const groupedTabs = groupTabsById(set.tabs);
            const fullSet = fullSets.find((item) => item.id === set.id);
            const totalTabs = fullSet?.tabs.length ?? set.tabs.length;
            const visibleTabs = set.tabs.length;
            const tabSummary =
              totalTabs === visibleTabs
                ? `${visibleTabs} tabs saved`
                : `${visibleTabs} / ${totalTabs} shown`;
            return (
              <article key={set.id} className="manager__card">
                <div className="manager__card-header">
                  <div>
                    <h2 className="manager__card-title">{formatTimestamp(set.createdAt)}</h2>
                    <p className="manager__card-meta">{tabSummary}</p>
                  </div>
                  <div className="manager__card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => handleRestoreSet(set)}
                    >
                      Restore all
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleDeleteSet(set.id)}
                    >
                      Delete set
                    </button>
                  </div>
                </div>

                {set.groups.map((group) => {
                  const tabs = groupedTabs.get(group.id) ?? [];
                  if (tabs.length === 0) {
                    return null;
                  }
                  return (
                    <section key={group.id} className="manager__group">
                      <div className="manager__group-header">
                        <h3 className="manager__group-title">{group.title}</h3>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => handleRestoreGroup(set, group.id)}
                        >
                          Restore group
                        </button>
                      </div>
                      <ul className="manager__tab-list">
                        {tabs.map((tab) => (
                          <li key={`${tab.url}-${tab.index}`} className="manager__tab">
                            <div>
                              <p className="manager__tab-title">{tab.title}</p>
                              <p className="manager__tab-url">{tab.url}</p>
                            </div>
                            <div className="manager__tab-actions">
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => handleRestoreTab(tab)}
                              >
                                Open
                              </button>
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => handleDeleteTab(set.id, tab)}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}

                {groupedTabs.has(null) ? (
                  <section className="manager__group">
                    <div className="manager__group-header">
                      <h3 className="manager__group-title">Ungrouped</h3>
                    </div>
                    <ul className="manager__tab-list">
                      {(groupedTabs.get(null) ?? []).map((tab) => (
                        <li key={`${tab.url}-${tab.index}`} className="manager__tab">
                          <div>
                            <p className="manager__tab-title">{tab.title}</p>
                            <p className="manager__tab-url">{tab.url}</p>
                          </div>
                          <div className="manager__tab-actions">
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={() => handleRestoreTab(tab)}
                            >
                              Open
                            </button>
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={() => handleDeleteTab(set.id, tab)}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </article>
            );
          })
        )}
      </main>
    </div>
  );
}
