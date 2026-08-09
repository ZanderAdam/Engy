import type { Terminal } from 'ghostty-web';

/** Gap between the track and the pane edges, in CSS pixels. */
const TRACK_INSET_PX = 4;
/** Anything thinner than this is hard to hit with a pointer. */
const TRACK_WIDTH_PX = 8;
/** A thumb shorter than this is hard to grab, however deep the scrollback. */
const MIN_THUMB_PX = 20;
/** Both timings match the scrollbar the emulator used to draw. */
const FADE_MS = 200;
const HIDE_DELAY_MS = 1500;

interface ThumbMetrics {
  topPx: number;
  heightPx: number;
}

/**
 * Size and place the thumb for a viewport.
 *
 * The thumb covers the same fraction of the track as the screen covers of the
 * whole buffer. `viewportY` counts lines above the bottom, so its placement runs
 * backwards: zero sits the thumb at the foot of the track.
 *
 * A buffer with no scrollback gets no thumb at all, which is what keeps the bar
 * off a pane there is nothing to scroll.
 */
export function computeThumb(
  trackHeightPx: number,
  rows: number,
  scrollbackLength: number,
  viewportY: number,
): ThumbMetrics {
  const bufferLines = scrollbackLength + rows;
  if (trackHeightPx <= 0 || scrollbackLength <= 0 || bufferLines <= 0) {
    return { topPx: 0, heightPx: 0 };
  }

  const heightPx = Math.min(
    trackHeightPx,
    Math.max(MIN_THUMB_PX, Math.round((rows / bufferLines) * trackHeightPx)),
  );
  const distanceFromBottom = viewportY / scrollbackLength;
  return { topPx: (trackHeightPx - heightPx) * (1 - distanceFromBottom), heightPx };
}

/** The inverse placement: which line a thumb dragged to `topPx` selects. */
export function viewportYFromThumbTop(
  topPx: number,
  trackHeightPx: number,
  thumbHeightPx: number,
  scrollbackLength: number,
): number {
  const travelPx = trackHeightPx - thumbHeightPx;
  if (travelPx <= 0) return 0;
  const distanceFromBottom = 1 - topPx / travelPx;
  return Math.max(0, Math.min(scrollbackLength, Math.round(distanceFromBottom * scrollbackLength)));
}

/**
 * Stop the emulator drawing a scrollbar of its own.
 *
 * ghostty-web sizes the canvas to exactly `cols × rows` cells and then paints
 * the scrollbar inside it: `renderScrollbar` fills the last 14 pixels of every
 * row with the background colour before drawing the bar, erasing the two
 * rightmost columns of text for as long as the bar is up. Its `mousedown` hit
 * test claims the same band, so a selection started at the right edge scrolled
 * the buffer instead of selecting. Both are private, and neither has an option
 * to turn it off, so both are removed here — the replacement below occupies the
 * gap the fit addon already keeps clear of the grid.
 *
 * Both are private members, which a version bump can rename. Losing either one
 * silently restores the bug it was removed for, so a member that is no longer
 * there is reported rather than skipped. It is not thrown: the pane itself
 * works without this, and a broken scrollbar is no reason to lose the session.
 */
function suppressBuiltInScrollbar(container: HTMLElement, term: Terminal): void {
  const renderer = term.renderer as unknown as { renderScrollbar?: () => void } | undefined;
  if (typeof renderer?.renderScrollbar === 'function') {
    renderer.renderScrollbar = () => {};
  } else {
    console.error(
      '[terminal-ui] ghostty-web has no renderer.renderScrollbar to suppress — it will paint over the rightmost columns. Update suppressBuiltInScrollbar in scrollbar.ts for this version.',
    );
  }

  const hitTest = (term as unknown as { handleMouseDown?: EventListener }).handleMouseDown;
  if (typeof hitTest === 'function') {
    container.removeEventListener('mousedown', hitTest, { capture: true });
  } else {
    console.error(
      '[terminal-ui] ghostty-web has no handleMouseDown to detach — a selection started at the right edge will scroll instead. Update suppressBuiltInScrollbar in scrollbar.ts for this version.',
    );
  }
}

/**
 * Give a terminal pane a scrollbar that sits beside the text rather than over it.
 *
 * The bar is DOM, not canvas, because the canvas is the text grid: it is exactly
 * as wide as the columns it holds, so anything drawn at its right edge covers
 * characters. `FitAddon` already reserves 15 pixels of the container for a
 * scrollbar when it works out the column count, and that reserved strip — empty
 * until now — is where this one lives.
 *
 * Returns a dispose function.
 */
export function attachScrollbar(container: HTMLElement, term: Terminal): () => void {
  suppressBuiltInScrollbar(container, term);

  const track = container.ownerDocument.createElement('div');
  track.setAttribute('aria-hidden', 'true');
  Object.assign(track.style, {
    position: 'absolute',
    top: `${TRACK_INSET_PX}px`,
    right: `${TRACK_INSET_PX}px`,
    bottom: `${TRACK_INSET_PX}px`,
    width: `${TRACK_WIDTH_PX}px`,
    borderRadius: `${TRACK_WIDTH_PX / 2}px`,
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
    opacity: '0',
    transition: `opacity ${FADE_MS}ms`,
    // A hidden bar is out of the way entirely: a click near the right edge
    // belongs to the text under it until the bar is actually on screen.
    pointerEvents: 'none',
    // The pane forbids browser panning for the same reason its container does —
    // a claimed pan cancels the pointer stream mid-drag.
    touchAction: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const thumb = container.ownerDocument.createElement('div');
  Object.assign(thumb.style, {
    position: 'absolute',
    left: '0',
    width: '100%',
    borderRadius: `${TRACK_WIDTH_PX / 2}px`,
    backgroundColor: 'rgba(128, 128, 128, 0.5)',
  } satisfies Partial<CSSStyleDeclaration>);
  track.appendChild(thumb);

  // Anchor the bar to the pane itself, rather than to whichever ancestor the
  // caller happened to position.
  const previousPosition = container.style.position;
  container.style.position = 'relative';
  container.appendChild(track);

  let viewportY = 0;
  /** Where inside the thumb the pointer grabbed it; null while not dragging. */
  let grabOffsetPx: number | null = null;
  let hideTimer: number | undefined;

  const hide = () => {
    track.style.opacity = '0';
    track.style.pointerEvents = 'none';
  };

  const show = () => {
    const { topPx, heightPx } = computeThumb(
      track.clientHeight,
      term.rows,
      term.getScrollbackLength(),
      viewportY,
    );
    // No thumb means nothing to scroll, and a bar with nothing to say is noise.
    if (heightPx === 0) {
      hide();
      return;
    }

    thumb.style.top = `${topPx}px`;
    thumb.style.height = `${heightPx}px`;
    track.style.opacity = '1';
    track.style.pointerEvents = 'auto';

    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    // A drag keeps the bar up however long it lasts; its release re-arms this.
    hideTimer = grabOffsetPx === null ? window.setTimeout(hide, HIDE_DELAY_MS) : undefined;
  };

  const scrollToThumbTop = (topPx: number) => {
    term.scrollToLine(
      viewportYFromThumbTop(
        topPx,
        track.clientHeight,
        thumb.offsetHeight,
        term.getScrollbackLength(),
      ),
    );
  };

  const trackOffsetOf = (event: PointerEvent) => event.clientY - track.getBoundingClientRect().top;

  const onPointerDown = (event: PointerEvent) => {
    if (term.getScrollbackLength() === 0) return;
    // The pane scrolls from any touch on the container and the emulator starts a
    // text selection from a press; neither should see a grab of the scrollbar.
    event.preventDefault();
    event.stopPropagation();

    const offsetPx = trackOffsetOf(event);
    const onThumb = offsetPx >= thumb.offsetTop && offsetPx <= thumb.offsetTop + thumb.offsetHeight;
    // A press beside the thumb centres it under the pointer, so the same press
    // can carry straight on into a drag.
    grabOffsetPx = onThumb ? offsetPx - thumb.offsetTop : thumb.offsetHeight / 2;
    track.setPointerCapture(event.pointerId);
    if (!onThumb) scrollToThumbTop(offsetPx - grabOffsetPx);
    show();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (grabOffsetPx === null) return;
    scrollToThumbTop(trackOffsetOf(event) - grabOffsetPx);
  };

  const onPointerRelease = (event: PointerEvent) => {
    if (grabOffsetPx === null) return;
    grabOffsetPx = null;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    show();
  };

  // Every scroll route ends here — wheel, touch drag, keyboard, and the
  // re-pinning a write does under a viewport held above the bottom.
  const scrollSub = term.onScroll((y: number) => {
    viewportY = y;
    show();
  });

  track.addEventListener('pointerdown', onPointerDown);
  track.addEventListener('pointermove', onPointerMove);
  track.addEventListener('pointerup', onPointerRelease);
  track.addEventListener('pointercancel', onPointerRelease);

  return () => {
    scrollSub.dispose();
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    track.remove();
    container.style.position = previousPosition;
  };
}
