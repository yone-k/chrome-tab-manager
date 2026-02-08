import { describe, expect, it } from 'vitest';

import { resolveScrollFadeState } from './scrollFade';

describe('resolveScrollFadeState', () => {
  it('スクロール不能なら上下フェードを表示しない', () => {
    const state = resolveScrollFadeState({
      scrollTop: 0,
      scrollHeight: 200,
      clientHeight: 200,
    });

    expect(state.isScrollable).toBe(false);
    expect(state.showTopFade).toBe(false);
    expect(state.showBottomFade).toBe(false);
  });

  it('先頭位置なら下フェードのみ表示する', () => {
    const state = resolveScrollFadeState({
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 200,
    });

    expect(state.isScrollable).toBe(true);
    expect(state.isAtTop).toBe(true);
    expect(state.isAtBottom).toBe(false);
    expect(state.showTopFade).toBe(false);
    expect(state.showBottomFade).toBe(true);
  });

  it('中間位置なら上下フェードを表示する', () => {
    const state = resolveScrollFadeState({
      scrollTop: 100,
      scrollHeight: 500,
      clientHeight: 200,
    });

    expect(state.showTopFade).toBe(true);
    expect(state.showBottomFade).toBe(true);
  });

  it('末尾位置なら上フェードのみ表示する', () => {
    const state = resolveScrollFadeState({
      scrollTop: 300,
      scrollHeight: 500,
      clientHeight: 200,
    });

    expect(state.isAtTop).toBe(false);
    expect(state.isAtBottom).toBe(true);
    expect(state.showTopFade).toBe(true);
    expect(state.showBottomFade).toBe(false);
  });
});
