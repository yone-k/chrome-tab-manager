import { describe, expect, it } from 'vitest';

import { DEFAULT_RESTORE_LOADING_THRESHOLD, shouldSuppressRestoreLoading } from './restorePolicy';

describe('restorePolicy', () => {
  it('suppresses loading when enabled and tab count meets threshold', () => {
    const result = shouldSuppressRestoreLoading({
      enabled: true,
      tabCount: DEFAULT_RESTORE_LOADING_THRESHOLD,
    });

    expect(result).toBe(true);
  });

  it('does not suppress loading when disabled', () => {
    const result = shouldSuppressRestoreLoading({ enabled: false, tabCount: 5 });

    expect(result).toBe(false);
  });

  it('does not suppress loading when below threshold', () => {
    const result = shouldSuppressRestoreLoading({ enabled: true, tabCount: 1 });

    expect(result).toBe(false);
  });
});
