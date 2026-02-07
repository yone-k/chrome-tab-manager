import {
  runCloseCurrentGroupWithSave,
  runCloseCurrentWindowTabsWithSave,
  runOpenManagerInCurrentWindow,
  runSaveAndCloseCurrentWindow,
} from './commands';

export const ACTION_MENU_IDS = {
  OPEN_MANAGER: 'open-manager',
  SAVE_AND_CLOSE: 'save-and-close',
  CLOSE_CURRENT_TABS: 'close-current-tabs',
  CLOSE_CURRENT_GROUP: 'close-current-group',
} as const;

type ActionMenuId = (typeof ACTION_MENU_IDS)[keyof typeof ACTION_MENU_IDS];

type ActionMenuItem = {
  id: ActionMenuId;
  title: string;
};

const ACTION_MENU_ITEMS: ActionMenuItem[] = [
  { id: ACTION_MENU_IDS.OPEN_MANAGER, title: 'タブマネージャーを開く' },
  { id: ACTION_MENU_IDS.SAVE_AND_CLOSE, title: 'タブを保存して閉じる' },
  { id: ACTION_MENU_IDS.CLOSE_CURRENT_TABS, title: '今開いているタブを保存して閉じる' },
  { id: ACTION_MENU_IDS.CLOSE_CURRENT_GROUP, title: '今開いているグループを保存して閉じる' },
];

function removeAllContextMenus() {
  return new Promise<void>((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function createActionContextMenu(item: ActionMenuItem) {
  return new Promise<void>((resolve, reject) => {
    chrome.contextMenus.create(
      {
        id: item.id,
        title: item.title,
        contexts: ['action'],
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      },
    );
  });
}

export async function setupActionContextMenus() {
  await removeAllContextMenus();
  for (const item of ACTION_MENU_ITEMS) {
    await createActionContextMenu(item);
  }
}

export async function handleActionMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) {
  switch (info.menuItemId) {
    case ACTION_MENU_IDS.OPEN_MANAGER:
      await runOpenManagerInCurrentWindow(tab);
      return;
    case ACTION_MENU_IDS.SAVE_AND_CLOSE:
      await runSaveAndCloseCurrentWindow(tab);
      return;
    case ACTION_MENU_IDS.CLOSE_CURRENT_TABS:
      await runCloseCurrentWindowTabsWithSave(tab);
      return;
    case ACTION_MENU_IDS.CLOSE_CURRENT_GROUP:
      await runCloseCurrentGroupWithSave(tab);
      return;
    default:
      return;
  }
}
