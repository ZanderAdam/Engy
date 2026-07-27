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

type PointerListener = (event: PointerEvent) => void;
type TouchListener = (event: TouchEvent) => void;

type PointerEventName = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/** The slice of an element the gesture needs — kept narrow so tests can fake it. */
interface TouchScrollTarget {
  clientHeight: number;
  addEventListener(type: PointerEventName, listener: PointerListener): void;
  addEventListener(type: 'touchmove', listener: TouchListener, options: AddEventListenerOptions): void;
  removeEventListener(type: PointerEventName, listener: PointerListener): void;
  removeEventListener(type: 'touchmove', listener: TouchListener, options: EventListenerOptions): void;
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

interface TouchScrollOptions {
  /** Read per move, so a mid-gesture resize uses the current row height. */
  rows: () => number;
  scrollLines: (lines: number) => void;
}

/**
 * Scroll a terminal by touch drag, from anywhere in the pane.
 *
 * Pointer events with an explicit capture, not touch events: a finger lands on a
 * `<span>` inside a row, and the first line scrolled makes xterm re-render that
 * row and destroy the span. iOS Safari then stops delivering the gesture, so the
 * drag dies after one line — Chrome retargets detached nodes and keeps going,
 * which is why this only reproduces on a device. Capturing on the element routes
 * the rest of the gesture there whatever the renderer does to the original
 * target. The element must also carry a `touch-action` that forbids panning, or
 * the browser claims the gesture and cancels the pointer stream.
 *
 * Returns a dispose function.
 */
export function attachTouchScroll(
  element: TouchScrollTarget,
  { rows, scrollLines }: TouchScrollOptions,
): () => void {
  const tracker = createTouchScrollTracker();

  const onPointerDown: PointerListener = (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    element.setPointerCapture(event.pointerId);
    tracker.start(event.clientY);
  };

  const onPointerMove: PointerListener = (event) => {
    if (event.pointerType !== 'touch' || !element.hasPointerCapture(event.pointerId)) return;
    const lines = tracker.advance(event.clientY, element.clientHeight / rows());
    if (lines !== 0) scrollLines(lines);
  };

  const onPointerRelease: PointerListener = (event) => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };

  // xterm scrolls its own viewport from touchmove, which would double the
  // distance of every drag. It never sees the gesture now.
  const swallowTouch: TouchListener = (event) => event.stopPropagation();

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerRelease);
  element.addEventListener('pointercancel', onPointerRelease);
  element.addEventListener('touchmove', swallowTouch, { capture: true, passive: true });

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerRelease);
    element.removeEventListener('pointercancel', onPointerRelease);
    element.removeEventListener('touchmove', swallowTouch, { capture: true });
  };
}
