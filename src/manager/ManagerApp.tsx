import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
import { Button } from '../components/Button';
import { ToggleButton } from '../components/ToggleButton';
import {
  buildSetFilterOptions,
  buildGroupFilterOptions,
  filterHistorySets,
  SET_FILTER_ALL,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
} from '../tab-manager/filters';
import { normalizeLayout } from '../tab-manager/layout';
import { getState, STATE_KEY, updateState, clampCardHeight } from '../tab-manager/storage';
import type { GroupSnapshot, HistorySet, TabSnapshot, ThemeMode } from '../tab-manager/types';
import {
  applyThemeToDocument,
  getSystemPrefersDark,
  resolveTheme,
  subscribeSystemThemeChange,
} from '../theme/theme';
import { createUid } from '../tab-manager/uid';
import { deleteGroupFromHistorySet } from './groupState';
import { createGroupAtTop } from './groupCreate';
import { shouldIgnoreEnterForIme } from './ime';
import { deleteTabFromHistorySet } from './tabState';
import { resolveGroupTitleForCommit, resolveSetTitleForCommit } from './titleCommit';
import {
  applySetLock,
  isGroupEffectivelyLocked,
  isTabEffectivelyLocked,
  toggleGroupLockWithPropagation,
  toggleTabLockWithPropagation,
} from './lockState';
import { cleanupHistorySet } from './restoreCleanup';
import { shouldSuppressRestoreLoading } from './restorePolicy';
import { resolveRestoreTarget } from './restoreTarget';
import { removeSetsEmptiedSince } from './setCleanup';
import { matchesExpectedUrl } from './urlMatch';
import {
  getBindingStatusLabel,
  resolveBindingStatus,
  type BindingStatus,
  type ManagerContext,
} from './bindingState';
import { createTabRowActions } from './tabRowActions';
import { buildFaviconCandidates } from './favicon';
import {
  mergeRefreshedTabMetadata,
  shouldRefreshTabMetadata,
  type RefreshedTabMetadata,
} from './metadataRefresh';
import type { DragItem, DropTarget } from './dragReorder';
import { applyDragReorder } from './dragReorder';
import { computeDropGapPx, DEFAULT_DROP_GAP_PX } from './dropGap';
import { selectDragItemHeight } from './dragHeight';
import { resolveScrollFadeState } from './scrollFade';
import { useCardResize } from './useCardResize';
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

const SET_LIST_GAP_PX = 4;
const BLOCK_LIST_GAP_PX = 4;
const TAB_LIST_GAP_PX = 6;
const METADATA_REFRESH_PER_TAB_TIMEOUT_MS = 1200;
const METADATA_REFRESH_TOTAL_TIMEOUT_MS = 20_000;

function getDistanceToRectSquared(
  pointer: { x: number; y: number },
  rect: { left: number; right: number; top: number; bottom: number },
) {
  const dx =
    pointer.x < rect.left
      ? rect.left - pointer.x
      : pointer.x > rect.right
        ? pointer.x - rect.right
        : 0;
  const dy =
    pointer.y < rect.top
      ? rect.top - pointer.y
      : pointer.y > rect.bottom
        ? pointer.y - rect.bottom
        : 0;
  return dx * dx + dy * dy;
}

const collisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const dragItem = resolveDragItem(args.active.data.current, activeId);
  const isSetDrag = dragItem?.type === 'set';
  const droppableContainers = dragItem
    ? args.droppableContainers.filter((container) => {
        const dropData = container.data.current;
        return isDropItemPayload(dropData) && isDropItemCompatible(dragItem, dropData.dropItem);
      })
    : args.droppableContainers;

  if (droppableContainers.length === 0) {
    return [];
  }

  if (isSetDrag && args.pointerCoordinates) {
    const pointer = args.pointerCoordinates;
    let nearestContainer: (typeof droppableContainers)[number] | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const container of droppableContainers) {
      const rect = container.rect.current;
      const distance =
        rect === null
          ? Number.POSITIVE_INFINITY
          : getDistanceToRectSquared(pointer, {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            });
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestContainer = container;
      }
    }

    if (nearestContainer && Number.isFinite(nearestDistance)) {
      return [
        {
          id: nearestContainer.id,
          data: {
            droppableContainer: nearestContainer,
            value: nearestDistance,
          },
        },
      ];
    }
  }

  const pointerCollisions = pointerWithin({
    ...args,
    droppableContainers,
  });
  if (pointerCollisions.length > 0) {
    const pointer = args.pointerCoordinates;
    const selectDistance = (collision: (typeof pointerCollisions)[number]) => {
      if (!pointer) {
        return Number.POSITIVE_INFINITY;
      }
      const rect = collision.data?.droppableContainer?.rect.current;
      if (!rect) {
        return Number.POSITIVE_INFINITY;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = centerX - pointer.x;
      const dy = centerY - pointer.y;
      return dx * dx + dy * dy;
    };
    let nearestCollision = pointerCollisions[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const collision of pointerCollisions) {
      const distance = selectDistance(collision);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCollision = collision;
      }
    }
    return [nearestCollision];
  }
  const centerCollisions = closestCenter({
    ...args,
    droppableContainers,
  });
  return centerCollisions;
};

type DropZoneProps = {
  id: string;
  dropItem: DropItemData;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
  baseGapPx: number;
  axis?: 'vertical' | 'horizontal';
  placement?: 'left' | 'right';
  reorderEnabled: boolean;
};

function DropZone({
  id,
  dropItem,
  activeDrop,
  dropGapPx,
  baseGapPx,
  axis = 'vertical',
  placement,
  reorderEnabled,
}: DropZoneProps) {
  const { setNodeRef } = useDroppable({
    id,
    data: { dropItem },
    disabled: !reorderEnabled,
  });
  const isActive = activeDrop?.overId === id;
  const style =
    axis === 'horizontal'
      ? {
          width: 0,
          height: '100%',
        }
      : { height: isActive ? dropGapPx : baseGapPx };
  return (
    <div
      ref={setNodeRef}
      className={`manager__drop-zone manager__drop-zone--${axis}${
        axis === 'horizontal' && placement ? ` manager__drop-zone--${placement}` : ''
      }${isActive ? ' manager__drop-zone--active' : ''}`}
      style={style}
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

function TabFavicon({ tab }: { tab: Pick<TabSnapshot, 'favIconUrl' | 'url'> }) {
  const candidates = buildFaviconCandidates(tab);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const src = candidates[candidateIndex];
  if (!src) {
    return (
      <span className="manager__tab-favicon manager__tab-favicon--placeholder" aria-hidden="true">
        ●
      </span>
    );
  }

  return (
    <img
      className="manager__tab-favicon"
      src={src}
      alt=""
      draggable={false}
      onError={() => setCandidateIndex((index) => Math.min(index + 1, candidates.length))}
    />
  );
}

function OverlayTabRow({ tab }: { tab: TabSnapshot }) {
  return (
    <div className="manager__tab manager__tab--overlay">
      <OverlayHandle compact />
      <TabFavicon key={`${tab.uid}:${tab.favIconUrl ?? ''}:${tab.url}`} tab={tab} />
      <div className="manager__tab-main">
        <p className="manager__tab-title">{tab.title}</p>
        <p className="manager__tab-url">{tab.url}</p>
      </div>
      <div className="manager__tab-actions">
        <Button variant="ghost" disabled>
          削除
        </Button>
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
        <Button variant="ghost" disabled>
          グループを復元
        </Button>
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
          <Button variant="primary" disabled>
            すべて復元
          </Button>
          <Button variant="ghost" disabled>
            ウィンドウを削除
          </Button>
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

function parseSetDragItemFromActiveId(activeId: string): DragItem | null {
  if (!activeId.startsWith('set:')) {
    return null;
  }
  const setId = activeId.slice(4);
  if (!setId) {
    return null;
  }
  return { type: 'set', setId };
}

function resolveDragItem(value: unknown, activeId: string): DragItem | null {
  if (isDragData(value)) {
    return value.dragItem;
  }
  return parseSetDragItemFromActiveId(activeId);
}

function resolveDragData(
  value: unknown,
  activeId: string,
  fallback: DragData | null,
): DragData | null {
  if (isDragData(value)) {
    return value;
  }
  const parsed = parseSetDragItemFromActiveId(activeId);
  if (parsed) {
    return {
      dragItem: parsed,
      dragLabel: fallback?.dragLabel ?? '',
    };
  }
  return fallback;
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

function isDropItemCompatible(dragItem: DragItem, dropItem: DropItemData) {
  if (dragItem.type === 'set') {
    return dropItem.type === 'set-zone';
  }
  if (dragItem.type === 'group') {
    return dropItem.type === 'block-zone';
  }
  if (dragItem.type === 'tab') {
    return dropItem.type === 'block-zone' || dropItem.type === 'tab-zone';
  }
  return false;
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

function getDragSourceWidth(event: Event | null) {
  if (!event) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const source = target.closest('.manager__set-grid-item');
  if (!source) {
    return null;
  }
  const width = source.getBoundingClientRect().width;
  return width > 0 ? width : null;
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
  locked: boolean;
  onToggleLock: (tab: TabSnapshot) => void;
};

function TabRow({ tab, setId, reorderEnabled, rowActions, locked, onToggleLock }: TabRowProps) {
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
      <TabFavicon key={`${tab.uid}:${tab.favIconUrl ?? ''}:${tab.url}`} tab={tab} />
      <div className="manager__tab-main">
        <p className="manager__tab-title">
          <span className="manager__title-with-lock">
            <span className="manager__title-text">{tab.title}</span>
            {locked ? (
              <span className="manager__lock-indicator" aria-hidden="true">
                🔒
              </span>
            ) : null}
          </span>
        </p>
        <p className="manager__tab-url">{tab.url}</p>
      </div>
      <div className="manager__tab-actions">
        <ToggleButton
          pressed={locked}
          onLabel="ロック解除"
          offLabel="ロック"
          ariaLabelOn="ロック解除"
          ariaLabelOff="ロック"
          onToggle={(event) => {
            event.stopPropagation();
            onToggleLock(tab);
          }}
        />
        <Button variant="ghost" onClick={rowActions.handleRemoveClick(tab)} disabled={locked}>
          削除
        </Button>
      </div>
    </li>
  );
}

type TabListProps = {
  tabs: TabSnapshot[];
  setId: string;
  groupUid: string;
  set: HistorySet;
  reorderEnabled: boolean;
  rowActions: TabRowActions;
  onToggleTabLock: (tab: TabSnapshot) => void;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function TabList({
  tabs,
  setId,
  groupUid,
  set,
  reorderEnabled,
  rowActions,
  onToggleTabLock,
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
          <TabRow
            tab={tab}
            setId={setId}
            reorderEnabled={reorderEnabled}
            rowActions={rowActions}
            locked={isTabEffectivelyLocked(set, tab)}
            onToggleLock={onToggleTabLock}
          />
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
  set: HistorySet;
  setId: string;
  reorderEnabled: boolean;
  onRestoreGroup: (groupId: number) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
  onToggleGroupLock: (groupUid: string) => void;
  onToggleTabLock: (tab: TabSnapshot) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function UngroupedTabBlock({
  tab,
  set,
  setId,
  reorderEnabled,
  rowActions,
  onToggleTabLock,
}: {
  tab: TabSnapshot;
  set: HistorySet;
  setId: string;
  reorderEnabled: boolean;
  rowActions: TabRowActions;
  onToggleTabLock: (tab: TabSnapshot) => void;
}) {
  return (
    <ul className="manager__tab-list manager__tab-list--block">
      <TabRow
        tab={tab}
        setId={setId}
        reorderEnabled={reorderEnabled}
        rowActions={rowActions}
        locked={isTabEffectivelyLocked(set, tab)}
        onToggleLock={onToggleTabLock}
      />
    </ul>
  );
}

function BlockList({
  entries,
  set,
  setId,
  reorderEnabled,
  onRestoreGroup,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupLock,
  onToggleTabLock,
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
              set={set}
              setId={setId}
              group={entry.group}
              tabs={entry.tabs}
              reorderEnabled={reorderEnabled}
              onRestoreGroup={onRestoreGroup}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
              onToggleGroupLock={onToggleGroupLock}
              onToggleTabLock={onToggleTabLock}
              rowActions={rowActions}
              activeDrop={activeDrop}
              dropGapPx={dropGapPx}
            />
          ) : (
            <UngroupedTabBlock
              tab={entry.tab}
              set={set}
              setId={setId}
              reorderEnabled={reorderEnabled}
              rowActions={rowActions}
              onToggleTabLock={onToggleTabLock}
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
  set: HistorySet;
  setId: string;
  group: GroupSnapshot;
  tabs: TabSnapshot[];
  reorderEnabled: boolean;
  onRestoreGroup: (groupId: number) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
  onToggleGroupLock: (groupUid: string) => void;
  onToggleTabLock: (tab: TabSnapshot) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
};

function GroupSection({
  set,
  setId,
  group,
  tabs,
  reorderEnabled,
  onRestoreGroup,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupLock,
  onToggleTabLock,
  rowActions,
  activeDrop,
  dropGapPx,
}: GroupSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(group.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasTabs = tabs.length > 0;
  const groupLocked = isGroupEffectivelyLocked(set, group.uid);
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
    const nextTitle = resolveGroupTitleForCommit(draftTitle, group.title);
    setIsEditing(false);
    if (nextTitle === group.title) {
      setDraftTitle(group.title);
      return;
    }
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
      if (shouldIgnoreEnterForIme(event)) {
        return;
      }
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
                <span className="manager__title-with-lock">
                  <span className="manager__title-text">{group.title}</span>
                  {groupLocked ? (
                    <span className="manager__lock-indicator" aria-hidden="true">
                      🔒
                    </span>
                  ) : null}
                </span>
              </button>
            </h3>
          )}
        </div>
        <div className="manager__group-actions">
          <ToggleButton
            pressed={groupLocked}
            onLabel="ロック解除"
            offLabel="ロック"
            ariaLabelOn="ロック解除"
            ariaLabelOff="ロック"
            onToggle={() => onToggleGroupLock(group.uid)}
          />
          <Button variant="ghost" onClick={() => onRestoreGroup(group.id)} disabled={!hasTabs}>
            グループを復元
          </Button>
          <Button variant="ghost" onClick={() => onDeleteGroup(group.uid)} disabled={groupLocked}>
            グループを削除
          </Button>
        </div>
      </div>
      <TabList
        tabs={tabs}
        setId={setId}
        groupUid={group.uid}
        set={set}
        reorderEnabled={reorderEnabled}
        rowActions={rowActions}
        onToggleTabLock={onToggleTabLock}
        activeDrop={activeDrop}
        dropGapPx={dropGapPx}
      />
    </section>
  );
}

type SetCardProps = {
  set: HistorySet;
  fullSet?: HistorySet;
  bindingStatus: BindingStatus;
  bindingToggleDisabled: boolean;
  reorderEnabled: boolean;
  shouldStartEditing: boolean;
  onStartEditingHandled: () => void;
  onRestoreSet: () => void;
  onRefreshMetadata: () => void;
  refreshingMetadata: boolean;
  onDeleteSet: () => void;
  onToggleSetLock: () => void;
  onToggleBinding: () => void;
  onRenameSet: (title: string) => void;
  onRestoreGroup: (groupId: number) => void;
  onRenameGroup: (groupUid: string, title: string) => void;
  onDeleteGroup: (groupUid: string) => void;
  onToggleGroupLock: (groupUid: string) => void;
  onCreateGroup: () => void;
  onToggleTabLock: (tab: TabSnapshot) => void;
  rowActions: TabRowActions;
  activeDrop: ActiveDrop | null;
  dropGapPx: number;
  cardHeight: number | null;
  onResizeStart: (event: React.MouseEvent) => void;
};

function SetCard({
  set,
  fullSet,
  bindingStatus,
  bindingToggleDisabled,
  reorderEnabled,
  shouldStartEditing,
  onStartEditingHandled,
  onRestoreSet,
  onRefreshMetadata,
  refreshingMetadata,
  onDeleteSet,
  onToggleSetLock,
  onToggleBinding,
  onRenameSet,
  onRestoreGroup,
  onRenameGroup,
  onDeleteGroup,
  onToggleGroupLock,
  onCreateGroup,
  onToggleTabLock,
  rowActions,
  activeDrop,
  dropGapPx,
  cardHeight,
  onResizeStart,
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
  const cardBodyRef = useRef<HTMLDivElement | null>(null);
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
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
    const nextTitle = resolveSetTitleForCommit(draftTitle, set.name);
    setIsEditing(false);
    if (nextTitle === set.name) {
      setDraftTitle(set.name);
      return;
    }
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
      if (shouldIgnoreEnterForIme(event)) {
        return;
      }
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
  const bindingStatusLabel = getBindingStatusLabel(bindingStatus);
  const showBindingIcon = bindingStatus === 'bound-current';
  const isBoundCurrent = bindingStatus === 'bound-current';
  const hasRefreshableTabs = (fullSet?.tabs ?? set.tabs).some((tab) =>
    shouldRefreshTabMetadata(tab),
  );

  const updateScrollFade = useCallback(() => {
    const container = cardBodyRef.current;
    if (!container) {
      setShowTopScrollFade(false);
      setShowBottomScrollFade(false);
      return;
    }

    const next = resolveScrollFadeState({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });
    setShowTopScrollFade((current) => (current === next.showTopFade ? current : next.showTopFade));
    setShowBottomScrollFade((current) =>
      current === next.showBottomFade ? current : next.showBottomFade,
    );
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      updateScrollFade();
    });
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    const handleResize = () => {
      updateScrollFade();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateScrollFade]);

  return (
    <article
      ref={setDragRef}
      className={`manager__card${isDragging ? ' manager__card--dragging' : ''}`}
      style={cardHeight !== null ? { height: `${cardHeight}px` } : undefined}
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
          <div className="manager__card-header-text">
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
                  <span className="manager__title-with-lock">
                    <span className="manager__title-text">{set.name}</span>
                    {set.locked ? (
                      <span className="manager__lock-indicator" aria-hidden="true">
                        🔒
                      </span>
                    ) : null}
                  </span>
                </button>
              )}
            </h2>
            <div className="manager__card-subline">
              <p className="manager__card-meta">{tabSummary}</p>
              {showBindingIcon ? (
                <span
                  className="manager__binding-status"
                  title={bindingStatusLabel}
                  role="img"
                  aria-label={bindingStatusLabel}
                >
                  🔗
                </span>
              ) : null}
            </div>
            <div className="manager__card-actions">
              <ToggleButton
                pressed={set.locked}
                onLabel="ロック解除"
                offLabel="ロック"
                ariaLabelOn="ロック解除"
                ariaLabelOff="ロック"
                onToggle={onToggleSetLock}
              />
              <ToggleButton
                pressed={isBoundCurrent}
                onLabel="リンク解除"
                offLabel="管理画面リンク"
                ariaLabelOn="リンク解除"
                ariaLabelOff="管理画面リンク"
                onToggle={onToggleBinding}
                disabled={bindingToggleDisabled}
              />
              <Button variant="primary" onClick={onRestoreSet}>
                すべて復元
              </Button>
              {hasRefreshableTabs || refreshingMetadata ? (
                <Button variant="ghost" onClick={onRefreshMetadata} disabled={refreshingMetadata}>
                  {refreshingMetadata ? '再取得中...' : '情報再取得'}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={onDeleteSet} disabled={set.locked}>
                ウィンドウを削除
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`manager__card-body-shell${showTopScrollFade ? ' manager__card-body-shell--fade-top' : ''}${
          showBottomScrollFade ? ' manager__card-body-shell--fade-bottom' : ''
        }`}
      >
        <div ref={cardBodyRef} className="manager__card-body" onScroll={updateScrollFade}>
          {shouldShowBlockList ? (
            <>
              <div className="manager__group-controls">
                <span className="manager__group-label">グループ</span>
                <Button variant="ghost" onClick={onCreateGroup}>
                  新規グループ
                </Button>
              </div>
              <BlockList
                entries={layoutEntries}
                set={set}
                setId={set.id}
                reorderEnabled={reorderEnabled}
                onRestoreGroup={onRestoreGroup}
                onRenameGroup={onRenameGroup}
                onDeleteGroup={onDeleteGroup}
                onToggleGroupLock={onToggleGroupLock}
                onToggleTabLock={onToggleTabLock}
                rowActions={rowActions}
                activeDrop={activeDrop}
                dropGapPx={dropGapPx}
              />
            </>
          ) : null}
        </div>
      </div>
      <div
        className="manager__resize-handle"
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="カードの高さを調整"
      />
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

async function createMetadataRefreshWindow() {
  return new Promise<{ windowId: number; tabId: number }>((resolve, reject) => {
    chrome.windows.create({ focused: false }, (window: chrome.windows.Window | undefined) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (typeof window?.id !== 'number') {
        reject(new Error('メタ情報再取得用のウィンドウを作成できませんでした。'));
        return;
      }
      const windowId = window.id;
      chrome.tabs.query({ windowId }, (tabs: chrome.tabs.Tab[]) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        const tab = tabs.find((item) => typeof item.id === 'number');
        if (typeof tab?.id !== 'number') {
          reject(new Error('メタ情報再取得用のタブを取得できませんでした。'));
          return;
        }
        resolve({ windowId, tabId: tab.id });
      });
    });
  });
}

async function getWindowTabCount(windowId: number) {
  return new Promise<number>((resolve, reject) => {
    chrome.tabs.query({ windowId }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs.length);
    });
  });
}

async function removeWindow(windowId: number) {
  return new Promise<void>((resolve) => {
    chrome.windows.remove(windowId, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to remove temporary window (non-blocking)', chrome.runtime.lastError);
      }
      resolve();
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

async function updateTabUrl(tabId: number, url: string) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.update(tabId, { url, active: false }, (tab?: chrome.tabs.Tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!tab) {
        reject(new Error('更新後のタブ情報を取得できませんでした。'));
        return;
      }
      resolve(tab);
    });
  });
}

function resolveRefreshedTabMetadata(tab: chrome.tabs.Tab): RefreshedTabMetadata {
  const title = typeof tab.title === 'string' ? tab.title.trim() : '';
  const favIconUrl = typeof tab.favIconUrl === 'string' ? tab.favIconUrl.trim() : '';
  return {
    ...(title ? { title } : {}),
    ...(favIconUrl ? { favIconUrl } : {}),
  };
}

async function waitForTabMetadata(
  tabId: number,
  expectedUrl: string,
  timeoutMs = METADATA_REFRESH_PER_TAB_TIMEOUT_MS,
) {
  return new Promise<{ metadata: RefreshedTabMetadata; timedOut: boolean }>((resolve) => {
    let settled = false;
    let metadata: RefreshedTabMetadata = {};
    const mergeMetadata = (tab: chrome.tabs.Tab) => {
      metadata = {
        ...metadata,
        ...resolveRefreshedTabMetadata(tab),
      };
    };

    const finish = (timedOut: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve({ metadata, timedOut });
    };

    const handleUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (!matchesExpectedUrl(expectedUrl, tab, changeInfo)) {
        return;
      }
      mergeMetadata(tab);
      if (changeInfo.status === 'complete') {
        finish(false);
      }
    };

    const timeoutId = setTimeout(() => {
      console.debug('Metadata wait timeout reached', { tabId, expectedUrl, timeoutMs });
      finish(true);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        return;
      }
      if (!matchesExpectedUrl(expectedUrl, tab)) {
        return;
      }
      mergeMetadata(tab);
      if (tab.status === 'complete') {
        finish(false);
      }
    });
  });
}

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
  baseTabIndex: number,
) {
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const shouldDiscard = shouldSuppressRestoreLoading({
    enabled: restoreLoadingSuppressionEnabled,
    tabCount: sortedTabs.length,
  });
  const creationResults = await Promise.allSettled(
    sortedTabs.map((tab) => createTab(windowId, tab.url, baseTabIndex + tab.index)),
  );
  const createdTabs: Array<{ snapshot: TabSnapshot; tab: chrome.tabs.Tab }> = [];
  const failedTabs: TabSnapshot[] = [];
  creationResults.forEach((result, index) => {
    const snapshot = sortedTabs[index];
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
      await moveTabGroup(newGroupId, baseTabIndex + group.index);
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
    themeMode?: ThemeMode;
    cardHeight?: number | null;
  }>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState(SET_FILTER_ALL);
  const [groupFilter, setGroupFilter] = useState(GROUP_FILTER_ALL);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [currentManagerContext, setCurrentManagerContext] = useState<ManagerContext | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [activeDrop, setActiveDrop] = useState<ActiveDrop | null>(null);
  const [dropGapPx, setDropGapPx] = useState(DEFAULT_DROP_GAP_PX);
  const [setDropWidthPx, setSetDropWidthPx] = useState(0);
  const [dragSpacerPx, setDragSpacerPx] = useState(0);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [refreshingSetIds, setRefreshingSetIds] = useState<string[]>([]);
  const dragLatestScrollYRef = useRef<number | null>(null);
  const bodyScrollLockRef = useRef<BodyScrollLockState | null>(null);

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
          themeMode: stored.themeMode,
          cardHeight: stored.cardHeight,
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

  const handleCardHeightChange = useCallback((height: number) => {
    const clamped = clampCardHeight(height);
    setState((current) => ({ ...current, cardHeight: clamped }));
    void updateState((current) => ({ ...current, cardHeight: clamped }));
  }, []);

  const { resizingHeight, handleResizeStart } = useCardResize({
    onHeightChange: handleCardHeightChange,
  });

  const effectiveCardHeight = resizingHeight ?? state.cardHeight ?? null;

  const themeMode = state.themeMode ?? 'system';
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (themeMode === 'system') {
      applyThemeToDocument(resolveTheme(themeMode, getSystemPrefersDark()));
      unsubscribe = subscribeSystemThemeChange((prefersDark) => {
        applyThemeToDocument(resolveTheme('system', prefersDark));
      });
    } else {
      applyThemeToDocument(resolveTheme(themeMode, false));
    }
    return () => {
      unsubscribe?.();
    };
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadManagerContext() {
      try {
        const context = await getCurrentManagerContext();
        if (!cancelled) {
          setCurrentManagerContext(context);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to get current manager context', err);
          setCurrentManagerContext(null);
          setActionMessage('現在の管理画面情報を取得できませんでした。');
        }
      }
    }
    void loadManagerContext();
    return () => {
      cancelled = true;
    };
  }, []);

  const fullSets = useMemo(
    () => (state.status === 'ready' && state.data ? state.data : []),
    [state],
  );
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

  const setOptions = useMemo(() => {
    if (state.status !== 'ready' || !state.data) {
      return [{ value: SET_FILTER_ALL, label: 'すべてのウィンドウ' }];
    }
    return buildSetFilterOptions(state.data);
  }, [state]);

  const groupOptions = useMemo(() => {
    if (state.status !== 'ready' || !state.data) {
      return [GROUP_FILTER_ALL, GROUP_FILTER_UNGROUPED];
    }
    return buildGroupFilterOptions(state.data, setFilter);
  }, [setFilter, state]);

  const activeGroupFilter = groupOptions.includes(groupFilter) ? groupFilter : GROUP_FILTER_ALL;
  const reorderEnabled =
    query.trim() === '' && setFilter === SET_FILTER_ALL && activeGroupFilter === GROUP_FILTER_ALL;
  const filteredSets = useMemo(() => {
    if (state.status !== 'ready' || !state.data) {
      return [];
    }
    return filterHistorySets(state.data, {
      query,
      setFilter,
      groupFilter: activeGroupFilter,
    });
  }, [activeGroupFilter, query, setFilter, state]);
  const visibleSets = reorderEnabled ? fullSets : filteredSets;
  const activeSetDragId = activeDrag?.dragItem.type === 'set' ? activeDrag.dragItem.setId : null;
  const activeSetDragIndex =
    activeSetDragId === null ? -1 : visibleSets.findIndex((set) => set.id === activeSetDragId);
  const renderSets =
    activeSetDragIndex >= 0 ? visibleSets.filter((set) => set.id !== activeSetDragId) : visibleSets;
  const activeSetDropRenderIndex = useMemo(() => {
    if (activeDrag?.dragItem.type !== 'set') {
      return null;
    }
    if (!activeDrop || activeDrop.dropItem.type !== 'set-zone') {
      return null;
    }
    if (activeSetDragIndex === -1) {
      return null;
    }
    const dropIndex = activeDrop.dropItem.index;
    return dropIndex <= activeSetDragIndex ? dropIndex : dropIndex - 1;
  }, [activeDrag, activeDrop, activeSetDragIndex]);
  const resolveSetDropIndex = (index: number) => {
    if (activeSetDragIndex === -1) {
      return index;
    }
    return index <= activeSetDragIndex ? index : index + 1;
  };

  const refreshState = async (nextSets: HistorySet[]) => {
    setState((current) => ({
      status: 'ready',
      data: nextSets,
      restoreLoadingSuppressionEnabled: current.restoreLoadingSuppressionEnabled ?? true,
      removeRestoredTabsEnabled: current.removeRestoredTabsEnabled ?? true,
      themeMode: current.themeMode ?? 'system',
      cardHeight: current.cardHeight ?? null,
    }));
  };

  const refreshCurrentManagerContext = async () => {
    try {
      const context = await getCurrentManagerContext();
      setCurrentManagerContext(context);
      return context;
    } catch (err) {
      console.error('Failed to refresh manager context', err);
      setCurrentManagerContext(null);
      setActionMessage('現在の管理画面情報を取得できませんでした。');
      return null;
    }
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
    const activeId = String(event.active.id);
    const rawData = event.active.data.current;
    const data = resolveDragData(rawData, activeId, activeDrag);
    if (!data) {
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setDragSpacerPx(0);
      setSetDropWidthPx(0);
      unlockBodyScroll();
      return;
    }
    const rect = event.active.rect.current;
    const height = selectDragItemHeight({
      eventTargetHeight: getDragSourceHeight(event.activatorEvent),
      rectInitialHeight: rect?.initial?.height ?? null,
      rectTranslatedHeight: rect?.translated?.height ?? null,
    });
    const width = getDragSourceWidth(event.activatorEvent) ?? rect?.initial?.width ?? null;
    setDropGapPx(computeDropGapPx(height));
    setSetDropWidthPx(data.dragItem.type === 'set' && width !== null ? width : 0);
    setDragSpacerPx(height ?? 0);
    setActiveDrag(data);
    setActiveDrop(null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!reorderEnabled) {
      return;
    }
    dragLatestScrollYRef.current = window.scrollY;
    const activeId = String(event.active.id);
    const data = event.active.data.current;
    const dragData = resolveDragData(data, activeId, activeDrag);
    if (!dragData) {
      setActiveDrop(null);
      return;
    }
    const over = event.over;
    const dropData = over?.data.current;
    if (!over || !isDropItemPayload(dropData)) {
      setActiveDrop(null);
      return;
    }
    if (!isDropItemCompatible(dragData.dragItem, dropData.dropItem)) {
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
    setSetDropWidthPx(0);
    setDragSpacerPx(0);
    unlockBodyScroll();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!reorderEnabled) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setSetDropWidthPx(0);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }
    const data = resolveDragData(event.active.data.current, String(event.active.id), activeDrag);
    const dropTarget = activeDrop?.dropTarget ?? null;
    if (!data || !dropTarget) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setSetDropWidthPx(0);
      setDragSpacerPx(0);
      unlockBodyScroll();
      return;
    }

    const reorderedSets = applyDragReorder(fullSets, data.dragItem, dropTarget);
    const nextSets =
      data.dragItem.type === 'set'
        ? reorderedSets
        : removeSetsEmptiedSince(fullSets, reorderedSets);
    if (nextSets === fullSets) {
      setActiveDrag(null);
      setActiveDrop(null);
      dragLatestScrollYRef.current = null;
      setDropGapPx(DEFAULT_DROP_GAP_PX);
      setSetDropWidthPx(0);
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
    setSetDropWidthPx(0);
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
    setSetFilter(SET_FILTER_ALL);
    setGroupFilter(GROUP_FILTER_ALL);
    const id = createHistoryId();
    const createdAt = Date.now();
    const created: HistorySet = {
      id,
      name: DEFAULT_NEW_WINDOW_NAME,
      createdAt,
      windowId: 0,
      locked: false,
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
    const targetSet = fullSets.find((set) => set.id === setId);
    if (targetSet?.locked) {
      setActionMessage('ロック中のウィンドウは削除できません。');
      return;
    }
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.filter((set) => set.id !== setId),
    }));
    await refreshState(updated.historySets);
  };

  const handleToggleSetLock = async (setId: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        return applySetLock(set, !set.locked);
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleToggleManagerBinding = async (setId: string) => {
    const context = await refreshCurrentManagerContext();
    if (!context) {
      return;
    }
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        const status = resolveBindingStatus(set.managerBinding, context);
        if (status === 'bound-current') {
          return {
            ...set,
            managerBinding: null,
          };
        }
        return {
          ...set,
          managerBinding: {
            managerTabId: context.tabId,
            managerWindowId: context.windowId,
          },
        };
      }),
    }));
    await refreshState(updated.historySets);
    const target = updated.historySets.find((set) => set.id === setId);
    if (!target) {
      return;
    }
    const nextStatus = resolveBindingStatus(target.managerBinding, context);
    setActionMessage(
      nextStatus === 'bound-current'
        ? 'この管理画面にリンクしました。'
        : nextStatus === 'unbound'
          ? 'リンクを解除しました。'
          : null,
    );
  };

  const handleDeleteTab = async (setId: string, tabToDelete: TabSnapshot) => {
    const targetSet = fullSets.find((set) => set.id === setId);
    const targetTab = targetSet?.tabs.find((tab) => tab.uid === tabToDelete.uid) ?? tabToDelete;
    if (targetSet && isTabEffectivelyLocked(targetSet, targetTab)) {
      setActionMessage('ロック中のタブは削除できません。');
      return;
    }
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        return deleteTabFromHistorySet(set, tabToDelete.uid);
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleToggleTabLock = async (setId: string, tabUid: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        return toggleTabLockWithPropagation(set, tabUid);
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
        return createGroupAtTop(set, createUid('group'));
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
    const targetSet = fullSets.find((set) => set.id === setId);
    if (targetSet && isGroupEffectivelyLocked(targetSet, groupUid)) {
      setActionMessage('ロック中のグループは削除できません。');
      return;
    }
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) =>
        set.id === setId ? deleteGroupFromHistorySet(set, groupUid) : set,
      ),
    }));
    await refreshState(updated.historySets);
  };

  const handleToggleGroupLock = async (setId: string, groupUid: string) => {
    const updated = await updateState((current) => ({
      ...current,
      historySets: current.historySets.map((set) => {
        if (set.id !== setId) {
          return set;
        }
        return toggleGroupLockWithPropagation(set, groupUid);
      }),
    }));
    await refreshState(updated.historySets);
  };

  const handleRefreshMetadata = async (setId: string) => {
    if (refreshingSetIds.includes(setId)) {
      return;
    }
    const targetSet = fullSets.find((set) => set.id === setId);
    if (!targetSet) {
      return;
    }
    const targetTabs = targetSet.tabs.filter((tab) => shouldRefreshTabMetadata(tab));
    if (targetTabs.length === 0) {
      setActionMessage('再取得対象のタブはありません。');
      return;
    }

    setRefreshingSetIds((current) => (current.includes(setId) ? current : [...current, setId]));
    setActionMessage(`タブ情報を再取得しています... (${targetTabs.length}件)`);

    let metadataWindowId: number | null = null;
    const refreshedByUid = new Map<string, RefreshedTabMetadata>();
    try {
      const metadataWindow = await createMetadataRefreshWindow();
      metadataWindowId = metadataWindow.windowId;
      const startAt = Date.now();

      for (const tab of targetTabs) {
        if (Date.now() - startAt >= METADATA_REFRESH_TOTAL_TIMEOUT_MS) {
          break;
        }
        try {
          await updateTabUrl(metadataWindow.tabId, tab.url);
          const { metadata } = await waitForTabMetadata(
            metadataWindow.tabId,
            tab.url,
            METADATA_REFRESH_PER_TAB_TIMEOUT_MS,
          );
          if (metadata.title || metadata.favIconUrl) {
            refreshedByUid.set(tab.uid, metadata);
          }
        } catch (err) {
          console.warn('Failed to refresh tab metadata (non-blocking)', {
            setId,
            tabUid: tab.uid,
            error: err,
          });
        }
      }

      const preview = mergeRefreshedTabMetadata(targetSet, refreshedByUid);
      if (preview.updatedCount > 0) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets.map((set) =>
            set.id === setId ? mergeRefreshedTabMetadata(set, refreshedByUid).set : set,
          ),
        }));
        await refreshState(updated.historySets);
      }

      const failedCount = targetTabs.length - preview.updatedCount;
      setActionMessage(
        `情報再取得: 対象${targetTabs.length}件 / 更新${preview.updatedCount}件 / 失敗${failedCount}件`,
      );
    } catch (err) {
      console.error('Failed to refresh tab metadata', err);
      setActionMessage(err instanceof Error ? err.message : 'タブ情報の再取得に失敗しました。');
    } finally {
      if (metadataWindowId !== null) {
        await removeWindow(metadataWindowId);
      }
      setRefreshingSetIds((current) => current.filter((id) => id !== setId));
    }
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
      const baseTabIndex = await getWindowTabCount(windowId);
      const { restoredTabs, failedTabs } = await restoreTabs(
        targetSet.tabs,
        targetSet.groups,
        windowId,
        restoreLoadingSuppressionEnabled,
        baseTabIndex,
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
      const baseTabIndex = await getWindowTabCount(windowId);
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
        baseTabIndex,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets.flatMap((item) => {
            if (item.id !== targetSet.id) {
              return [item];
            }
            const cleaned = cleanupHistorySet(item, restoredTabs);
            return cleaned.tabs.length === 0 ? [] : [cleaned];
          }),
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

  const handleRestoreTab = async (setId: string, tab: TabSnapshot) => {
    setActionMessage('タブを復元しています...');
    try {
      const windowId = await getCurrentWindowId();
      const baseTabIndex = await getWindowTabCount(windowId);
      const { restoredTabs } = await restoreTabs(
        [tab],
        [],
        windowId,
        restoreLoadingSuppressionEnabled,
        baseTabIndex,
      );
      if (removeRestoredTabsEnabled) {
        const updated = await updateState((current) => ({
          ...current,
          historySets: current.historySets.flatMap((item) => {
            if (item.id !== setId) {
              return [item];
            }
            const cleaned = cleanupHistorySet(item, restoredTabs);
            return cleaned.tabs.length === 0 ? [] : [cleaned];
          }),
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
              className="button button--ghost button--compact manager__options-link"
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
            value={setFilter}
            onChange={(event) => {
              const nextSetFilter = event.target.value;
              setSetFilter(nextSetFilter);
              if (state.status !== 'ready' || !state.data) {
                setGroupFilter(GROUP_FILTER_ALL);
                return;
              }
              const nextGroupOptions = buildGroupFilterOptions(state.data, nextSetFilter);
              if (!nextGroupOptions.includes(groupFilter)) {
                setGroupFilter(GROUP_FILTER_ALL);
              }
            }}
          >
            {setOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="manager__select"
            value={activeGroupFilter}
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
          <Button variant="ghost" onClick={handleCreateWindow}>
            新規ウィンドウ
          </Button>
          {actionMessage ? <span className="manager__status">{actionMessage}</span> : null}
        </section>

        <main
          className="manager__content"
          style={dragSpacerPx > 0 ? { paddingBottom: dragSpacerPx } : undefined}
        >
          {visibleSets.length === 0 ? (
            <p className="manager__empty">現在のフィルタに一致するタブがありません。</p>
          ) : (
            <div className="manager__set-grid">
              {renderSets.map((set, renderIndex) => {
                const leftDropIndex = resolveSetDropIndex(renderIndex);
                const rightDropIndex = resolveSetDropIndex(renderIndex + 1);
                const fullSet = fullSets.find((item) => item.id === set.id);
                const bindingStatus = resolveBindingStatus(
                  set.managerBinding,
                  currentManagerContext,
                );
                const bindingToggleDisabled = currentManagerContext === null;
                const rowActions = createTabRowActions<TabSnapshot>({
                  onOpen: (tab) => handleRestoreTab(set.id, tab),
                  onRemove: (tab) => handleDeleteTab(set.id, tab),
                });
                const handleToggleGroupLockForSet = (groupUid: string) => {
                  void handleToggleGroupLock(set.id, groupUid);
                };
                const handleToggleTabLockForSet = (tab: TabSnapshot) => {
                  void handleToggleTabLock(set.id, tab.uid);
                };
                const shouldShowDropPlaceholder = activeSetDropRenderIndex === renderIndex;

                return (
                  <Fragment key={set.id}>
                    {shouldShowDropPlaceholder ? (
                      <div
                        className="manager__set-drop-placeholder"
                        style={setDropWidthPx > 0 ? { width: setDropWidthPx } : undefined}
                        aria-hidden="true"
                      />
                    ) : null}
                    <div className="manager__set-grid-item">
                      <DropZone
                        id={`zone:set:${leftDropIndex}:left`}
                        dropItem={{ type: 'set-zone', index: leftDropIndex }}
                        activeDrop={activeDrop}
                        dropGapPx={dropGapPx}
                        baseGapPx={SET_LIST_GAP_PX}
                        axis="horizontal"
                        placement="left"
                        reorderEnabled={reorderEnabled}
                      />
                      <SetCard
                        set={set}
                        fullSet={fullSet}
                        bindingStatus={bindingStatus}
                        bindingToggleDisabled={bindingToggleDisabled}
                        reorderEnabled={reorderEnabled}
                        shouldStartEditing={editingSetId === set.id}
                        onStartEditingHandled={() => {
                          if (editingSetId === set.id) {
                            setEditingSetId(null);
                          }
                        }}
                        onRestoreSet={() => handleRestoreSet(set)}
                        onRefreshMetadata={() => handleRefreshMetadata(set.id)}
                        refreshingMetadata={refreshingSetIds.includes(set.id)}
                        onDeleteSet={() => handleDeleteSet(set.id)}
                        onToggleSetLock={() => handleToggleSetLock(set.id)}
                        onToggleBinding={() => handleToggleManagerBinding(set.id)}
                        onRenameSet={(title) => handleRenameSet(set.id, title)}
                        onRestoreGroup={(groupId) => handleRestoreGroup(set, groupId)}
                        onRenameGroup={(groupUid, title) =>
                          handleRenameGroup(set.id, groupUid, title)
                        }
                        onDeleteGroup={(groupUid) => handleDeleteGroup(set.id, groupUid)}
                        onToggleGroupLock={handleToggleGroupLockForSet}
                        onCreateGroup={() => handleCreateGroup(set.id)}
                        onToggleTabLock={handleToggleTabLockForSet}
                        rowActions={rowActions}
                        activeDrop={activeDrop}
                        dropGapPx={dropGapPx}
                        cardHeight={effectiveCardHeight}
                        onResizeStart={handleResizeStart}
                      />
                      <DropZone
                        id={`zone:set:${rightDropIndex}:right`}
                        dropItem={{ type: 'set-zone', index: rightDropIndex }}
                        activeDrop={activeDrop}
                        dropGapPx={dropGapPx}
                        baseGapPx={SET_LIST_GAP_PX}
                        axis="horizontal"
                        placement="right"
                        reorderEnabled={reorderEnabled}
                      />
                    </div>
                  </Fragment>
                );
              })}
              {activeSetDropRenderIndex === renderSets.length ? (
                <div
                  className="manager__set-drop-placeholder"
                  style={setDropWidthPx > 0 ? { width: setDropWidthPx } : undefined}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          )}
        </main>
      </div>
      <DragOverlay dropAnimation={null}>{overlayContent}</DragOverlay>
    </DndContext>
  );
}
