export function resolveCardClassName(isDragging: boolean, isBoundCurrent: boolean): string {
  let className = 'manager__card';
  if (isDragging) className += ' manager__card--dragging';
  if (isBoundCurrent) className += ' manager__card--linked';
  return className;
}
