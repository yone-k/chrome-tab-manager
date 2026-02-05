import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

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
import type { DragItem, DropTarget } from './dragReorder';
import { applyDragReorder } from './dragReorder';
import { computeDropGapPx, DEFAULT_DROP_GAP_PX } from './dropGap';
import { selectDragItemHeight } from './dragHeight';
import './manager.css';

type LoadState = 'loading' | 'ready' | 'error';
type DragData = {
  dragItem: DragItem;
  dragLabel: string;
};

type DropItemData =
  | { type: 'set-zone'; index: number }
  | { type: 'group-zone'; setId: string; index: number }
  | { type: 'tab-zone'; setId: string; groupUid: string | null; index: number };

type ActiveDrop = {
  dropItem: DropItemData;
  dropTarget: DropTarget;
  overId: string;
};

const SET_LIST_GAP_PX = 16;
const GROUP_LIST_GAP_PX = 16;
const TAB_LIST_GAP_PX = 10;

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    let smallestCollision = pointerCollisions[0];
    let smallestArea = Number.POSITIVE_INFINITY;
    for (const collision of pointerCollisions) {
      const rect = collision.data?.droppableContainer?.rect.current;
      const area = rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
      if (area < smallestArea) {
        smallestArea = area;
        smallestCollision = collision;
      }
    }
    return [smallestCollision];
  }
  return closestCenter(args);
};

type DropZoneProps = {
  id: string;
  dropItem: DropItemData;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
  baseGapPx: number;
  reorderEnabled: boolean;
};

function DropZone({
  id,
  dropItem,
  activeDrop,
  dropGapPx,
  baseGapPx,
  reorderEnabled,
}: DropZoneProps) {
  const { setNodeRef } = useDroppable({
    id,
    data: { dropItem },
    disabled: !reorderEnabled,
  });
  const isActive = activeDrop?.overId === id;
  const height = isActive ? dropGapPx : baseGapPx;
  return (
    <div
      ref={setNodeRef}
      className={`manager__drop-zone${isActive ? ' manager__drop-zone--active' : ''}`}
      style={{ height }}
    />
  );
}

function OverlayHandle({ compact }: { compact?: boolean }) {
  return (
    <span
      className={compact ? 'drag-handle drag-handle--compact' : 'drag-handle'}
      aria-hidden="true"
    />
  );
}

function OverlayTabRow({ tab }: { tab: TabSnapshot }) {
  return (
    <div className="manager__tab manager__tab--overlay">
      <OverlayHandle compact />
      <div className="manager__tab-main">
        <p className="manager__tab-title">{tab.title}</p>
        <p className="manager__tab-url">{tab.url}</p>
      </div>
      <div className="manager__tab-actions">
        <button className="ghost-button" type="button" disabled>
          削除
        </button>
      </div>
    </div>
  );
}

function OverlayGroupSection({ group, tabs }: { group: GroupSnapshot; tabs: TabSnapshot[] }) {
  return (
    <section className="manager__group manager__group--overlay">
      <div className="manager__group-header">
        <div className="manager__group-header-main">
          <OverlayHandle compact />
          <h3 className="manager__group-title">{group.title}</h3>
        </div>
        <button className="ghost-button" type="button" disabled>
          グループを復元
        </button>
      </div>
      <div className="manager__tab-list">
        {tabs.map((tab) => (
          <OverlayTabRow key={tab.uid} tab={tab} />
        ))}
      </div>
    </section>
  );
}

function OverlaySetCard({ set }: { set: HistorySet }) {
  const groupedTabs = groupTabsById(set.tabs);
  const totalTabs = set.tabs.length;
  const tabSummary = `保存済みタブ: ${totalTabs}件`;
  const groupEntries = set.groups
    .map((group) => ({ group, tabs: groupedTabs.get(group.id) ?? [] }))
    .filter((entry) => entry.tabs.length > 0);
  const ungroupedTabs = groupedTabs.get(null) ?? [];

  return (
    <article className="manager__card manager__card--overlay">
      <div className="manager__card-header">
        <div className="manager__card-header-main">
          <OverlayHandle />
          <div>
            <h2 className="manager__card-title">{formatTimestamp(set.createdAt)}</h2>
            <p className="manager__card-meta">{tabSummary}</p>
          </div>
        </div>
        <div className="manager__card-actions">
          <button className="primary-button" type="button" disabled>
            すべて復元
          </button>
          <button className="ghost-button" type="button" disabled>
            セットを削除
          </button>
        </div>
      </div>

      {groupEntries.map((entry) => (
        <OverlayGroupSection key={entry.group.uid} group={entry.group} tabs={entry.tabs} />
      ))}

      {ungroupedTabs.length > 0 ? (
        <section className="manager__group manager__group--overlay">
          <div className="manager__group-header">
            <h3 className="manager__group-title">未グループ</h3>
          </div>
          <div className="manager__tab-list">
            {ungroupedTabs.map((tab) => (
              <OverlayTabRow key={tab.uid} tab={tab} />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDragItem(value: unknown): value is DragItem {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'set') {
    return typeof value.setId === 'string';
  }
  if (value.type === 'group') {
    return typeof value.setId === 'string' && typeof value.groupUid === 'string';
  }
  if (value.type === 'tab') {
    return typeof value.setId === 'string' && typeof value.tabUid === 'string';
  }
  return false;
}

function isDragData(value: unknown): value is DragData {
  return isRecord(value) && typeof value.dragLabel === 'string' && isDragItem(value.dragItem);
}

function isDropItemData(value: unknown): value is DropItemData {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'set-zone') {
    return typeof value.index === 'number';
  }
  if (value.type === 'group-zone') {
    return typeof value.setId === 'string' && typeof value.index === 'number';
  }
  if (value.type === 'tab-zone') {
    const groupUid = value.groupUid;
    return (
      typeof value.setId === 'string' &&
      typeof value.index === 'number' &&
      (groupUid === null || typeof groupUid === 'string')
    );
  }
  return false;
}

function isDropItemPayload(value: unknown): value is { dropItem: DropItemData } {
  return isRecord(value) && isDropItemData(value.dropItem);
}

type BodyScrollLockState = {
  overflow: string;
  paddingRight: string;
};

function getScrollbarWidth() {
  return window.innerWidth - document.documentElement.clientWidth;
}

function getDragSourceHeight(event: Event | null) {
  if (!event) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const source = target.closest('.manager__card, .manager__group, .manager__tab');
  if (!source) {
    return null;
  }
  const height = source.getBoundingClientRect().height;
  return height > 0 ? height : null;
}

function buildDropTarget(dropItem: DropItemData): DropTarget {
  if (dropItem.type === 'set-zone') {
    return { type: 'set-list', index: dropItem.index };
  }
  if (dropItem.type === 'group-zone') {
    return { type: 'group-list', setId: dropItem.setId, index: dropItem.index };
  }
  return {
    type: 'tab-list',
    setId: dropItem.setId,
    groupUid: dropItem.groupUid,
    index: dropItem.index,
  };
}

type TabRowActions = ReturnType<typeof createTabRowActions<TabSnapshot>>;

type TabRowProps = {
  tab: TabSnapshot;
  setId: string;
  reorderEnabled: boolean;
  rowActions: TabRowActions;
};

function TabRow({ tab, setId, reorderEnabled, rowActions }: TabRowProps) {
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `tab:${tab.uid}`,
    data: {
      dragItem: { type: 'tab', setId, tabUid: tab.uid },
      dragLabel: tab.title,
    },
    disabled: !reorderEnabled,
  });

  return (
    <li
      ref={setDragRef}
      className={`manager__tab manager__tab--clickable${
        isDragging ? ' manager__tab--dragging' : ''
      }`}
      role="button"
      tabIndex={0}
      aria-label={`${tab.title}を開く`}
      onClick={rowActions.handleRowClick(tab)}
      onKeyDown={rowActions.handleRowKeyDown(tab)}
    >
      <button
        className="drag-handle drag-handle--compact"
        type="button"
        aria-label="タブを並び替え"
        onClick={(event) => event.stopPropagation()}
        disabled={!reorderEnabled}
        {...attributes}
        {...listeners}
      />
      <div className="manager__tab-main">
        <p className="manager__tab-title">{tab.title}</p>
        <p className="manager__tab-url">{tab.url}</p>
      </div>
      <div className="manager__tab-actions">
        <button className="ghost-button" type="button" onClick={rowActions.handleRemoveClick(tab)}>
          削除
        </button>
      </div>
    </li>
  );
}

type TabListProps = {
  tabs: TabSnapshot[];
  setId: string;
  groupUid: string | null;
  reorderEnabled: boolean;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function TabList({
  tabs,
  setId,
  groupUid,
  reorderEnabled,
  rowActions,
  activeDrop,
  dropGapPx,
}: TabListProps) {
  return (
    <ul className="manager__tab-list">
      <DropZone
        id={`zone:tab:${setId}:${groupUid ?? 'ungrouped'}:0`}
        dropItem={{ type: 'tab-zone', setId, groupUid, index: 0 }}
        activeDrop={activeDrop}
        dropGapPx={dropGapPx}
        baseGapPx={TAB_LIST_GAP_PX}
        reorderEnabled={reorderEnabled}
      />
      {tabs.map((tab, index) => (
        <Fragment key={tab.uid}>
          <TabRow tab={tab} setId={setId} reorderEnabled={reorderEnabled} rowActions={rowActions} />
          <DropZone
            id={`zone:tab:${setId}:${groupUid ?? 'ungrouped'}:${index + 1}`}
            dropItem={{ type: 'tab-zone', setId, groupUid, index: index + 1 }}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
            baseGapPx={TAB_LIST_GAP_PX}
            reorderEnabled={reorderEnabled}
          />
        </Fragment>
      ))}
    </ul>
  );
}

type GroupListEntry = {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
};

type GroupListProps = {
  entries: GroupListEntry[];
  setId: string;
  reorderEnabled: boolean;
  onRestoreGroup: (groupId: number) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function GroupList({
  entries,
  setId,
  reorderEnabled,
  onRestoreGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: GroupListProps) {
  return (
    <div className="manager__group-list">
      <DropZone
        id={`zone:group:${setId}:0`}
        dropItem={{ type: 'group-zone', setId, index: 0 }}
        activeDrop={activeDrop}
        dropGapPx={dropGapPx}
        baseGapPx={GROUP_LIST_GAP_PX}
        reorderEnabled={reorderEnabled}
      />
      {entries.map((entry, index) => (
        <Fragment key={entry.group.uid}>
          <GroupSection
            setId={setId}
            group={entry.group}
            tabs={entry.tabs}
            reorderEnabled={reorderEnabled}
            onRestoreGroup={onRestoreGroup}
            rowActions={rowActions}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
          />
          <DropZone
            id={`zone:group:${setId}:${index + 1}`}
            dropItem={{ type: 'group-zone', setId, index: index + 1 }}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
            baseGapPx={GROUP_LIST_GAP_PX}
            reorderEnabled={reorderEnabled}
          />
        </Fragment>
      ))}
    </div>
  );
}

type GroupSectionProps = {
  setId: string;
  group: GroupSnapshot;
  tabs: TabSnapshot[];
  reorderEnabled: boolean;
  onRestoreGroup: (groupId: number) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function GroupSection({
  setId,
  group,
  tabs,
  reorderEnabled,
  onRestoreGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: GroupSectionProps) {
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `group:${group.uid}`,
    data: {
      dragItem: { type: 'group', setId, groupUid: group.uid },
      dragLabel: group.title,
    },
    disabled: !reorderEnabled,
  });

  return (
    <section
      ref={setDragRef}
      className={`manager__group${isDragging ? ' manager__group--dragging' : ''}`}
    >
      <div className="manager__group-header">
        <div className="manager__group-header-main">
          <button
            className="drag-handle drag-handle--compact"
            type="button"
            aria-label="グループを並び替え"
            onClick={(event) => event.stopPropagation()}
            disabled={!reorderEnabled}
            {...attributes}
            {...listeners}
          />
          <h3 className="manager__group-title">{group.title}</h3>
        </div>
        <button className="ghost-button" type="button" onClick={() => onRestoreGroup(group.id)}>
          グループを復元
        </button>
      </div>
      <TabList
        tabs={tabs}
        setId={setId}
        groupUid={group.uid}
        reorderEnabled={reorderEnabled}
        rowActions={rowActions}
        activeDrop={activeDrop}
        dropGapPx={dropGapPx}
      />
    </section>
  );
}

type SetCardProps = {
  set: HistorySet;
  fullSet?: HistorySet;
  reorderEnabled: boolean;
  onRestoreSet: () => void;
  onDeleteSet: () => void;
  onRestoreGroup: (groupId: number) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function SetCard({
  set,
  fullSet,
  reorderEnabled,
  onRestoreSet,
  onDeleteSet,
  onRestoreGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: SetCardProps) {
  const groupedTabs = groupTabsById(set.tabs);
  const totalTabs = fullSet?.tabs.length ?? set.tabs.length;
  const visibleTabs = set.tabs.length;
  const tabSummary =
    totalTabs === visibleTabs
      ? `保存済みタブ: ${visibleTabs}件`
      : `表示中: ${visibleTabs} / ${totalTabs}件`;
  const dragLabel = formatTimestamp(set.createdAt);
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `set:${set.id}`,
    data: {
      dragItem: { type: 'set', setId: set.id },
      dragLabel,
    },
    disabled: !reorderEnabled,
  });

  const groupEntries = set.groups
    .map((group) => ({ group, tabs: groupedTabs.get(group.id) ?? [] }))
    .filter((entry) => entry.tabs.length > 0);
  const ungroupedTabs = groupedTabs.get(null) ?? [];
  const shouldShowUngrouped = ungroupedTabs.length > 0;
  const shouldShowGroupList = reorderEnabled || groupEntries.length > 0;

  return (
    <article
      ref={setDragRef}
      className={`manager__card${isDragging ? ' manager__card--dragging' : ''}`}
    >
      <div className="manager__card-header">
        <div className="manager__card-header-main">
          <button
            className="drag-handle"
            type="button"
            aria-label="セッションを並び替え"
            onClick={(event) => event.stopPropagation()}
            disabled={!reorderEnabled}
            {...attributes}
            {...listeners}
          />
          <div>
            <h2 className="manager__card-title">{dragLabel}</h2>
            <p className="manager__card-meta">{tabSummary}</p>
          </div>
        </div>
        <div className="manager__card-actions">
          <button className="primary-button" type="button" onClick={onRestoreSet}>
            すべて復元
          </button>
          <button className="ghost-button" type="button" onClick={onDeleteSet}>
            セットを削除
          </button>
        </div>
      </div>

      {shouldShowGroupList ? (
        <GroupList
          entries={groupEntries}
          setId={set.id}
          reorderEnabled={reorderEnabled}
          onRestoreGroup={onRestoreGroup}
          rowActions={rowActions}
          activeDrop={activeDrop}
          dropGapPx={dropGapPx}
        />
      ) : null}

      {shouldShowUngrouped ? (
        <section className="manager__group">
          <div className="manager__group-header">
            <h3 className="manager__group-title">未グループ</h3>
          </div>
          <TabList
            tabs={ungroupedTabs}
            setId={set.id}
            groupUid={null}
            reorderEnabled={reorderEnabled}
            rowActions={rowActions}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
          />
        </section>
      ) : null}
    </article>
  );
}

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
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [activeDrop, setActiveDrop] = useState<ActiveDrop | null>(null);
  const [dropGapPx, setDropGapPx] = useState(DEFAULT_DROP_GAP_PX);
  const [dragSpacerPx, setDragSpacerPx] = useState(0);
  const dragLatestScrollYRef = useRef<number | null>(null);
  const bodyScrollLockRef = useRef<BodyScrollLockState | null>(null);

  const reorderEnabled = query.trim() === '' && groupFilter === GROUP_FILTER_ALL;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

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

  const fullSets = useMemo(
    () => (state.status === 'ready' && state.data ? state.data : []),
    [state],
  );
  const visibleSets = reorderEnabled ? fullSets : filteredSets;
  const overlayContent = useMemo(() => {
    if (!activeDrag) {
      return null;
    }

    const { dragItem, dragLabel } = activeDrag;

    if (dragItem.type === 'set') {
      const set = fullSets.find((item) => item.id === dragItem.setId);
      if (set) {
        return (
          <div className="manager__drag-overlay">
            <OverlaySetCard set={set} />
          </div>
        );
      }
    }

    if (dragItem.type === 'group') {
      const set = fullSets.find((item) => item.id === dragItem.setId);
      const group = set?.groups.find((item) => item.uid === dragItem.groupUid);
      if (set && group) {
        const tabs = set.tabs.filter((tab) => tab.groupId === group.id);
        return (
          <div className="manager__drag-overlay">
            <OverlayGroupSection group={group} tabs={tabs} />
          </div>
        );
      }
    }

    if (dragItem.type === 'tab') {
      const set = fullSets.find((item) => item.id === dragItem.setId);
      const tab = set?.tabs.find((item) => item.uid === dragItem.tabUid);
      if (tab) {
        return (
          <div className="manager__drag-overlay">
            <OverlayTabRow tab={tab} />
          </div>
        );
      }
    }

    return (
      <div className="manager__drag-overlay manager__drag-overlay--label">
        <span className="manager__drag-label">{dragLabel}</span>
      </div>
    );
  }, [activeDrag, fullSets]);

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

  const lockBodyScroll = () => {
    if (bodyScrollLockRef.current) {
      return;
    }
    const body = document.body;
    const computedPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight || '0') || 0;
    const scrollbarWidth = getScrollbarWidth();
    bodyScrollLockRef.current = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    }
  };

  const unlockBodyScroll = () => {
    const saved = bodyScrollLockRef.current;
    if (!saved) {
      return;
    }
    const body = document.body;
    body.style.overflow = saved.overflow;
    body.style.paddingRight = saved.paddingRight;
    bodyScrollLockRef.current = null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!reorderEnabled) {
      return;
    }
    lockBodyScroll();
    dragLatestScrollYRef.current = window.scrollY;
    const data = event.active.data.current;
    if (!isDragData(data)) {
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }
    const rect = event.active.rect.current;
    const height = selectDragItemHeight({
      eventTargetHeight: getDragSourceHeight(event.activatorEvent),
      rectInitialHeight: rect?.initial?.height ?? null,
      rectTranslatedHeight: rect?.translated?.height ?? null,
    });
    setDropGapPx(computeDropGapPx(height));
    setDragSpacerPx(height ?? 0);
    setActiveDrag(data);
    setActiveDrop(null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!reorderEnabled) {
      return;
    }
    dragLatestScrollYRef.current = window.scrollY;
    const over = event.over;
    const dropData = over?.data.current;
    if (!over || !isDropItemPayload(dropData)) {
      setActiveDrop(null);
      return;
    }
    const dropTarget = buildDropTarget(dropData.dropItem);
    setActiveDrop({
      dropItem: dropData.dropItem,
      dropTarget,
      overId: String(over.id),
    });
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setActiveDrop(null);
    dragLatestScrollYRef.current = null;
    setDropGapPx(DEFAULT_DROP_GAP_PX);
    setDragSpacerPx(0);
    unlockBodyScroll();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!reorderEnabled) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }
    const data = event.active.data.current;
    const dropTarget = activeDrop?.dropTarget ?? null;
    if (!isDragData(data) || !dropTarget) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }

    const nextSets = applyDragReorder(fullSets, data.dragItem, dropTarget);
    if (nextSets === fullSets) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }

    const updated = await updateState((current) => ({
      ...current,
      historySets: nextSets,
    }));
    await refreshState(updated.historySets);
    setActiveDrag(null);
    setActiveDrop(null);
    const scrollY = dragLatestScrollYRef.current;
    dragLatestScrollYRef.current = null;
    setDropGapPx(DEFAULT_DROP_GAP_PX);
    setDragSpacerPx(0);
    unlockBodyScroll();
    if (scrollY !== null) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY });
      });
    }
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
        const filteredTabs = set.tabs.filter((tab) => tab.uid !== tabToDelete.uid);
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
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
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

        <main
          className="manager__content"
          style={dragSpacerPx > 0 ? { paddingBottom: dragSpacerPx } : undefined}
        >
          {visibleSets.length === 0 ? (
            <p className="manager__empty">現在のフィルタに一致するタブがありません。</p>
          ) : (
            <>
              <DropZone
                id="zone:set:0"
                dropItem={{ type: 'set-zone', index: 0 }}
                activeDrop={activeDrop}
                dropGapPx={dropGapPx}
                baseGapPx={SET_LIST_GAP_PX}
                reorderEnabled={reorderEnabled}
              />
              {visibleSets.map((set, setIndex) => {
                const fullSet = fullSets.find((item) => item.id === set.id);
                const rowActions = createTabRowActions<TabSnapshot>({
                  onOpen: handleRestoreTab,
                  onRemove: (tab) => handleDeleteTab(set.id, tab),
                });

                return (
                  <Fragment key={set.id}>
                    <SetCard
                      set={set}
                      fullSet={fullSet}
                      reorderEnabled={reorderEnabled}
                      onRestoreSet={() => handleRestoreSet(set)}
                      onDeleteSet={() => handleDeleteSet(set.id)}
                      onRestoreGroup={(groupId) => handleRestoreGroup(set, groupId)}
                      rowActions={rowActions}
                      activeDrop={activeDrop}
                      dropGapPx={dropGapPx}
                    />
                    <DropZone
                      id={`zone:set:${setIndex + 1}`}
                      dropItem={{ type: 'set-zone', index: setIndex + 1 }}
                      activeDrop={activeDrop}
                      dropGapPx={dropGapPx}
                      baseGapPx={SET_LIST_GAP_PX}
                      reorderEnabled={reorderEnabled}
                    />
                  </Fragment>
                );
              })}
            </>
          )}
        </main>
      </div>
      <DragOverlay dropAnimation={null}>{overlayContent}</DragOverlay>
    </DndContext>
  );
}
