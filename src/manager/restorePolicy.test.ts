import { describe, expect, it } from 'vitest';

import { shouldSuppressRestoreLoading } from './restorePolicy';

describe('restorePolicy', () => {
  it('有効で閾値以上のタブ数なら読み込みを抑制する', () => {
    const result = shouldSuppressRestoreLoading({
      enabled: true,
      tabCount: 2,
    });

    expect(result).toBe(true);
  });

  it('無効なら読み込みを抑制しない', () => {
    const result = shouldSuppressRestoreLoading({ enabled: false, tabCount: 5 });

    expect(result).toBe(false);
  });

  it('閾値未満なら読み込みを抑制しない', () => {
    const result = shouldSuppressRestoreLoading({ enabled: true, tabCount: 1 });

    expect(result).toBe(false);
  });
});
