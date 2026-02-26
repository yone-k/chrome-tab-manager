import { useCallback, useEffect, useRef, useState } from 'react';

import { clampCardHeight } from '../tab-manager/storage';

type UseCardResizeOptions = {
  onHeightChange: (height: number) => void;
};

type UseCardResizeResult = {
  resizingHeight: number | null;
  handleResizeStart: (event: React.MouseEvent) => void;
  isResizing: boolean;
};

export function useCardResize({
  onHeightChange,
}: UseCardResizeOptions): UseCardResizeResult {
  const [resizingHeight, setResizingHeight] = useState<number | null>(null);
  const isResizing = resizingHeight !== null;
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      const card = (event.target as HTMLElement).closest('.manager__card');
      if (!card) {
        return;
      }
      const initialHeight = card.getBoundingClientRect().height;
      startYRef.current = event.clientY;
      startHeightRef.current = initialHeight;

      const clamped = clampCardHeight(initialHeight);
      if (clamped !== null) {
        setResizingHeight(clamped);
      }

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    },
    [],
  );

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaY = event.clientY - startYRef.current;
      const nextHeight = startHeightRef.current + deltaY;
      const clamped = clampCardHeight(nextHeight);
      if (clamped !== null) {
        setResizingHeight(clamped);
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const deltaY = event.clientY - startYRef.current;
      const nextHeight = startHeightRef.current + deltaY;
      const clamped = clampCardHeight(nextHeight);
      if (clamped !== null) {
        onHeightChangeRef.current(clamped);
      }
      setResizingHeight(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  return { resizingHeight, handleResizeStart, isResizing };
}
