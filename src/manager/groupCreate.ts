import { normalizeLayout } from '../tab-manager/layout';
import type { GroupSnapshot, HistorySet } from '../tab-manager/types';

export function createGroupAtTop(set: HistorySet, groupUid: string): HistorySet {
  const nextId = set.groups.length === 0 ? 1 : Math.max(...set.groups.map((group) => group.id)) + 1;
  const newGroup: GroupSnapshot = {
    uid: groupUid,
    id: nextId,
    title: '新規グループ',
    color: 'grey',
    index: set.groups.length,
    locked: false,
  };

  return {
    ...set,
    groups: [newGroup, ...set.groups],
    layout: [
      { type: 'group', uid: newGroup.uid },
      ...normalizeLayout(set.layout, set.groups, set.tabs),
    ],
  };
}
