// Extracted as a pure function so the no-spurious-resize contract is unit-testable.
export function shouldSendResize(cols: number, rows: number, lastCols: number, lastRows: number): boolean {
  return cols !== lastCols || rows !== lastRows;
}

// A pane that is not laid out must never be fitted. FitAddon sizes the terminal
// from `getComputedStyle(parent)`, and a `display: none` ancestor makes that
// return the *specified* value instead of a used one — our container declares
// `height: 100%`, so the addon reads "100%", parses it as 100 pixels, and
// resizes the pane to about 10 columns by 5 rows. The reflow that follows
// destroys the scrollback, and the PTY is told a size nobody can read.
// Offsets are 0 for exactly the elements whose computed box is a lie, so they
// are the guard: fit only what the browser has actually measured.
export function canFitPane(offsetWidth: number, offsetHeight: number): boolean {
  return offsetWidth > 0 && offsetHeight > 0;
}
