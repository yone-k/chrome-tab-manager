import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moveTabToWindow, restoreSession, ungroupTab } from './sessionRestore';

describe('restoreSession', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('chrome.sessions.restore を正しく呼び出す', async () => {
    const mockSession = {
      tab: { id: 1, url: 'https://example.com' },
    } as chrome.sessions.Session;
    const restore = vi.fn().mockResolvedValue(mockSession);
    vi.stubGlobal('chrome', {
      sessions: { restore },
    });

    const result = await restoreSession('ses-123');

    expect(restore).toHaveBeenCalledWith('ses-123');
    expect(result).toBe(mockSession);
  });
});

describe('moveTabToWindow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('chrome.tabs.move を正しいパラメータで呼び出す', async () => {
    const mockTab = { id: 5, windowId: 10, index: 2 } as chrome.tabs.Tab;
    const move = vi.fn().mockResolvedValue(mockTab);
    vi.stubGlobal('chrome', {
      tabs: { move },
    });

    const result = await moveTabToWindow(5, 10, 2);

    expect(move).toHaveBeenCalledWith(5, { windowId: 10, index: 2 });
    expect(result).toBe(mockTab);
  });

  it('配列結果の場合も最初の要素を返す', async () => {
    const mockTab = { id: 5, windowId: 10, index: 2 } as chrome.tabs.Tab;
    const move = vi.fn().mockResolvedValue([mockTab]);
    vi.stubGlobal('chrome', {
      tabs: { move },
    });

    const result = await moveTabToWindow(5, 10, 2);

    expect(result).toBe(mockTab);
  });
});

describe('ungroupTab', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('chrome.tabs.ungroup を正しく呼び出す', async () => {
    const ungroup = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      tabs: { ungroup },
    });

    await ungroupTab(42);

    expect(ungroup).toHaveBeenCalledWith([42]);
  });

  it('chrome.tabs.ungroup が失敗した場合は例外が伝播する', async () => {
    const ungroup = vi.fn().mockRejectedValue(new Error('ungroup failed'));
    vi.stubGlobal('chrome', {
      tabs: { ungroup },
    });

    await expect(ungroupTab(42)).rejects.toThrow('ungroup failed');
  });
});

describe('restoreSession edge cases', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('chrome.sessions.restore が失敗した場合は例外が伝播する', async () => {
    const restore = vi.fn().mockRejectedValue(new Error('session expired'));
    vi.stubGlobal('chrome', {
      sessions: { restore },
    });

    await expect(restoreSession('invalid-session')).rejects.toThrow('session expired');
  });

  it('chrome.sessions.restore が window セッションを返しても呼び出し元に渡る', async () => {
    // restoreSession はラッパーなので戻り値をそのまま返す
    // 呼び出し元の restoreTabs Phase 0 が session.tab チェックで弾く責務
    const windowSession = {
      window: { id: 10, tabs: [] },
    } as unknown as chrome.sessions.Session;
    const restore = vi.fn().mockResolvedValue(windowSession);
    vi.stubGlobal('chrome', {
      sessions: { restore },
    });

    const result = await restoreSession('ses-window');
    expect(result).toBe(windowSession);
    expect(result.tab).toBeUndefined();
  });
});

describe('moveTabToWindow edge cases', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('chrome.tabs.move が失敗した場合は例外が伝播する', async () => {
    const move = vi.fn().mockRejectedValue(new Error('tab not found'));
    vi.stubGlobal('chrome', {
      tabs: { move },
    });

    await expect(moveTabToWindow(999, 10, 0)).rejects.toThrow('tab not found');
  });

  it('chrome.tabs.move が空配列を返した場合は undefined を返す', async () => {
    // Chrome API が空配列を返すケース（通常は起きないが型上は可能）
    const move = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('chrome', {
      tabs: { move },
    });

    const result = await moveTabToWindow(5, 10, 0);
    expect(result).toBeUndefined();
  });
});
