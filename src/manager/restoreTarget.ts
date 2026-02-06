import type { ManagerBinding } from '../tab-manager/types';

export type RestoreTarget = 'bound-window' | 'new-window';

export function resolveRestoreTarget(
  managerBinding: ManagerBinding | null,
  currentManagerTabId: number,
  currentManagerWindowId: number,
): RestoreTarget {
  if (!managerBinding) {
    return 'new-window';
  }
  if (
    managerBinding.managerTabId === currentManagerTabId &&
    managerBinding.managerWindowId === currentManagerWindowId
  ) {
    return 'bound-window';
  }
  return 'new-window';
}
