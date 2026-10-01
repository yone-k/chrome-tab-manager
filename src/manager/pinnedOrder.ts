type Identified = { id: string };

export function pinSetsToFront<T>(sets: T[], isPinned: (set: T) => boolean): T[] {
  const pinned = sets.filter(isPinned);
  if (pinned.length === 0) {
    return sets;
  }
  return [...pinned, ...sets.filter((set) => !isPinned(set))];
}

export function resolveStoredSetDropIndex(
  storedSets: Identified[],
  displaySets: Identified[],
  displayIndex: number,
): number {
  const target = displaySets[displayIndex];
  if (!target) {
    return storedSets.length;
  }
  const storedIndex = storedSets.findIndex((set) => set.id === target.id);
  return storedIndex === -1 ? storedSets.length : storedIndex;
}
