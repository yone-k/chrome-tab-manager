import { describe, expect, it } from 'vitest';

import { resolveGroupTitleForCommit, resolveSetTitleForCommit } from './titleCommit';

describe('resolveSetTitleForCommit', () => {
  it('空文字確定時は変更前タイトルを維持する', () => {
    expect(resolveSetTitleForCommit('   ', '元のセット名')).toBe('元のセット名');
  });

  it('入力がある場合は正規化したタイトルを返す', () => {
    expect(resolveSetTitleForCommit('  新しいセット名  ', '元のセット名')).toBe('新しいセット名');
  });
});

describe('resolveGroupTitleForCommit', () => {
  it('空文字確定時は変更前タイトルを維持する', () => {
    expect(resolveGroupTitleForCommit('   ', '元のグループ名')).toBe('元のグループ名');
  });

  it('入力がある場合はtrimしたタイトルを返す', () => {
    expect(resolveGroupTitleForCommit('  新しいグループ名  ', '元のグループ名')).toBe(
      '新しいグループ名',
    );
  });
});
