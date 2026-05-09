type RestoreTargetLabel = 'タブ' | 'グループ';

export function buildRestoreActionMessage(
  targetLabel: RestoreTargetLabel,
  total: number,
  restoredCount: number,
  failedCount: number,
  sessionRestoredCount: number,
  skippedDuplicateCount: number,
) {
  const createdOrSessionRestoredCount = restoredCount - skippedDuplicateCount;
  if (failedCount > 0) {
    if (skippedDuplicateCount > 0) {
      return `${total}件中${createdOrSessionRestoredCount}件のタブを復元しました（${skippedDuplicateCount}件は重複スキップ）。`;
    }
    return sessionRestoredCount > 0
      ? `${total}件中${restoredCount}件のタブを復元しました（${sessionRestoredCount}件が履歴付き）。`
      : `${total}件中${restoredCount}件のタブを復元しました。`;
  }
  if (skippedDuplicateCount > 0) {
    return `${targetLabel}を復元しました（${skippedDuplicateCount}件は既存タブと重複のためスキップ）。`;
  }
  if (sessionRestoredCount > 0 && sessionRestoredCount === total) {
    return `${targetLabel}を復元しました（全${total}件が履歴付き）。`;
  }
  if (sessionRestoredCount > 0) {
    return `${total}件中${sessionRestoredCount}件が履歴付きで復元されました。`;
  }
  return `${targetLabel}を復元しました。`;
}
