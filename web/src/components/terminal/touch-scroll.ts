interface TouchScrollTracker {
  /** Begin a drag at a viewport y coordinate. */
  start: (y: number) => void;
  /**
   * Continue the drag to a new y coordinate and report how many whole lines the
   * buffer should scroll (positive = towards the bottom). Sub-line movement is
   * carried over so slow drags still accumulate into a scroll.
   */
  advance: (y: number, rowHeight: number) => number;
}

export function createTouchScrollTracker(): TouchScrollTracker {
  let lastY = 0;
  let remainder = 0;

  return {
    start: (y) => {
      lastY = y;
      remainder = 0;
    },
    advance: (y, rowHeight) => {
      const deltaPx = lastY - y;
      lastY = y;
      if (rowHeight <= 0) return 0;
      remainder += deltaPx / rowHeight;
      const lines = Math.trunc(remainder);
      remainder -= lines;
      return lines;
    },
  };
}
