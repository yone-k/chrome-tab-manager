import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRecentlyClosedSessions, matchSessionIds } from './sessions';

describe('getRecentlyClosedSessions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('maxResults なしで chrome.sessions.getRecentlyClosed を呼ぶ', async () => {
    const mockSessions: chrome.sessions.Session[] = [];
    const getRecentlyClosed = vi.fn().mockResolvedValue(mockSessions);
    vi.stubGlobal('chrome', {
      sessions: { getRecentlyClosed },
    });

    const result = await getRecentlyClosedSessions();

    expect(getRecentlyClosed).toHaveBeenCalledWith({});
    expect(result).toBe(mockSessions);
  });

  it('maxResults ありで chrome.sessions.getRecentlyClosed を呼ぶ', async () => {
    const mockSessions: chrome.sessions.Session[] = [];
    const getRecentlyClosed = vi.fn().mockResolvedValue(mockSessions);
    vi.stubGlobal('chrome', {
      sessions: { getRecentlyClosed },
    });

    const result = await getRecentlyClosedSessions(10);

    expect(getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 10 });
    expect(result).toBe(mockSessions);
  });
});

describe('matchSessionIds', () => {
  it('基本的な URL 一致マッチング', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: 'ses-1' } },
      { tab: { url: 'https://b.example.com', sessionId: 'ses-2' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com', 'https://b.example.com'], sessions);

    expect(result.size).toBe(2);
    expect(result.get(0)).toBe('ses-1');
    expect(result.get(1)).toBe('ses-2');
  });

  it('session.tab のあるエントリのみマッチする（session.window は無視）', () => {
    const sessions = [
      {
        window: {
          id: 1,
          tabs: [{ url: 'https://a.example.com' }],
        },
      },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-tab' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-tab');
  });

  it('同一 URL が複数ある場合の貪欲マッチ（配列の先頭から順にマッチ）', () => {
    const sessions = [
      { tab: { url: 'https://dup.example.com', sessionId: 'ses-newest' } },
      { tab: { url: 'https://dup.example.com', sessionId: 'ses-older' } },
      { tab: { url: 'https://dup.example.com', sessionId: 'ses-oldest' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(
      ['https://dup.example.com', 'https://dup.example.com'],
      sessions,
    );

    expect(result.size).toBe(2);
    expect(result.get(0)).toBe('ses-newest');
    expect(result.get(1)).toBe('ses-older');
  });

  it('マッチしない URL がある場合は Map に含まれない', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: 'ses-1' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(
      ['https://a.example.com', 'https://no-match.example.com'],
      sessions,
    );

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-1');
    expect(result.has(1)).toBe(false);
  });

  it('sessionId がないセッションはスキップする', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: undefined } },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-valid' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-valid');
  });

  it('空の入力に対して空の Map を返す', () => {
    const result = matchSessionIds([], []);

    expect(result.size).toBe(0);
  });

  it('25件超のタブを閉じた場合、セッション数が足りない分はマッチしない', () => {
    const urls = Array.from({ length: 30 }, (_, i) => `https://tab${i}.example.com`);
    // Chrome は約25件までしかセッションを保持しない想定
    const sessions = urls.slice(0, 25).map((url, i) => ({
      tab: { url, sessionId: `ses-${i}` },
    })) as chrome.sessions.Session[];

    const result = matchSessionIds(urls, sessions);

    expect(result.size).toBe(25);
    for (let i = 0; i < 25; i++) {
      expect(result.get(i)).toBe(`ses-${i}`);
    }
    for (let i = 25; i < 30; i++) {
      expect(result.has(i)).toBe(false);
    }
  });

  it('リダイレクト等でURLが変わったタブはマッチ不成立', () => {
    const sessions = [
      { tab: { url: 'https://redirected.example.com/final', sessionId: 'ses-redirect' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://original.example.com/start'], sessions);

    expect(result.size).toBe(0);
  });

  it('同一URL複数タブ保存時、セッション順序に基づく貪欲マッチで重複なく割り当てる', () => {
    // ensureManagerTabInWindow でインデックスがシフトしても URL マッチには影響しない
    const sessions = [
      { tab: { url: 'https://same.example.com', sessionId: 'ses-3' } },
      { tab: { url: 'https://same.example.com', sessionId: 'ses-2' } },
      { tab: { url: 'https://same.example.com', sessionId: 'ses-1' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(
      ['https://same.example.com', 'https://same.example.com', 'https://same.example.com'],
      sessions,
    );

    expect(result.size).toBe(3);
    // 各 URL に異なる sessionId が割り当てられる
    const assignedIds = new Set([result.get(0), result.get(1), result.get(2)]);
    expect(assignedIds.size).toBe(3);
    // 貪欲マッチなので先頭から順に割り当て
    expect(result.get(0)).toBe('ses-3');
    expect(result.get(1)).toBe('ses-2');
    expect(result.get(2)).toBe('ses-1');
  });

  it('session.tab.sessionId が null の場合はスキップする', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: null } },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-valid' } },
    ] as unknown as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-valid');
  });

  it('session.tab.url が undefined の場合はマッチしない', () => {
    const sessions = [
      { tab: { sessionId: 'ses-no-url' } },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-with-url' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-with-url');
  });

  it('session.tab.url が空文字の場合は空文字 URL とのみマッチする', () => {
    const sessions = [
      { tab: { url: '', sessionId: 'ses-empty-url' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com', ''], sessions);

    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(false);
    expect(result.get(1)).toBe('ses-empty-url');
  });

  it('closedTabUrls に同じ URL が先に現れたものから貪欲消費される', () => {
    // セッションが1つしかない場合、最初のURL にマッチして2番目は余る
    const sessions = [
      { tab: { url: 'https://dup.example.com', sessionId: 'ses-only-one' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(
      ['https://dup.example.com', 'https://dup.example.com'],
      sessions,
    );

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-only-one');
    expect(result.has(1)).toBe(false);
  });

  it('session に tab と window の両プロパティがある場合は tab としてマッチする', () => {
    // 現実の Chrome API では起きにくいが、型上は可能
    const sessions = [
      {
        tab: { url: 'https://a.example.com', sessionId: 'ses-both' },
        window: { id: 99 },
      },
    ] as unknown as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-both');
  });

  it('tab セッションと window セッションが混在しても window の sessionId は選ばれない', () => {
    const sessions = [
      {
        window: {
          id: 1,
          sessionId: 'ses-window',
          tabs: [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }],
        },
      },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-tab-a' } },
      {
        window: {
          id: 2,
          sessionId: 'ses-window-2',
          tabs: [{ url: 'https://b.example.com' }],
        },
      },
      { tab: { url: 'https://b.example.com', sessionId: 'ses-tab-b' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com', 'https://b.example.com'], sessions);

    expect(result.size).toBe(2);
    expect(result.get(0)).toBe('ses-tab-a');
    expect(result.get(1)).toBe('ses-tab-b');
  });

  it('session.tab.sessionId が空文字の場合はスキップする', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: '' } },
      { tab: { url: 'https://a.example.com', sessionId: 'ses-valid' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://a.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-valid');
  });

  it('closedTabUrls が sessions より多い場合、余った URL はマッチしない', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: 'ses-a' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(
      ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
      sessions,
    );

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-a');
  });

  it('sessions が closedTabUrls より多い場合、余ったセッションは無視される', () => {
    const sessions = [
      { tab: { url: 'https://a.example.com', sessionId: 'ses-a' } },
      { tab: { url: 'https://b.example.com', sessionId: 'ses-b' } },
      { tab: { url: 'https://c.example.com', sessionId: 'ses-c' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://b.example.com'], sessions);

    expect(result.size).toBe(1);
    expect(result.get(0)).toBe('ses-b');
  });

  it('URL が大文字小文字で異なる場合はマッチしない（完全一致）', () => {
    const sessions = [
      { tab: { url: 'https://Example.COM/Page', sessionId: 'ses-upper' } },
    ] as chrome.sessions.Session[];

    const result = matchSessionIds(['https://example.com/page'], sessions);

    expect(result.size).toBe(0);
  });

  it('URL にクエリ文字列やフラグメントがある場合も完全一致のみ', () => {
    const sessions = [
      { tab: { url: 'https://example.com/page?key=value', sessionId: 'ses-query' } },
    ] as chrome.sessions.Session[];

    // クエリなし URL はマッチしない
    const result1 = matchSessionIds(['https://example.com/page'], sessions);
    expect(result1.size).toBe(0);

    // 完全一致のみマッチ
    const result2 = matchSessionIds(['https://example.com/page?key=value'], sessions);
    expect(result2.size).toBe(1);
    expect(result2.get(0)).toBe('ses-query');
  });

  it('session.tab が存在するが url フィールドがない場合でもクラッシュしない', () => {
    const sessions = [{ tab: { sessionId: 'ses-no-url' } }] as chrome.sessions.Session[];

    // undefined === 'https://...' は false なのでクラッシュせずスキップ
    const result = matchSessionIds(['https://example.com'], sessions);
    expect(result.size).toBe(0);
  });
});
