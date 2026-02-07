import { describe, expect, it, vi } from 'vitest';

import {
  applyThemeToDocument,
  getSystemPrefersDark,
  resolveTheme,
  subscribeSystemThemeChange,
  type MatchMediaLike,
  type MediaQueryListLike,
} from './theme';

describe('resolveTheme', () => {
  it('ライトモードは常に light を返す', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('ダークモードは常に dark を返す', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('システム準拠は prefersDark に従う', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('getSystemPrefersDark', () => {
  it('matchMedia の結果を返す', () => {
    const matchMedia: MatchMediaLike = () => ({ matches: true });
    expect(getSystemPrefersDark(matchMedia)).toBe(true);
  });
});

describe('applyThemeToDocument', () => {
  it('data-theme と colorScheme を適用する', () => {
    const doc = {
      documentElement: {
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
      },
    } as unknown as Document;
    applyThemeToDocument('dark', doc);

    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('subscribeSystemThemeChange', () => {
  it('addEventListener がある場合は change を購読し解除できる', () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const addEventListener = vi.fn(
      (_type: 'change', candidate: (event: { matches: boolean }) => void) => {
        listeners.push(candidate);
      },
    );
    const removeEventListener = vi.fn();
    const matchMedia: MatchMediaLike = () =>
      ({
        matches: false,
        addEventListener,
        removeEventListener,
      }) as MediaQueryListLike;

    const onChange = vi.fn();
    const unsubscribe = subscribeSystemThemeChange(onChange, matchMedia);
    const [listener] = listeners;
    if (!listener) {
      throw new Error('listener was not registered');
    }
    listener({ matches: true });

    expect(onChange).toHaveBeenCalledWith(true);
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('legacy addListener/removeListener でも購読し解除できる', () => {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    const addListener = vi.fn((candidate: (event: { matches: boolean }) => void) => {
      listeners.push(candidate);
    });
    const removeListener = vi.fn();
    const matchMedia: MatchMediaLike = () =>
      ({
        matches: false,
        addListener,
        removeListener,
      }) as MediaQueryListLike;

    const onChange = vi.fn();
    const unsubscribe = subscribeSystemThemeChange(onChange, matchMedia);
    const [listener] = listeners;
    if (!listener) {
      throw new Error('listener was not registered');
    }
    listener({ matches: false });

    expect(onChange).toHaveBeenCalledWith(false);
    unsubscribe();
    expect(removeListener).toHaveBeenCalled();
  });
});
