import { describe, expect, it } from 'vitest';

import type { ManagerBinding } from '../tab-manager/types';
import { getBindingStatusLabel, resolveBindingStatus } from './bindingState';

describe('resolveBindingStatus', () => {
  it('紐づけがない場合は unbound を返す', () => {
    expect(resolveBindingStatus(null, { tabId: 10, windowId: 5 })).toBe('unbound');
  });

  it('現在管理画面と一致する場合は bound-current を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 5 };

    expect(resolveBindingStatus(binding, { tabId: 10, windowId: 5 })).toBe('bound-current');
  });

  it('現在管理画面と不一致の場合は bound-other を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 5 };

    expect(resolveBindingStatus(binding, { tabId: 11, windowId: 5 })).toBe('bound-other');
  });

  it('現在管理画面コンテキストを取得できない場合は bound-other を返す', () => {
    const binding: ManagerBinding = { managerTabId: 10, managerWindowId: 5 };

    expect(resolveBindingStatus(binding, null)).toBe('bound-other');
  });
});

describe('getBindingStatusLabel', () => {
  it('状態ラベルを返す', () => {
    expect(getBindingStatusLabel('bound-current')).toBe('この管理画面に接続中');
    expect(getBindingStatusLabel('bound-other')).toBe('他の管理画面に接続中');
    expect(getBindingStatusLabel('unbound')).toBe('未接続');
  });
});
