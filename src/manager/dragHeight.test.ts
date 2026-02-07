import { describe, expect, it } from 'vitest';

import { selectDragItemHeight } from './dragHeight';

describe('selectDragItemHeight', () => {
  it('イベント由来の高さを最優先で使用する', () => {
    expect(
      selectDragItemHeight({
        eventTargetHeight: 120,
        rectInitialHeight: 80,
        rectTranslatedHeight: 90,
      }),
    ).toBe(120);
  });

  it('イベント由来が無い場合は初期矩形の高さを使う', () => {
    expect(
      selectDragItemHeight({
        eventTargetHeight: null,
        rectInitialHeight: 84,
        rectTranslatedHeight: 96,
      }),
    ).toBe(84);
  });

  it('初期矩形が無い場合は移動矩形の高さを使う', () => {
    expect(
      selectDragItemHeight({
        eventTargetHeight: undefined,
        rectInitialHeight: null,
        rectTranslatedHeight: 72,
      }),
    ).toBe(72);
  });

  it('有効な高さが無い場合はnullを返す', () => {
    expect(
      selectDragItemHeight({
        eventTargetHeight: 0,
        rectInitialHeight: undefined,
        rectTranslatedHeight: null,
      }),
    ).toBeNull();
  });
});
