export const DEFAULT_RESTORE_LOADING_THRESHOLD = 2;

type RestoreLoadingSuppressionInput = {
  enabled: boolean;
  tabCount: number;
  threshold?: number;
};

export function shouldSuppressRestoreLoading({
  enabled,
  tabCount,
  threshold = DEFAULT_RESTORE_LOADING_THRESHOLD,
}: RestoreLoadingSuppressionInput) {
  return enabled && tabCount >= threshold;
}
