import { describe, expect, it } from 'vitest';

import managerAppSource from './ManagerApp.tsx?raw';

function getRestoreGroupHandlerSource() {
  const start = managerAppSource.indexOf('const handleRestoreGroup = async');
  const end = managerAppSource.indexOf('const handleRestoreTab = async', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return managerAppSource.slice(start, end);
}

describe('ManagerApp handleRestoreGroup', () => {
  it('グループ復元先を現在の管理画面との紐づけ状態から判定する', () => {
    const source = getRestoreGroupHandlerSource();

    expect(source).toContain('const currentManager = await getCurrentManagerContext()');
    expect(source).toContain('const restoreTarget = resolveRestoreTarget(');
    expect(source).toContain('targetSet.managerBinding');
    expect(source).toContain('currentManager.tabId');
    expect(source).toContain('currentManager.windowId');
    expect(source).toContain(
      "const restoreWindow = restoreTarget === 'new-window' ? await createRestoreWindow() : null",
    );
    expect(source).not.toContain('getCurrentWindowId()');
  });

  it('bound-current は現在の管理画面ウィンドウ、unbound と bound-other は新規ウィンドウへ復元する', () => {
    const source = getRestoreGroupHandlerSource();

    expect(source).toContain('const windowId = restoreWindow?.windowId ?? currentManager.windowId');
    expect(source).toContain('const baseTabIndex = await getWindowTabCount(windowId)');
    expect(source).toContain('windowId');
  });

  it('復元対象タブがない場合は復元先ウィンドウの解決前に終了する', () => {
    const source = getRestoreGroupHandlerSource();
    const tabsIndex = source.indexOf(
      'const tabs = targetSet.tabs.filter((tab) => tab.groupId === groupId)',
    );
    const emptyTabsIndex = source.indexOf('if (tabs.length === 0)');
    const currentManagerIndex = source.indexOf(
      'const currentManager = await getCurrentManagerContext()',
    );
    const createRestoreWindowIndex = source.indexOf('await createRestoreWindow()');
    const getWindowTabCountIndex = source.indexOf('await getWindowTabCount(windowId)');

    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(emptyTabsIndex).toBeGreaterThan(tabsIndex);
    expect(currentManagerIndex).toBeGreaterThan(emptyTabsIndex);
    expect(createRestoreWindowIndex).toBeGreaterThan(emptyTabsIndex);
    expect(getWindowTabCountIndex).toBeGreaterThan(emptyTabsIndex);
  });

  it('新規復元ウィンドウの初期タブをグループ復元後に削除する', () => {
    const source = getRestoreGroupHandlerSource();
    const restoreTabsIndex = source.indexOf(
      'const { restoredTabs, failedTabs, sessionRestoredCount }',
    );
    const removeInitialTabIndex = source.indexOf(
      'await removeInitialRestoreTab(restoreWindow.initialTabId)',
    );
    const cleanupIndex = source.indexOf('if (removeRestoredTabsEnabled)');

    expect(restoreTabsIndex).toBeGreaterThanOrEqual(0);
    expect(removeInitialTabIndex).toBeGreaterThan(restoreTabsIndex);
    expect(cleanupIndex).toBeGreaterThan(removeInitialTabIndex);
  });

  it('初期タブ削除処理は共通ヘルパーに集約する', () => {
    expect(managerAppSource).toContain(
      'async function removeInitialRestoreTab(initialTabId: number | null)',
    );
    expect(managerAppSource).not.toContain('async function removeInitialRestoreTab(restoreWindow');
    expect(managerAppSource).not.toContain('await removeInitialRestoreTab(restoreWindow)');
    expect(managerAppSource).toContain(
      "console.error('Failed to remove initial tab in restore window', err)",
    );
  });
});
