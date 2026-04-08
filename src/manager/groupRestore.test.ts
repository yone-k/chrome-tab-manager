import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreGroupWithRetry } from './groupRestore';

type ChromeRuntimeState = {
  lastError: Error | null;
};

function stubChrome() {
  const runtime: ChromeRuntimeState = {
    lastError: null,
  };

  const tabsGroup = vi.fn();
  const tabGroupsUpdate = vi.fn();
  const tabGroupsGet = vi.fn();
  const tabGroupsMove = vi.fn();

  vi.stubGlobal('chrome', {
    runtime,
    tabs: {
      group: tabsGroup,
    },
    tabGroups: {
      update: tabGroupsUpdate,
      get: tabGroupsGet,
      move: tabGroupsMove,
    },
  });

  return {
    runtime,
    tabsGroup,
    tabGroupsGet,
    tabGroupsMove,
    tabGroupsUpdate,
  };
}

describe('restoreGroupWithRetry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('初回の検証で title と color が一致した場合は groupId を返す', async () => {
    const { tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      callback(91);
    });
    tabGroupsUpdate.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );
    tabGroupsGet.mockImplementation(
      (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
        callback({ id: 91, title: 'Work', color: 'blue' } as chrome.tabGroups.TabGroup);
      },
    );
    tabGroupsMove.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );

    const result = await restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);

    expect(result).toBe(91);
    expect(tabsGroup).toHaveBeenCalledTimes(1);
    expect(tabsGroup).toHaveBeenCalledWith(
      { createProperties: { windowId: 5 }, tabIds: [10, 11] },
      expect.any(Function),
    );
    expect(tabGroupsUpdate).toHaveBeenCalledTimes(1);
    expect(tabGroupsUpdate).toHaveBeenCalledWith(
      91,
      { title: 'Work', color: 'blue' },
      expect.any(Function),
    );
    expect(tabGroupsGet).toHaveBeenCalledTimes(1);
    expect(tabGroupsGet).toHaveBeenCalledWith(91, expect.any(Function));
    expect(tabGroupsMove).toHaveBeenCalledWith(91, { index: 3 }, expect.any(Function));
  });

  it('検証で title が空のままなら待機して再試行し、次回成功したら返す', async () => {
    const { tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      callback(91);
    });
    tabGroupsUpdate.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );
    tabGroupsGet
      .mockImplementationOnce(
        (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
          callback({ id: 91, title: '', color: 'blue' } as chrome.tabGroups.TabGroup);
        },
      )
      .mockImplementationOnce(
        (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
          callback({ id: 91, title: 'Work', color: 'blue' } as chrome.tabGroups.TabGroup);
        },
      );
    tabGroupsMove.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );

    const promise = restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe(91);
    expect(tabGroupsUpdate).toHaveBeenCalledTimes(2);
    expect(tabGroupsGet).toHaveBeenCalledTimes(2);
    expect(tabGroupsMove).toHaveBeenCalledTimes(1);
  });

  it('検証で color が一致しない場合も再試行する', async () => {
    const { tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      callback(91);
    });
    tabGroupsUpdate.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );
    tabGroupsGet
      .mockImplementationOnce(
        (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
          callback({ id: 91, title: 'Work', color: 'grey' } as chrome.tabGroups.TabGroup);
        },
      )
      .mockImplementationOnce(
        (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
          callback({ id: 91, title: 'Work', color: 'blue' } as chrome.tabGroups.TabGroup);
        },
      );
    tabGroupsMove.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );

    const promise = restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe(91);
    expect(tabGroupsUpdate).toHaveBeenCalledTimes(2);
    expect(tabGroupsGet).toHaveBeenCalledTimes(2);
  });

  it('groupTabs が失敗した場合は null を返す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime, tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      runtime.lastError = new Error('group failed');
      callback(-1);
    });

    const result = await restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);

    expect(result).toBeNull();
    expect(tabGroupsUpdate).not.toHaveBeenCalled();
    expect(tabGroupsGet).not.toHaveBeenCalled();
    expect(tabGroupsMove).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Failed to create tab group', expect.any(Error));
  });

  it('検証が3回とも失敗した場合は警告して groupId を返す', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      callback(91);
    });
    tabGroupsUpdate.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );
    tabGroupsGet.mockImplementation(
      (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
        callback({ id: 91, title: '', color: 'blue' } as chrome.tabGroups.TabGroup);
      },
    );
    tabGroupsMove.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );

    const promise = restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe(91);
    expect(tabGroupsUpdate).toHaveBeenCalledTimes(3);
    expect(tabGroupsGet).toHaveBeenCalledTimes(3);
    expect(tabGroupsMove).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('moveTabGroup が失敗した場合は警告だけ出して groupId を返す', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runtime, tabsGroup, tabGroupsGet, tabGroupsMove, tabGroupsUpdate } = stubChrome();
    tabsGroup.mockImplementation((_options: unknown, callback: (groupId: number) => void) => {
      callback(91);
    });
    tabGroupsUpdate.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        callback();
      },
    );
    tabGroupsGet.mockImplementation(
      (_groupId: number, callback: (group: chrome.tabGroups.TabGroup) => void) => {
        callback({ id: 91, title: 'Work', color: 'blue' } as chrome.tabGroups.TabGroup);
      },
    );
    tabGroupsMove.mockImplementation(
      (_groupId: number, _options: unknown, callback: () => void) => {
        runtime.lastError = new Error('move failed');
        callback();
      },
    );

    const result = await restoreGroupWithRetry(5, [10, 11], 'Work', 'blue', 3);

    expect(result).toBe(91);
    expect(warnSpy).toHaveBeenCalledWith('Failed to move tab group', expect.any(Error));
  });
});
