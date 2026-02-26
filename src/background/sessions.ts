/**
 * chrome.sessions.getRecentlyClosed() の Promise ラッパー
 */
export async function getRecentlyClosedSessions(
  maxResults?: number,
): Promise<chrome.sessions.Session[]> {
  return chrome.sessions.getRecentlyClosed(maxResults !== undefined ? { maxResults } : {});
}

/**
 * 閉じたタブの URL 配列と RecentlyClosed セッションをマッチングし、
 * Map<number, string> (key: closedTabUrls 配列のインデックス, value: sessionId) を返す。
 *
 * - session.tab を持つエントリのみ対象（window セッションは除外）
 * - URL 完全一致でマッチング
 * - 同一 URL のタブが複数ある場合は getRecentlyClosed() の返却順序（最新が先頭）に基づく貪欲マッチ
 */
export function matchSessionIds(
  closedTabUrls: string[],
  sessions: chrome.sessions.Session[],
): Map<number, string> {
  const result = new Map<number, string>();

  // セッションから tab セッションのみ抽出（window セッションは除外）
  // 各セッションは1回だけ使用（貪欲マッチ）
  // セッションから tab セッションかつ有効な sessionId を持つものだけ抽出
  type TabSessionEntry = { url: string | undefined; sessionId: string };
  const availableSessions: TabSessionEntry[] = [];
  for (const s of sessions) {
    if (s.tab !== undefined && typeof s.tab.sessionId === 'string' && s.tab.sessionId.length > 0) {
      availableSessions.push({ url: s.tab.url, sessionId: s.tab.sessionId });
    }
  }

  const usedSessionIndices = new Set<number>();

  for (let urlIdx = 0; urlIdx < closedTabUrls.length; urlIdx++) {
    const url = closedTabUrls[urlIdx];
    for (let sesIdx = 0; sesIdx < availableSessions.length; sesIdx++) {
      if (usedSessionIndices.has(sesIdx)) continue;
      const entry = availableSessions[sesIdx];
      if (entry.url === url) {
        result.set(urlIdx, entry.sessionId);
        usedSessionIndices.add(sesIdx);
        break;
      }
    }
  }

  return result;
}
