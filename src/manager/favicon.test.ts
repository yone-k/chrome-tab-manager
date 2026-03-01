import { describe, expect, it } from 'vitest';

import { buildFaviconCandidates } from './favicon';

describe('buildFaviconCandidates', () => {
  it('保存済みfaviconを返す', () => {
    const candidates = buildFaviconCandidates({
      favIconUrl: 'https://example.com/favicon.ico',
    });

    expect(candidates).toEqual(['https://example.com/favicon.ico']);
  });

  it('保存値が chrome:// の場合は候補から除外する', () => {
    const candidates = buildFaviconCandidates({
      favIconUrl: 'chrome://favicon/',
    });

    expect(candidates).toEqual([]);
  });

  it('候補がない場合は空配列を返す', () => {
    const candidates = buildFaviconCandidates({
      favIconUrl: '   ',
    });

    expect(candidates).toEqual([]);
  });

  it('favIconUrlがundefinedの場合は空配列を返す', () => {
    const candidates = buildFaviconCandidates({
      favIconUrl: undefined,
    });

    expect(candidates).toEqual([]);
  });
});
