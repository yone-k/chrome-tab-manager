import { runSaveAndCloseCurrentWindow } from './commands';
import { handleActionMenuClick, setupActionContextMenus } from './menu';

function reportError(prefix: string, error: unknown) {
  console.error(prefix, error);
}

function registerListeners() {
  chrome.action.onClicked.addListener((tab) => {
    void runSaveAndCloseCurrentWindow(tab).catch((error) => {
      reportError('Failed to handle action click', error);
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleActionMenuClick(info, tab).catch((error) => {
      reportError('Failed to handle action menu click', error);
    });
  });

  chrome.runtime.onInstalled.addListener(() => {
    void setupActionContextMenus().catch((error) => {
      reportError('Failed to setup action menus on installed', error);
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    void setupActionContextMenus().catch((error) => {
      reportError('Failed to setup action menus on startup', error);
    });
  });
}

registerListeners();
void setupActionContextMenus().catch((error) => {
  reportError('Failed to setup action menus on boot', error);
});
