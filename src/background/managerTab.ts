import { getTabUrl } from '../tab-manager/exclusions';
import type { ManagerBinding } from '../tab-manager/types';

function queryManagerTabs(managerUrl: string) {
  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ url: managerUrl }, (tabs: chrome.tabs.Tab[]) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tabs);
    });
  });
}

function getCurrentWindowId() {
  return new Promise<number>((resolve, reject) => {
    chrome.windows.getLastFocused((window: chrome.windows.Window) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      if (!window?.id) {
        reject(new Error('アクティブなウィンドウが見つかりません。'));
        return;
      }
      resolve(window.id);
    });
  });
}

function activateTab(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

type CreateManagerTabOptions = {
  windowId?: number;
  active?: boolean;
  index?: number;
};

function createManagerTab(managerUrl: string, options: CreateManagerTabOptions = {}) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    const createProperties: chrome.tabs.CreateProperties = { url: managerUrl };
    if (typeof options.active === 'boolean') {
      createProperties.active = options.active;
    }
    if (typeof options.windowId === 'number') {
      createProperties.windowId = options.windowId;
    }
    if (typeof options.index === 'number') {
      createProperties.index = options.index;
    }
    chrome.tabs.create(createProperties, (tab: chrome.tabs.Tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(tab);
    });
  });
}

export function findManagerTabInWindow(tabs: chrome.tabs.Tab[], windowId: number) {
  return tabs.find((tab) => tab.windowId === windowId && typeof tab.id === 'number') ?? null;
}

export function filterOutManagerTabs<
  T extends {
    url?: string;
    pendingUrl?: string;
  },
>(tabs: T[], managerUrl: string) {
  return tabs.filter((tab) => getTabUrl(tab) !== managerUrl);
}

export async function ensureManagerTabInWindow(
  windowId: number,
  preferredIndex?: number,
): Promise<ManagerBinding> {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const managerTabs = await queryManagerTabs(managerUrl);
  const existing = findManagerTabInWindow(managerTabs, windowId);

  if (existing?.id !== undefined && existing.windowId !== undefined) {
    return {
      managerTabId: existing.id,
      managerWindowId: existing.windowId,
    };
  }

  const index = typeof preferredIndex === 'number' ? preferredIndex : undefined;
  const created = await createManagerTab(managerUrl, { windowId, active: false, index });
  if (created.id === undefined || created.windowId === undefined) {
    throw new Error('管理画面タブの作成に失敗しました。');
  }
  return {
    managerTabId: created.id,
    managerWindowId: created.windowId,
  };
}

function isNoWindowError(error: unknown) {
  if (error instanceof Error) {
    return error.message.includes('No window with id');
  }
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return false;
  }
  const message = error.message;
  return typeof message === 'string' && message.includes('No window with id');
}

export async function openManagerTabInCurrentWindow(currentWindowId?: number) {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const windowId = currentWindowId ?? (await getCurrentWindowId());
  const managerTabs = await queryManagerTabs(managerUrl);
  const existing = findManagerTabInWindow(managerTabs, windowId);

  if (existing?.id !== undefined) {
    await activateTab(existing.id);
    return;
  }

  try {
    await createManagerTab(managerUrl, { windowId, active: true });
  } catch (error) {
    if (!isNoWindowError(error)) {
      throw error;
    }
    // The window may already be closed. Fall back to opening the manager tab in a new target.
    await createManagerTab(managerUrl, { active: true });
  }
}
