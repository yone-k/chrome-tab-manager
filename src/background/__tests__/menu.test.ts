import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runOpenManagerInCurrentWindow,
  runSaveAndCloseCurrentWindow,
  runCloseCurrentWindowTabsWithSave,
  runCloseCurrentGroupWithSave,
} = vi.hoisted(() => ({
  runOpenManagerInCurrentWindow: vi.fn(async () => {}),
  runSaveAndCloseCurrentWindow: vi.fn(async () => {}),
  runCloseCurrentWindowTabsWithSave: vi.fn(async () => {}),
  runCloseCurrentGroupWithSave: vi.fn(async () => {}),
}));

vi.mock('../commands', () => ({
  runOpenManagerInCurrentWindow,
  runSaveAndCloseCurrentWindow,
  runCloseCurrentWindowTabsWithSave,
  runCloseCurrentGroupWithSave,
}));

import { ACTION_MENU_IDS, handleActionMenuClick, setupActionContextMenus } from '../menu';

function installChromeMock() {
  const removeAll = vi.fn((callback: () => void) => callback());
  const create = vi.fn((_: chrome.contextMenus.CreateProperties, callback?: () => void) => {
    callback?.();
  });

  vi.stubGlobal('chrome', {
    runtime: {
      get lastError() {
        return undefined;
      },
    },
    contextMenus: {
      removeAll,
      create,
    },
  } as unknown as typeof chrome);

  return { removeAll, create };
}

describe('setupActionContextMenus', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('アクションメニューを4件登録する', async () => {
    const { removeAll, create } = installChromeMock();

    await setupActionContextMenus();

    expect(removeAll).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ACTION_MENU_IDS.OPEN_MANAGER,
        title: 'タブマネージャーを開く',
        contexts: ['action'],
      }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ACTION_MENU_IDS.CLOSE_CURRENT_TABS,
        title: '今開いているタブを保存して閉じる',
        contexts: ['action'],
      }),
      expect.any(Function),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ACTION_MENU_IDS.CLOSE_CURRENT_GROUP,
        title: '今開いているグループを保存して閉じる',
        contexts: ['action'],
      }),
      expect.any(Function),
    );
  });
});

describe('handleActionMenuClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('open-manager クリック時に管理画面オープン処理を呼ぶ', async () => {
    await handleActionMenuClick({
      menuItemId: ACTION_MENU_IDS.OPEN_MANAGER,
    } as chrome.contextMenus.OnClickData);
    expect(runOpenManagerInCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it('save-and-close クリック時に保存して閉じる処理を呼ぶ', async () => {
    await handleActionMenuClick({
      menuItemId: ACTION_MENU_IDS.SAVE_AND_CLOSE,
    } as chrome.contextMenus.OnClickData);
    expect(runSaveAndCloseCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it('close-current-tabs クリック時に現在タブを閉じる処理を呼ぶ', async () => {
    await handleActionMenuClick({
      menuItemId: ACTION_MENU_IDS.CLOSE_CURRENT_TABS,
    } as chrome.contextMenus.OnClickData);
    expect(runCloseCurrentWindowTabsWithSave).toHaveBeenCalledTimes(1);
  });

  it('close-current-group クリック時に現在グループを閉じる処理を呼ぶ', async () => {
    await handleActionMenuClick({
      menuItemId: ACTION_MENU_IDS.CLOSE_CURRENT_GROUP,
    } as chrome.contextMenus.OnClickData);
    expect(runCloseCurrentGroupWithSave).toHaveBeenCalledTimes(1);
  });
});
