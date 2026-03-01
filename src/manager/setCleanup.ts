import type { HistorySet } from '../tab-manager/types';

export function removeSetsEmptiedSince(previousSets: HistorySet[], nextSets: HistorySet[]) {
  const previousTabCountById = new Map(previousSets.map((set) => [set.id, set.tabs.length]));

  return nextSets.filter((set) => {
    if (set.tabs.length > 0) {
      return true;
    }
    const previousTabCount = previousTabCountById.get(set.id);
    if (previousTabCount === undefined) {
      return true;
    }
    return previousTabCount === 0;
  });
}
