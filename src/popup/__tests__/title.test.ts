import { describe, expect, it } from 'vitest';

import { getPopupTitle } from '../title';

describe('getPopupTitle', () => {
  it('returns the default title', () => {
    expect(getPopupTitle()).toBe('Tab Manager');
  });
});
