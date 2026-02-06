import { describe, expect, it } from 'vitest';

import type { ManagerBinding } from '../tab-manager/types';
import { resolveRestoreTarget } from './restoreTarget';

describe('resolveRestoreTarget', () => {
  it('紐づけが現在の管理画面と一致する場合は bound-window を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 50 };

    const result = resolveRestoreTarget(binding, 10, 50);

    expect(result).toBe('bound-window');
  });

  it('タブIDが不一致の場合は new-window を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 50 };

    const result = resolveRestoreTarget(binding, 11, 50);

    expect(result).toBe('new-window');
  });

  it('ウィンドウIDが不一致の場合は new-window を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 50 };

    const result = resolveRestoreTarget(binding, 10, 51);

    expect(result).toBe('new-window');
  });

  it('紐づけが無い過去データは new-window を返す', () => {
    const result = resolveRestoreTarget(null, 10, 50);

    expect(result).toBe('new-window');
  });
});
