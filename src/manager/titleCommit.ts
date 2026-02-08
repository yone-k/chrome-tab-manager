import { normalizeManualHistorySetName } from '../tab-manager/history';

export function resolveSetTitleForCommit(draftTitle: string, currentTitle: string) {
  if (draftTitle.trim().length === 0) {
    return currentTitle;
  }
  return normalizeManualHistorySetName(draftTitle);
}

export function resolveGroupTitleForCommit(draftTitle: string, currentTitle: string) {
  const trimmed = draftTitle.trim();
  return trimmed.length > 0 ? trimmed : currentTitle;
}
