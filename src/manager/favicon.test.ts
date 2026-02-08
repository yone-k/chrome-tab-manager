import { describe, expect, it } from 'vitest';

import { buildFaviconCandidates } from './favicon';

describe('buildFaviconCandidates', () => {
  const extensionId = 'test-extension-id';

  it('保存済みfaviconを優先してURLフォールバックを続ける', () => {
    const candidates = buildFaviconCandidates(
      {
        favIconUrl: 'https://example.com/favicon.ico',
        url: 'https://example.com/page',
      },
      { extensionId },
    );

    expect(candidates).toEqual([
      'https://example.com/favicon.ico',
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpage&size=16',
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=16',
    ]);
  });

  it('保存値が chrome:// の場合は候補から除外する', () => {
    const candidates = buildFaviconCandidates(
      {
        favIconUrl: 'chrome://favicon/',
        url: 'https://example.com/page',
      },
      { extensionId },
    );

    expect(candidates).toEqual([
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpage&size=16',
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=16',
    ]);
  });

  it('重複候補を1つにまとめる', () => {
    const fallback =
      'chrome-extension://test-extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=16';
    const candidates = buildFaviconCandidates(
      {
        favIconUrl: fallback,
        url: 'https://example.com',
      },
      { extensionId },
    );

    expect(candidates).toEqual([fallback]);
  });

  it('候補がない場合は空配列を返す', () => {
    const candidates = buildFaviconCandidates({
      favIconUrl: '   ',
      url: '',
    });

    expect(candidates).toEqual([]);
  });
});
