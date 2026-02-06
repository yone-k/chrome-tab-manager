import { Fragment, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  DEFAULT_NEW_WINDOW_NAME,
  createHistoryId,
  normalizeManualHistorySetName,
} from '../tab-manager/history';
import {
  buildGroupFilterOptions,
  filterHistorySets,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from '../tab-manager/filters';
import { normalizeLayout } from '../tab-manager/layout';
import { getState, STATE_KEY, updateState } from '../tab-manager/storage';
import type { GroupSnapshot, HistorySet, TabSnapshot } from '../tab-manager/types';
import { createUid } from '../tab-manager/uid';
import { deleteGroupFromHistorySet } from './groupState';
import { cleanupHistorySet } from './restoreCleanup';
import { shouldSuppressRestoreLoading } from './restorePolicy';
import { resolveRestoreTarget } from './restoreTarget';
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
  | { type: 'block-zone'; setId: string; index: number }
  | { type: 'tab-zone'; setId: string; groupUid: string; index: number };

type ActiveDrop = {
  dropItem: DropItemData;
  dropTarget: DropTarget;
  overId: string;
};

const SET_LIST_GAP_PX = 16;
const BLOCK_LIST_GAP_PX = 16;
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

function OverlayUngroupedTabBlock({ tab }: { tab: TabSnapshot }) {
  return (
    <div className="manager__tab-list manager__tab-list--block">
      <OverlayTabRow tab={tab} />
    </div>
  );
}

function OverlaySetCard({ set }: { set: HistorySet }) {
  const totalTabs = set.tabs.length;
  const tabSummary = `保存済みタブ: ${totalTabs}件`;
  const layoutEntries = buildLayoutEntries(set);

  return (
    <article className="manager__card manager__card--overlay">
      <div className="manager__card-header">
        <div className="manager__card-header-main">
          <OverlayHandle />
          <div>
            <h2 className="manager__card-title">{set.name}</h2>
            <p className="manager__card-meta">{tabSummary}</p>
          </div>
        </div>
        <div className="manager__card-actions">
          <button className="primary-button" type="button" disabled>
            すべて復元
          </button>
          <button className="ghost-button" type="button" disabled>
            ウィンドウを削除
          </button>
        </div>
      </div>

      {layoutEntries.map((entry) =>
        entry.type === 'group' ? (
          <OverlayGroupSection key={entry.group.uid} group={entry.group} tabs={entry.tabs} />
        ) : (
          <OverlayUngroupedTabBlock key={entry.tab.uid} tab={entry.tab} />
        ),
      )}
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
  if (value.type === 'block-zone') {
    return typeof value.setId === 'string' && typeof value.index === 'number';
  }
  if (value.type === 'tab-zone') {
    return (
      typeof value.setId === 'string' &&
      typeof value.index === 'number' &&
      typeof value.groupUid === 'string'
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
  if (dropItem.type === 'block-zone') {
    return { type: 'block-list', setId: dropItem.setId, index: dropItem.index };
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
  groupUid: string;
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
        id={`zone:tab:${setId}:${groupUid}:0`}
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
            id={`zone:tab:${setId}:${groupUid}:${index + 1}`}
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

type LayoutEntry =
  | { type: 'group'; group: GroupSnapshot; tabs: TabSnapshot[] }
  | { type: 'tab'; tab: TabSnapshot };

function buildLayoutEntries(set: HistorySet): LayoutEntry[] {
  const layout = normalizeLayout(set.layout, set.groups, set.tabs);
  const groupByUid = new Map(set.groups.map((group) => [group.uid, group]));
  const groupById = new Map(set.groups.map((group) => [group.id, group]));
  const sortedTabs = [...set.tabs].sort((a, b) => a.index - b.index);
  const tabsByGroupId = new Map<number, TabSnapshot[]>();
  const tabByUid = new Map(sortedTabs.map((tab) => [tab.uid, tab]));

  for (const tab of sortedTabs) {
    if (tab.groupId === null) {
      continue;
    }
    const group = groupById.get(tab.groupId);
    if (!group) {
      continue;
    }
    const list = tabsByGroupId.get(group.id) ?? [];
    list.push(tab);
    tabsByGroupId.set(group.id, list);
  }

  const entries: LayoutEntry[] = [];
  for (const item of layout) {
    if (item.type === 'group') {
      const group = groupByUid.get(item.uid);
      if (!group) {
        continue;
      }
      entries.push({ type: 'group', group, tabs: tabsByGroupId.get(group.id) ?? [] });
      continue;
    }
    const tab = tabByUid.get(item.uid);
    if (!tab) {
      continue;
    }
    const group = tab.groupId !== null ? groupById.get(tab.groupId) : null;
    if (tab.groupId === null || !group) {
      entries.push({ type: 'tab', tab });
    }
  }
  return entries;
}

type BlockListProps = {
  entries: LayoutEntry[];
  setId: string;
  reorderEnabled: boolean;
  onRestoreGroup: (groupId: number) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function UngroupedTabBlock({
  tab,
  setId,
  reorderEnabled,
  rowActions,
}: {
  tab: TabSnapshot;
  setId: string;
  reorderEnabled: boolean;
  rowActions: TabRowActions;
}) {
  return (
    <ul className="manager__tab-list manager__tab-list--block">
      <TabRow tab={tab} setId={setId} reorderEnabled={reorderEnabled} rowActions={rowActions} />
    </ul>
  );
}

function BlockList({
  entries,
  setId,
  reorderEnabled,
  onRestoreGroup,
  onRenameGroup,
  onDeleteGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: BlockListProps) {
  return (
    <div className="manager__block-list">
      <DropZone
        id={`zone:block:${setId}:0`}
        dropItem={{ type: 'block-zone', setId, index: 0 }}
        activeDrop={activeDrop}
        dropGapPx={dropGapPx}
        baseGapPx={BLOCK_LIST_GAP_PX}
        reorderEnabled={reorderEnabled}
      />
      {entries.map((entry, index) => (
        <Fragment key={entry.type === 'group' ? entry.group.uid : entry.tab.uid}>
          {entry.type === 'group' ? (
            <GroupSection
              setId={setId}
              group={entry.group}
              tabs={entry.tabs}
              reorderEnabled={reorderEnabled}
              onRestoreGroup={onRestoreGroup}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
              rowActions={rowActions}
              activeDrop={activeDrop}
              dropGapPx={dropGapPx}
            />
          ) : (
            <UngroupedTabBlock
              tab={entry.tab}
              setId={setId}
              reorderEnabled={reorderEnabled}
              rowActions={rowActions}
            />
          )}
          <DropZone
            id={`zone:block:${setId}:${index + 1}`}
            dropItem={{ type: 'block-zone', setId, index: index + 1 }}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
            baseGapPx={BLOCK_LIST_GAP_PX}
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
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
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
  onRenameGroup,
  onDeleteGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: GroupSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(group.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasTabs = tabs.length > 0;
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
    disabled: !reorderEnabled || isEditing,
  });

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  const commitTitle = () => {
    const nextTitle = draftTitle.trim() || '新規グループ';
    setIsEditing(false);
    if (nextTitle !== group.title) {
      onRenameGroup(group.uid, nextTitle);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraftTitle(group.title);
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

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
            disabled={!reorderEnabled || isEditing}
            {...attributes}
            {...listeners}
          />
          {isEditing ? (
            <input
              ref={inputRef}
              className="manager__group-title-input"
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <h3 className="manager__group-title">
              <button
                className="manager__group-title-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setDraftTitle(group.title);
                  setIsEditing(true);
                }}
              >
                {group.title}
              </button>
            </h3>
          )}
        </div>
        <div className="manager__group-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => onRestoreGroup(group.id)}
            disabled={!hasTabs}
          >
            グループを復元
          </button>
          <button className="ghost-button" type="button" onClick={() => onDeleteGroup(group.uid)}>
            グループを削除
          </button>
        </div>
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
  shouldStartEditing: boolean;
  onStartEditingHandled: () => void;
  onRestoreSet: () => void;
  onDeleteSet: () => void;
  onRenameSet: (title: string) => void;
  onRestoreGroup: (groupId: number) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
  onCreateGroup: () => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function SetCard({
  set,
  fullSet,
  reorderEnabled,
  shouldStartEditing,
  onStartEditingHandled,
  onRestoreSet,
  onDeleteSet,
  onRenameSet,
  onRestoreGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateGroup,
  rowActions,
  activeDrop,
  dropGapPx,
}: SetCardProps) {
  const totalTabs = fullSet?.tabs.length ?? set.tabs.length;
  const visibleTabs = set.tabs.length;
  const tabSummary =
    totalTabs === visibleTabs
      ? `保存済みタブ: ${visibleTabs}件`
      : `表示中: ${visibleTabs} / ${totalTabs}件`;
  const dragLabel = set.name;
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(set.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleEditing = isEditing || shouldStartEditing;
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
    disabled: !reorderEnabled || titleEditing,
  });

  useEffect(() => {
    if (!shouldStartEditing) {
      return;
    }
    onStartEditingHandled();
  }, [onStartEditingHandled, shouldStartEditing]);

  useEffect(() => {
    if (!titleEditing) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [titleEditing]);

  const commitTitle = () => {
    const nextTitle = normalizeManualHistorySetName(draftTitle);
    setIsEditing(false);
    if (nextTitle !== set.name) {
      onRenameSet(nextTitle);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraftTitle(set.name);
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const layoutEntries = buildLayoutEntries(set);
  const shouldShowBlockList = reorderEnabled || layoutEntries.length > 0;

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
            aria-label="ウィンドウを並び替え"
            onClick={(event) => event.stopPropagation()}
            disabled={!reorderEnabled || titleEditing}
            {...attributes}
            {...listeners}
          />
          <div>
            <h2 className="manager__card-title">
              {titleEditing ? (
                <input
                  ref={inputRef}
                  className="manager__card-title-input"
                  type="text"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={handleTitleKeyDown}
                />
              ) : (
                <button
                  className="manager__card-title-button"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDraftTitle(set.name);
                    setIsEditing(true);
                  }}
                >
                  {set.name}
                </button>
              )}
            </h2>
            <p className="manager__card-meta">{tabSummary}</p>
          </div>
        </div>
        <div className="manager__card-actions">
          <button className="primary-button" type="button" onClick={onRestoreSet}>
            すべて復元
          </button>
          <button className="ghost-button" type="button" onClick={onDeleteSet}>
            ウィンドウを削除
          </button>
        </div>
      </div>

      {shouldShowBlockList ? (
        <>
          <div className="manager__group-controls">
            <span className="manager__group-label">グループ</span>
            <button className="ghost-button" type="button" onClick={onCreateGroup}>
              新規グループ
            </button>
          </div>
          <BlockList
            entries={layoutEntries}
            setId={set.id}
            reorderEnabled={reorderEnabled}
            onRestoreGroup={onRestoreGroup}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            rowActions={rowActions}
            activeDrop={activeDrop}
            dropGapPx={dropGapPx}
          />
        </>
      ) : null}
    </article>
  );
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

async function getCurrentManagerContext() {
  return new Promise<{ tabId: number; windowId: number }>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      const tab = tabs.find(
        (item) => typeof item.id === 'number' && typeof item.windowId === 'number',
      );
      if (!tab || tab.id === undefined || tab.windowId === undefined) {
        reject(new Error('現在の管理画面タブ情報を取得できませんでした。'));
        return;
      }
      resolve({ tabId: tab.id, windowId: tab.windowId });
    });
  });
}

async function createRestoreWindow() {
  return new Promise<{ windowId: number; initialTabId: number | null }>((resolve, reject) => {
    chrome.windows.create({ focused: true }, (window: chrome.windows.Window | undefined) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!window?.id) {
        reject(new Error('復元先ウィンドウを作成できませんでした。'));
        return;
      }
      chrome.tabs.query({ windowId: window.id }, (tabs: chrome.tabs.Tab[]) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        const initialTab = tabs.find((tab) => typeof tab.id === 'number') ?? null;
        resolve({ windowId: window.id!, initialTabId: initialTab?.id ?? null });
      });
    });
  });
}

async function removeTab(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
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
  const failedTabs: TabSnapshot[] = [];
  const shouldDiscard = shouldSuppressRestoreLoading({
    enabled: restoreLoadingSuppressionEnabled,
    tabCount: sortedTabs.length,
  });

  for (const tab of sortedTabs) {
    try {
      const created = await createTab(windowId, tab.url);
      createdTabs.push({ snapshot: tab, tab: created });
    } catch (err) {
      console.error('Failed to create tab', err);
      failedTabs.push(tab);
    }
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
    const restoredTabs = await Promise.all(
      createdTabs.map(async ({ snapshot, tab }) => {
        if (tab.id === undefined) {
          return snapshot;
        }
        const matched = await waitForTabUrl(tab.id, snapshot.url);
        if (!matched) {
          console.error('Failed to confirm tab url before discard', {
            tabId: tab.id,
            expectedUrl: snapshot.url,
          });
          return snapshot;
        }
        await discardTab(tab.id);
        return snapshot;
      }),
    );
    return { restoredTabs, failedTabs };
  }

  return { restoredTabs: createdTabs.map((item) => item.snapshot), failedTabs };
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
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
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

  const handleCreateWindow = async () => {
    setQuery('');
    setGroupFilter(GROUP_FILTER_ALL);
    const id = createHistoryId();
    const createdAt = Date.now();
    const created: HistorySet = {
      id,
      name: DEFAULT_NEW_WINDOW_NAME,
      createdAt,
      windowId: 0,
      managerBinding: null,
      tabs: [],
      groups: [],
      layout: [],
    };
    const updated = await updateState((current) => ({
      ...current,
      historySets: [created, ...current.historySets],
    }));
    await refreshState(updated.historySets);
    setEditingSetId(id);
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
        const filteredTabs = set.tabs.filter((tab) => tab.uid !== tabToDelete.uid);
        return {
          ...set,
          tabs: filteredTabs,
          groups: set.groups,
          layout: normalizeLayout(set.layout, set.groups, filteredTabs),
        };
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleRenameSet = async (setId: string, title: string) => {
    const nextTitle = normalizeManualHistorySetName(title);
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) =>
        set.id === setId ? { ...set, name: nextTitle } : set,
      ),
    }));
    await refreshState(updated.historySets);
  };

  const handleCreateGroup = async (setId: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        const nextId =
          set.groups.length === 0 ? 1 : Math.max(...set.groups.map((group) => group.id)) + 1;
        const newGroup: GroupSnapshot = {
          uid: createUid('group'),
          id: nextId,
          title: '新規グループ',
          color: 'grey',
          index: set.groups.length,
        };
        const nextLayout = [
          ...normalizeLayout(set.layout, set.groups, set.tabs),
          { type: 'group', uid: newGroup.uid } as const,
        ];
        return {
          ...set,
          groups: [...set.groups, newGroup],
          layout: nextLayout,
        };
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleRenameGroup = async (setId: string, groupUid: string, title: string) => {
    const nextTitle = title.trim() || '新規グループ';
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        return {
          ...set,
          groups: set.groups.map((group) =>
            group.uid === groupUid ? { ...group, title: nextTitle } : group,
          ),
        };
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleDeleteGroup = async (setId: string, groupUid: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) =>
        set.id === setId ? deleteGroupFromHistorySet(set, groupUid) : set,
      ),
    }));
    await refreshState(updated.historySets);
  };

  const handleRestoreSet = async (set: HistorySet) => {
    setActionMessage('タブを復元しています...');
    try {
      const targetSet = fullSets.find((item) => item.id === set.id) ?? set;
      const currentManager = await getCurrentManagerContext();
      const restoreTarget = resolveRestoreTarget(
        targetSet.managerBinding,
        currentManager.tabId,
        currentManager.windowId,
      );
      const restoreWindow = restoreTarget === 'new-window' ? await createRestoreWindow() : null;
      const windowId = restoreWindow?.windowId ?? currentManager.windowId;
      const { restoredTabs, failedTabs } = await restoreTabs(
        targetSet.tabs,
        targetSet.groups,
        windowId,
        restoreLoadingSuppressionEnabled,
      );
      const initialTabId = restoreWindow?.initialTabId ?? null;
      if (restoreWindow) {
        if (initialTabId !== null) {
          try {
            await removeTab(initialTabId);
          } catch (err) {
            console.error('Failed to remove initial tab in restore window', err);
          }
        }
      }
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets.flatMap((item) => {
            if (item.id !== targetSet.id) {
              return [item];
            }
            const cleaned = cleanupHistorySet(item, restoredTabs, { pruneEmptyGroups: true });
            return cleaned.tabs.length === 0 ? [] : [cleaned];
          }),
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
      if (tabs.length === 0) {
        setActionMessage('復元できるタブがありません。');
        return;
      }
      const { restoredTabs, failedTabs } = await restoreTabs(
        tabs,
        [group],
        windowId,
        restoreLoadingSuppressionEnabled,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets.map((item) =>
            item.id === targetSet.id ? cleanupHistorySet(item, restoredTabs) : item,
          ),
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
          historySets: current.historySets.map((item) => cleanupHistorySet(item, restoredTabs)),
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
        <p>ウィンドウ履歴を読み込んでいます...</p>
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
          <h1 className="manager__title">保存済みウィンドウ</h1>
          <p className="manager__subtitle">保存済みウィンドウを復元・検索・フィルタできます。</p>
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
          <button className="ghost-button" type="button" onClick={handleCreateWindow}>
            新規ウィンドウ
          </button>
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
                      shouldStartEditing={editingSetId === set.id}
                      onStartEditingHandled={() => {
                        if (editingSetId === set.id) {
                          setEditingSetId(null);
                        }
                      }}
                      onRestoreSet={() => handleRestoreSet(set)}
                      onDeleteSet={() => handleDeleteSet(set.id)}
                      onRenameSet={(title) => handleRenameSet(set.id, title)}
                      onRestoreGroup={(groupId) => handleRestoreGroup(set, groupId)}
                      onRenameGroup={(groupUid, title) =>
                        handleRenameGroup(set.id, groupUid, title)
                      }
                      onDeleteGroup={(groupUid) => handleDeleteGroup(set.id, groupUid)}
                      onCreateGroup={() => handleCreateGroup(set.id)}
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
