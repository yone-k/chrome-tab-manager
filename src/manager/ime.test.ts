import { describe, expect, it } from 'vitest';

import { shouldIgnoreEnterForIme } from './ime';

describe('shouldIgnoreEnterForIme', () => {
  it('Enter以外は無視しない', () => {
    expect(shouldIgnoreEnterForIme({ key: 'Escape' })).toBe(false);
  });

  it('isComposing中のEnterは無視する', () => {
    expect(shouldIgnoreEnterForIme({ key: 'Enter', isComposing: true })).toBe(true);
  });

  it('nativeEvent.isComposing中のEnterは無視する', () => {
    expect(
      shouldIgnoreEnterForIme({
        key: 'Enter',
        nativeEvent: { isComposing: true },
      }),
    ).toBe(true);
  });

  it('IME keyCode(229)のEnterは無視する', () => {
    expect(shouldIgnoreEnterForIme({ key: 'Enter', keyCode: 229 })).toBe(true);
    expect(
      shouldIgnoreEnterForIme({
        key: 'Enter',
        nativeEvent: { keyCode: 229 },
      }),
    ).toBe(true);
  });

  it('通常のEnterは無視しない', () => {
    expect(shouldIgnoreEnterForIme({ key: 'Enter', keyCode: 13 })).toBe(false);
  });
});
