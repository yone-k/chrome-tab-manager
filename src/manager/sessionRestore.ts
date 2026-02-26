/**
 * chrome.sessions.restore() の Promise ラッパー
 * 復元された Session を返す
 */
export async function restoreSession(sessionId: string): Promise<chrome.sessions.Session> {
  return chrome.sessions.restore(sessionId);
}

/**
 * chrome.tabs.move() の Promise ラッパー
 */
export async function moveTabToWindow(
  tabId: number,
  windowId: number,
  index: number,
): Promise<chrome.tabs.Tab> {
  const result = await chrome.tabs.move(tabId, { windowId, index });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * chrome.tabs.ungroup() の Promise ラッパー
 * sessions.restore() で復元されたタブが既存グループに属している場合に使用
 */
export async function ungroupTab(tabId: number): Promise<void> {
  await chrome.tabs.ungroup([tabId]);
}
