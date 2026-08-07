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
type TouchEventName = 'touchmove' | 'touchend';

/**
 * A finger never holds fully still. Movement below this counts as a tap, not a
 * drag.
 */
const TAP_SLOP_PX = 8;

/** The slice of an element the gesture needs — kept narrow so tests can fake it. */
interface TouchScrollTarget {
  clientHeight: number;
  addEventListener(type: PointerEventName, listener: PointerListener): void;
  addEventListener(type: TouchEventName, listener: TouchListener, options: AddEventListenerOptions): void;
  removeEventListener(type: PointerEventName, listener: PointerListener): void;
  removeEventListener(type: TouchEventName, listener: TouchListener, options: EventListenerOptions): void;
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

interface TouchScrollOptions {
  /** Read per move, so a mid-gesture resize uses the current row height. */
  rows: () => number;
  scrollLines: (lines: number) => void;
  /** Called once per gesture, as soon as the touch counts as a drag. */
  onDragStart?: () => void;
}

/**
 * Scroll a terminal by touch drag, from anywhere in the pane.
 *
 * Pointer events with an explicit capture, not touch events: capturing on the
 * element routes the whole gesture there whatever the renderer does to the
 * original target — which is what made this survive xterm re-rendering the row
 * under the finger and killing the drag on iOS Safari. The element must also
 * carry a `touch-action` that forbids panning, or the browser claims the gesture
 * and cancels the pointer stream.
 *
 * Returns a dispose function.
 */
export function attachTouchScroll(
  element: TouchScrollTarget,
  { rows, scrollLines, onDragStart }: TouchScrollOptions,
): () => void {
  const tracker = createTouchScrollTracker();
  let startY = 0;
  let dragged = false;

  const onPointerDown: PointerListener = (event) => {
    // A second finger returns here on purpose. It must not restart the gesture,
    // or a pinch clears the drag state the primary finger built.
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    element.setPointerCapture(event.pointerId);
    tracker.start(event.clientY);
    startY = event.clientY;
    dragged = false;
  };

  const onPointerMove: PointerListener = (event) => {
    if (event.pointerType !== 'touch' || !element.hasPointerCapture(event.pointerId)) return;
    if (!dragged && Math.abs(event.clientY - startY) > TAP_SLOP_PX) {
      dragged = true;
      onDragStart?.();
    }
    const lines = tracker.advance(event.clientY, element.clientHeight / rows());
    if (lines !== 0) scrollLines(lines);
  };

  const onPointerRelease: PointerListener = (event) => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };

  // Keeps a renderer that scrolls its own viewport from touchmove from doubling
  // the distance of every drag. It never sees the gesture now.
  const swallowTouchMove: TouchListener = (event) => event.stopPropagation();

  // The emulator focuses its hidden input on every touchend, which opens the
  // on-screen keyboard. A drag thus made the keyboard cover the pane the user
  // was reading. Keep the end of a drag away from that handler; a tap still
  // reaches it, and still opens the keyboard to type. preventDefault also stops
  // the synthetic mouse events, which reach the same handler by another route.
  const swallowTouchEnd: TouchListener = (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerRelease);
  element.addEventListener('pointercancel', onPointerRelease);
  element.addEventListener('touchmove', swallowTouchMove, { capture: true, passive: true });
  element.addEventListener('touchend', swallowTouchEnd, { capture: true });

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerRelease);
    element.removeEventListener('pointercancel', onPointerRelease);
    element.removeEventListener('touchmove', swallowTouchMove, { capture: true });
    element.removeEventListener('touchend', swallowTouchEnd, { capture: true });
  };
}
