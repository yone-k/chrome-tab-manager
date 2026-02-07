import type { ManagerBinding } from '../tab-manager/types';

export type BindingStatus = 'bound-current' | 'bound-other' | 'unbound';

export type ManagerContext = {
  tabId: number;
  windowId: number;
};

export function resolveBindingStatus(
  managerBinding: ManagerBinding | null,
  currentContext: ManagerContext | null,
): BindingStatus {
  if (!managerBinding) {
    return 'unbound';
  }
  if (
    currentContext &&
    managerBinding.managerTabId === currentContext.tabId &&
    managerBinding.managerWindowId === currentContext.windowId
  ) {
    return 'bound-current';
  }
  return 'bound-other';
}

export function getBindingStatusLabel(status: BindingStatus) {
  if (status === 'bound-current') {
    return 'この管理画面に接続中';
  }
  if (status === 'bound-other') {
    return '他の管理画面に接続中';
  }
  return '未接続';
}
