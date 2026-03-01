const RESTORE_LOADING_THRESHOLD = 2;

type RestoreLoadingSuppressionInput = {
  enabled: boolean;
  tabCount: number;
};

export function shouldSuppressRestoreLoading({
  enabled,
  tabCount,
}: RestoreLoadingSuppressionInput) {
  return enabled && tabCount >= RESTORE_LOADING_THRESHOLD;
}
