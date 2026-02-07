import { describe, expect, it } from 'vitest';

import { matchesExpectedUrl, normalizeComparableUrl } from './urlMatch';

describe('urlMatch', () => {
  it('末尾スラッシュ差分を正規化して一致扱いにする', () => {
    expect(normalizeComparableUrl('https://example.com/path/')).toBe(
      normalizeComparableUrl('https://example.com/path'),
    );
  });

  it('ハッシュ差分を無視して一致扱いにする', () => {
    expect(normalizeComparableUrl('https://example.com/path?a=1#x')).toBe(
      normalizeComparableUrl('https://example.com/path?a=1#y'),
    );
  });

  it('changeInfo.url が一致していれば true を返す', () => {
    const tab = { url: 'https://example.com/other' } as chrome.tabs.Tab;
    const changeInfo = { url: 'https://example.com/path/' } as chrome.tabs.TabChangeInfo;
    expect(matchesExpectedUrl('https://example.com/path', tab, changeInfo)).toBe(true);
  });

  it('正規化後も異なる URL は false を返す', () => {
    const tab = { url: 'https://example.com/b' } as chrome.tabs.Tab;
    expect(matchesExpectedUrl('https://example.com/a', tab)).toBe(false);
  });
});
