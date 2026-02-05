type DragHeightInput = {
  eventTargetHeight?: number | null;
  rectInitialHeight?: number | null;
  rectTranslatedHeight?: number | null;
};

export function selectDragItemHeight({
  eventTargetHeight,
  rectInitialHeight,
  rectTranslatedHeight,
}: DragHeightInput): number | null {
  const candidates = [eventTargetHeight, rectInitialHeight, rectTranslatedHeight];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && candidate > 0) {
      return candidate;
    }
  }
  return null;
}
