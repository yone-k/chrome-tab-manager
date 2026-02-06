import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureManagerTabInWindow,
  filterOutManagerTabs,
  findManagerTabInWindow,
  openManagerTabInCurrentWindow,
} from '../managerTab';

const managerUrl = 'chrome-extension://test-extension-id/manager.html';

type MockTab = Partial<chrome.tabs.Tab> & {
  id?: number;
  windowId?: number;
  url?: string;
  pendingUrl?: string;
};

type MockWindow = Partial<chrome.windows.Window> & {
  id?: number;
};

function installChromeMock({
  queryTabs,
  updateTab,
  createTab,
  getCurrentWindow,
  failCreateWithWindowId,
}: {
  queryTabs?: MockTab[];
  updateTab?: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => void;
  createTab?: (createProperties: chrome.tabs.CreateProperties) => void;
  getCurrentWindow?: MockWindow;
  failCreateWithWindowId?: number;
}) {
  let runtimeLastError: chrome.runtime.LastError | undefined;
  const query = vi.fn((_: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
    callback((queryTabs ?? []).map((tab) => tab as chrome.tabs.Tab));
  });
  const update = vi.fn(
    (tabId: number, updateProperties: chrome.tabs.UpdateProperties, callback: () => void) => {
      updateTab?.(tabId, updateProperties);
      callback();
    },
  );
  let createCounter = 0;
  const create = vi.fn(
    (createProperties: chrome.tabs.CreateProperties, callback: (tab: chrome.tabs.Tab) => void) => {
      createCounter += 1;
      createTab?.(createProperties);
      if (
        typeof failCreateWithWindowId === 'number' &&
        createProperties.windowId === failCreateWithWindowId
      ) {
        runtimeLastError = { message: 'No window with id' };
        callback({} as chrome.tabs.Tab);
        runtimeLastError = undefined;
        return;
      }
      callback({
        id: 1000 + createCounter,
        windowId: createProperties.windowId ?? 7000,
      } as chrome.tabs.Tab);
    },
  );
  const getCurrent = vi.fn((callback: (window: chrome.windows.Window) => void) => {
    callback((getCurrentWindow ?? { id: 1 }) as chrome.windows.Window);
  });

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: vi.fn(() => managerUrl),
      get lastError() {
        return runtimeLastError;
      },
    },
    tabs: {
      query,
      update,
      create,
    },
    windows: {
      getCurrent,
    },
  } as unknown as typeof chrome);

  return { query, update, create, getCurrent };
}

describe('findManagerTabInWindow', () => {
  it('指定ウィンドウ内の管理画面タブだけを返す', () => {
    const result = findManagerTabInWindow(
      [
        { id: 11, windowId: 100, url: managerUrl } as chrome.tabs.Tab,
        { id: 22, windowId: 200, url: managerUrl } as chrome.tabs.Tab,
      ],
      200,
    );

    expect(result?.id).toBe(22);
  });
});

describe('filterOutManagerTabs', () => {
  it('管理画面タブを保存対象から除外する', () => {
    const tabs = [
      { id: 11, url: managerUrl },
      { id: 22, url: 'https://example.com' },
      { id: 33, pendingUrl: managerUrl },
    ];

    expect(filterOutManagerTabs(tabs, managerUrl)).toEqual([
      { id: 22, url: 'https://example.com' },
    ]);
  });
});

describe('openManagerTabInCurrentWindow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('現在ウィンドウに既存管理画面があればそれをアクティブ化する', async () => {
    const { update, create, getCurrent } = installChromeMock({
      queryTabs: [
        { id: 10, windowId: 123, url: managerUrl },
        { id: 20, windowId: 999, url: managerUrl },
      ],
    });

    await openManagerTabInCurrentWindow(123);

    expect(update).toHaveBeenCalledWith(10, { active: true }, expect.any(Function));
    expect(create).not.toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it('現在ウィンドウに管理画面がなければ同一ウィンドウへ新規作成する', async () => {
    const { update, create } = installChromeMock({
      queryTabs: [{ id: 20, windowId: 999, url: managerUrl }],
    });

    await openManagerTabInCurrentWindow(123);

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      { url: managerUrl, windowId: 123, active: true },
      expect.any(Function),
    );
  });

  it('currentWindowId未指定時は現在ウィンドウIDを取得して開く', async () => {
    const { create, getCurrent } = installChromeMock({
      queryTabs: [],
      getCurrentWindow: { id: 321 },
    });

    await openManagerTabInCurrentWindow();

    expect(getCurrent).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      { url: managerUrl, windowId: 321, active: true },
      expect.any(Function),
    );
  });

  it('対象ウィンドウが閉じられていた場合はwindowIdなし作成へフォールバックする', async () => {
    const { create } = installChromeMock({
      queryTabs: [],
      failCreateWithWindowId: 555,
    });

    await openManagerTabInCurrentWindow(555);

    expect(create).toHaveBeenNthCalledWith(
      1,
      { url: managerUrl, windowId: 555, active: true },
      expect.any(Function),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      { url: managerUrl, active: true },
      expect.any(Function),
    );
  });
});

describe('ensureManagerTabInWindow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('同一ウィンドウに既存管理画面がある場合は紐づけを返して新規作成しない', async () => {
    const { update, create } = installChromeMock({
      queryTabs: [{ id: 10, windowId: 123, url: managerUrl }],
    });

    const binding = await ensureManagerTabInWindow(123, 5);

    expect(binding).toEqual({ managerTabId: 10, managerWindowId: 123 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('同一ウィンドウにない場合は非アクティブで作成して紐づけを返す', async () => {
    const { create } = installChromeMock({
      queryTabs: [{ id: 10, windowId: 999, url: managerUrl }],
      createTab: (createProperties) => {
        expect(createProperties.windowId).toBe(123);
      },
    });

    const binding = await ensureManagerTabInWindow(123, 7);

    expect(create).toHaveBeenCalledWith(
      { url: managerUrl, windowId: 123, active: false, index: 7 },
      expect.any(Function),
    );
    expect(binding.managerWindowId).toBe(123);
    expect(typeof binding.managerTabId).toBe('number');
  });
});
