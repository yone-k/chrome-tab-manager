import { describe, expect, it } from 'vitest';

import { computeDropGapPx, DEFAULT_DROP_GAP_PX } from './dropGap';

describe('computeDropGapPx', () => {
  it('ドラッグした要素の高さをそのまま返す', () => {
    expect(computeDropGapPx(120)).toBe(120);
  });

  it('高さが不明な場合はデフォルトの隙間を返す', () => {
    expect(computeDropGapPx(undefined)).toBe(DEFAULT_DROP_GAP_PX);
  });

  it('高さが0以下ならデフォルトの隙間を返す', () => {
    expect(computeDropGapPx(0)).toBe(DEFAULT_DROP_GAP_PX);
  });
});
