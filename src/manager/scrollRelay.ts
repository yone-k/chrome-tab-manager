export type ScrollRelayParams = {
  deltaY: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

const EDGE_EPSILON_PX = 1;

export function shouldRelayWheelToPage({
  deltaY,
  scrollTop,
  clientHeight,
  scrollHeight,
}: ScrollRelayParams) {
  if (deltaY === 0) {
    return false;
  }

  const isAtTop = scrollTop <= EDGE_EPSILON_PX;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - EDGE_EPSILON_PX;

  return deltaY < 0 ? isAtTop : isAtBottom;
}
