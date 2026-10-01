import { useEffect, useState, type RefObject } from 'react';

const NARROW_BELOW_PX = 720;

export function useContainerNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < NARROW_BELOW_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return isNarrow;
}
