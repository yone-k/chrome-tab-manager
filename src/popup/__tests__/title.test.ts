import { describe, expect, it } from 'vitest';

import { getPopupTitle } from '../title';

describe('getPopupTitle', () => {
  it('デフォルトのタイトルを返す', () => {
    expect(getPopupTitle()).toBe('タブマネージャー');
  });
});
