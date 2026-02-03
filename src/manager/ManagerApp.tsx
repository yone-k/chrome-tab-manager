import { useEffect, useMemo, useState } from 'react';

import {
  buildGroupFilterOptions,
  filterHistorySets,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from '../tab-manager/filters';
import { getState, STATE_KEY, updateState } from '../tab-manager/storage';
import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';
import { cleanupHistorySet } from './restoreCleanup';
import { shouldSuppressRestoreLoading } from './restorePolicy';
import { createTabRowActions } from './tabRowActions';
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
        reject(new Error('アクティブなウィンドウが見つかりません。'));
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

async function discardTab(tabId: number) {
  return new Promise<void>((resolve) => {
    chrome.tabs.discard(tabId, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to discard tab', chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

function matchesExpectedUrl(
  expectedUrl: string,
  tab: chrome.tabs.Tab,
  changeInfo?: chrome.tabs.TabChangeInfo,
) {
  const candidates = [changeInfo?.url, tab.url].filter((value): value is string => Boolean(value));

  return candidates.some((value) => value === expectedUrl);
}

async function waitForTabUrl(tabId: number, expectedUrl: string, timeoutMs = 1000) {
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
      console.error('Discard wait timeout reached', { tabId, expectedUrl });
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

async function restoreTabs(
  tabs: TabSnapshot[],
  groups: GroupSnapshot[],
  windowId: number,
  restoreLoadingSuppressionEnabled: boolean,
) {
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const createdTabs: Array<{ snapshot: TabSnapshot; tab: chrome.tabs.Tab }> = [];
  const shouldDiscard = shouldSuppressRestoreLoading({
    enabled: restoreLoadingSuppressionEnabled,
    tabCount: sortedTabs.length,
  });

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
    let newGroupId: number | null = null;
    try {
      newGroupId = await groupTabs(windowId, tabIds);
    } catch (err) {
      console.error('Failed to create tab group', err);
      continue;
    }
    try {
      await updateTabGroup(newGroupId, group);
    } catch (err) {
      console.error('Failed to update tab group', err);
    }
    try {
      await moveTabGroup(newGroupId, group.index);
    } catch (err) {
      console.error('Failed to move tab group', err);
    }
  }

  if (shouldDiscard) {
    const results = await Promise.all(
      createdTabs.map(async ({ snapshot, tab }) => {
        if (tab.id === undefined) {
          return { snapshot, restored: false };
        }
        const matched = await waitForTabUrl(tab.id, snapshot.url);
        if (!matched) {
          console.error('Failed to confirm tab url before discard', {
            tabId: tab.id,
            expectedUrl: snapshot.url,
          });
          return { snapshot, restored: false };
        }
        await discardTab(tab.id);
        return { snapshot, restored: true };
      }),
    );
    const restoredTabs = results
      .filter((result) => result.restored)
      .map((result) => result.snapshot);
    const failedTabs = results
      .filter((result) => !result.restored)
      .map((result) => result.snapshot);
    return { restoredTabs, failedTabs };
  }

  return { restoredTabs: sortedTabs, failedTabs: [] };
}

export function ManagerApp() {
  const optionsUrl = chrome.runtime.getURL('options.html');
  const [state, setState] = useState<{
    status: LoadState;
    data?: HistorySet[];
    error?: string;
    restoreLoadingSuppressionEnabled?: boolean;
    removeRestoredTabsEnabled?: boolean;
  }>({ status: 'loading' });
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
        setState({
          status: 'ready',
          data: stored.historySets,
          restoreLoadingSuppressionEnabled: stored.restoreLoadingSuppressionEnabled,
          removeRestoredTabsEnabled: stored.removeRestoredTabsEnabled,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : '履歴の読み込みに失敗しました。',
          });
        }
      }
    }
    load();
    const handleChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[STATE_KEY]) {
        return;
      }
      load();
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleChange);
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
    setState((current) => ({
      status: 'ready',
      data: nextSets,
      restoreLoadingSuppressionEnabled: current.restoreLoadingSuppressionEnabled ?? true,
      removeRestoredTabsEnabled: current.removeRestoredTabsEnabled ?? true,
    }));
  };

  const restoreLoadingSuppressionEnabled = state.restoreLoadingSuppressionEnabled ?? true;
  const removeRestoredTabsEnabled = state.removeRestoredTabsEnabled ?? true;

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
    setActionMessage('タブを復元しています...');
    try {
      const targetSet = fullSets.find((item) => item.id === set.id) ?? set;
      const windowId = await getCurrentWindowId();
      const { restoredTabs, failedTabs } = await restoreTabs(
        targetSet.tabs,
        targetSet.groups,
        windowId,
        restoreLoadingSuppressionEnabled,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets
            .map((item) => {
              if (item.id !== targetSet.id) {
                return item;
              }
              return cleanupHistorySet(item, restoredTabs);
            })
            .filter((item): item is HistorySet => item !== null),
        }));
        await refreshState(updated.historySets);
      }
      if (failedTabs.length > 0) {
        setActionMessage(
          `${targetSet.tabs.length} 件中 ${restoredTabs.length} 件のタブを復元しました。`,
        );
      } else {
        setActionMessage('タブを復元しました。');
      }
    } catch (err) {
      console.error('Failed to restore tabs', err);
      setActionMessage(
        err instanceof Error ? err.message : 'タブの復元に失敗しました。もう一度お試しください。',
      );
    }
  };

  const handleRestoreGroup = async (set: HistorySet, groupId: number) => {
    const targetSet = fullSets.find((item) => item.id === set.id) ?? set;
    const group = targetSet.groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    setActionMessage('グループを復元しています...');
    try {
      const windowId = await getCurrentWindowId();
      const tabs = targetSet.tabs.filter((tab) => tab.groupId === groupId);
      const { restoredTabs, failedTabs } = await restoreTabs(
        tabs,
        [group],
        windowId,
        restoreLoadingSuppressionEnabled,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets
            .map((item) => {
              if (item.id !== targetSet.id) {
                return item;
              }
              return cleanupHistorySet(item, restoredTabs);
            })
            .filter((item): item is HistorySet => item !== null),
        }));
        await refreshState(updated.historySets);
      }
      if (failedTabs.length > 0) {
        setActionMessage(`${tabs.length} 件中 ${restoredTabs.length} 件のタブを復元しました。`);
      } else {
        setActionMessage('グループを復元しました。');
      }
    } catch (err) {
      console.error('Failed to restore group', err);
      setActionMessage(err instanceof Error ? err.message : 'グループの復元に失敗しました。');
    }
  };

  const handleRestoreTab = async (tab: TabSnapshot) => {
    setActionMessage('タブを復元しています...');
    try {
      const windowId = await getCurrentWindowId();
      const { restoredTabs } = await restoreTabs(
        [tab],
        [],
        windowId,
        restoreLoadingSuppressionEnabled,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets
            .map((item) => cleanupHistorySet(item, restoredTabs))
            .filter((item): item is HistorySet => item !== null),
        }));
        await refreshState(updated.historySets);
      }
      if (restoredTabs.length === 1) {
        setActionMessage('タブを復元しました。');
      } else {
        setActionMessage('タブの復元に失敗しました。');
      }
    } catch (err) {
      console.error('Failed to restore tab', err);
      setActionMessage(err instanceof Error ? err.message : 'タブの復元に失敗しました。');
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="manager manager--center">
        <p>タブ履歴を読み込んでいます...</p>
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
        <div className="manager__header-top">
          <span className="manager__badge">タブマネージャー</span>
          <a
            className="ghost-button manager__options-link"
            href={optionsUrl}
            target="_blank"
            rel="noreferrer"
          >
            設定
          </a>
        </div>
        <h1 className="manager__title">保存済みのタブセッション</h1>
        <p className="manager__subtitle">
          保存済みのタブセッションを復元・検索・フィルタできます。
        </p>
      </header>

      <section className="manager__controls">
        <input
          className="manager__search"
          type="search"
          placeholder="タイトルまたはURLで検索"
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
                ? 'すべてのグループ'
                : option === GROUP_FILTER_UNGROUPED
                  ? '未グループ'
                  : option}
            </option>
          ))}
        </select>
        {actionMessage ? <span className="manager__status">{actionMessage}</span> : null}
      </section>

      <main className="manager__content">
        {filteredSets.length === 0 ? (
          <p className="manager__empty">現在のフィルタに一致するタブがありません。</p>
        ) : (
          filteredSets.map((set) => {
            const groupedTabs = groupTabsById(set.tabs);
            const fullSet = fullSets.find((item) => item.id === set.id);
            const totalTabs = fullSet?.tabs.length ?? set.tabs.length;
            const visibleTabs = set.tabs.length;
            const tabSummary =
              totalTabs === visibleTabs
                ? `保存済みタブ: ${visibleTabs}件`
                : `表示中: ${visibleTabs} / ${totalTabs}件`;
            const rowActions = createTabRowActions<TabSnapshot>({
              onOpen: handleRestoreTab,
              onRemove: (tab) => handleDeleteTab(set.id, tab),
            });
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
                      すべて復元
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleDeleteSet(set.id)}
                    >
                      セットを削除
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
                          グループを復元
                        </button>
                      </div>
                      <ul className="manager__tab-list">
                        {tabs.map((tab) => (
                          <li
                            key={`${tab.url}-${tab.index}`}
                            className="manager__tab manager__tab--clickable"
                            role="button"
                            tabIndex={0}
                            aria-label={`${tab.title}を開く`}
                            onClick={rowActions.handleRowClick(tab)}
                            onKeyDown={rowActions.handleRowKeyDown(tab)}
                          >
                            <div className="manager__tab-main">
                              <p className="manager__tab-title">{tab.title}</p>
                              <p className="manager__tab-url">{tab.url}</p>
                            </div>
                            <div className="manager__tab-actions">
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={rowActions.handleRemoveClick(tab)}
                              >
                                削除
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
                      <h3 className="manager__group-title">未グループ</h3>
                    </div>
                    <ul className="manager__tab-list">
                      {(groupedTabs.get(null) ?? []).map((tab) => (
                        <li
                          key={`${tab.url}-${tab.index}`}
                          className="manager__tab manager__tab--clickable"
                          role="button"
                          tabIndex={0}
                          aria-label={`${tab.title}を開く`}
                          onClick={rowActions.handleRowClick(tab)}
                          onKeyDown={rowActions.handleRowKeyDown(tab)}
                        >
                          <div className="manager__tab-main">
                            <p className="manager__tab-title">{tab.title}</p>
                            <p className="manager__tab-url">{tab.url}</p>
                          </div>
                          <div className="manager__tab-actions">
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={rowActions.handleRemoveClick(tab)}
                            >
                              削除
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
