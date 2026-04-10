import { describe, expect, it } from 'vitest';

import { buildRestoreActionMessage } from './restoreActionMessage';

describe('buildRestoreActionMessage', () => {
  it('重複スキップがあり失敗がない場合は既存タブとの重複数を表示する', () => {
    const message = buildRestoreActionMessage('グループ', 3, 3, 0, 0, 2);

    expect(message).toBe('グループを復元しました（2件は既存タブと重複のためスキップ）。');
  });

  it('重複スキップと失敗がある場合は作成またはセッション復元した件数を表示する', () => {
    const message = buildRestoreActionMessage('タブ', 5, 4, 1, 1, 2);

    expect(message).toBe('5件中2件のタブを復元しました（2件は重複スキップ）。');
  });

  it('重複スキップがなく履歴付き復元がある場合は履歴付き件数を表示する', () => {
    const message = buildRestoreActionMessage('タブ', 4, 4, 0, 2, 0);

    expect(message).toBe('4件中2件が履歴付きで復元されました。');
  });

  it('単一タブの重複スキップは既存タブとの重複として表示する', () => {
    const message = buildRestoreActionMessage('タブ', 1, 1, 0, 0, 1);

    expect(message).toBe('タブを復元しました（1件は既存タブと重複のためスキップ）。');
  });
});
