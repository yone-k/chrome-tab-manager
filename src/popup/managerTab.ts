import { getTabUrl } from '../tab-manager/exclusions';

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
    chrome.windows.getCurrent((window: chrome.windows.Window) => {
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
  return new Promise<void>((resolve, reject) => {
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
    chrome.tabs.create(createProperties, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
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

export async function ensureManagerTabInWindow(windowId: number, preferredIndex?: number) {
  const managerUrl = chrome.runtime.getURL('manager.html');
  const managerTabs = await queryManagerTabs(managerUrl);
  const existing = findManagerTabInWindow(managerTabs, windowId);

  if (existing?.id !== undefined) {
    return;
  }

  const index = typeof preferredIndex === 'number' ? preferredIndex : undefined;
  await createManagerTab(managerUrl, { windowId, active: false, index });
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
  } catch {
    // The window may already be closed. Fall back to opening the manager tab in a new target.
    await createManagerTab(managerUrl, { active: true });
  }
}
