import { describe, expect, it } from 'vitest';

import { shouldRelayWheelToPage } from './scrollRelay';

describe('shouldRelayWheelToPage', () => {
  it('上端で上方向スクロールならページへ受け渡す', () => {
    expect(
      shouldRelayWheelToPage({
        deltaY: -30,
        scrollTop: 0,
        clientHeight: 300,
        scrollHeight: 1200,
      }),
    ).toBe(true);
  });

  it('下端で下方向スクロールならページへ受け渡す', () => {
    expect(
      shouldRelayWheelToPage({
        deltaY: 30,
        scrollTop: 900,
        clientHeight: 300,
        scrollHeight: 1200,
      }),
    ).toBe(true);
  });

  it('中間位置ではページへ受け渡さない', () => {
    expect(
      shouldRelayWheelToPage({
        deltaY: 30,
        scrollTop: 200,
        clientHeight: 300,
        scrollHeight: 1200,
      }),
    ).toBe(false);
    expect(
      shouldRelayWheelToPage({
        deltaY: -30,
        scrollTop: 200,
        clientHeight: 300,
        scrollHeight: 1200,
      }),
    ).toBe(false);
  });

  it('スクロール不可でも方向に応じて終端扱いになる', () => {
    expect(
      shouldRelayWheelToPage({
        deltaY: 30,
        scrollTop: 0,
        clientHeight: 300,
        scrollHeight: 300,
      }),
    ).toBe(true);
    expect(
      shouldRelayWheelToPage({
        deltaY: -30,
        scrollTop: 0,
        clientHeight: 300,
        scrollHeight: 300,
      }),
    ).toBe(true);
  });
});
