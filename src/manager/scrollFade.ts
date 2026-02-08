type ScrollFadeMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type ScrollFadeState = {
  isScrollable: boolean;
  isAtTop: boolean;
  isAtBottom: boolean;
  showTopFade: boolean;
  showBottomFade: boolean;
};

export function resolveScrollFadeState({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollFadeMetrics): ScrollFadeState {
  const isScrollable = scrollHeight > clientHeight;
  const isAtTop = scrollTop <= 1;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  return {
    isScrollable,
    isAtTop,
    isAtBottom,
    showTopFade: isScrollable && !isAtTop,
    showBottomFade: isScrollable && !isAtBottom,
  };
}
