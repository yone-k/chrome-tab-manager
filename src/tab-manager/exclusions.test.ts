import { describe, expect, it } from 'vitest';

import { filterSavableTabs, matchesExclusion, normalizeExclusions } from './exclusions';

describe('normalizeExclusions', () => {
  it('前後の空白と空要素を除去し、大文字小文字を無視して重複を除く', () => {
    const result = normalizeExclusions([
      ' chrome:// ',
      '',
      'example.com',
      'EXAMPLE.com',
      'chrome://',
    ]);

    expect(result).toEqual(['chrome://', 'example.com']);
  });
});

describe('matchesExclusion', () => {
  it('スキーム形式の入力はプレフィックス一致で判定する', () => {
    const exclusions = normalizeExclusions(['chrome://', 'chrome-extension://']);

    expect(matchesExclusion('chrome://settings', exclusions)).toBe(true);
    expect(matchesExclusion('chrome-extension://abc/manager.html', exclusions)).toBe(true);
  });

  it('ホスト形式の入力はドメイン一致で判定する', () => {
    const exclusions = normalizeExclusions(['example.com']);

    expect(matchesExclusion('https://example.com', exclusions)).toBe(true);
    expect(matchesExclusion('https://sub.example.com/path', exclusions)).toBe(true);
    expect(matchesExclusion('https://example.org', exclusions)).toBe(false);
  });

  it('大文字小文字を区別しない', () => {
    const exclusions = normalizeExclusions(['Example.com']);

    expect(matchesExclusion('HTTPS://EXAMPLE.COM/page', exclusions)).toBe(true);
  });
});

describe('filterSavableTabs', () => {
  it('ピン留めと除外URLを除く', () => {
    const exclusions = normalizeExclusions(['chrome://', 'example.com']);
    const tabs = [
      { id: 1, url: 'https://example.com', pinned: false },
      { id: 2, url: 'https://ok.com', pinned: true },
      { id: 3, url: 'https://ok.com', pinned: false },
      { id: 4, url: 'chrome://settings', pinned: false },
      { id: 5, pendingUrl: 'https://ok.com', pinned: false },
      { id: 6, url: '', pinned: false },
    ];

    expect(filterSavableTabs(tabs, exclusions)).toEqual([
      { id: 3, url: 'https://ok.com', pinned: false },
      { id: 5, pendingUrl: 'https://ok.com', pinned: false },
    ]);
  });
});
