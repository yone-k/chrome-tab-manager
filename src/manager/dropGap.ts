export const DEFAULT_DROP_GAP_PX = 24;

export function computeDropGapPx(height: number | null | undefined): number {
  if (!height || height <= 0 || Number.isNaN(height)) {
    return DEFAULT_DROP_GAP_PX;
  }
  return height;
}
