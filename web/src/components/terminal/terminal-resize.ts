// Extracted as a pure function so the no-spurious-resize contract is unit-testable.
export function shouldSendResize(cols: number, rows: number, lastCols: number, lastRows: number): boolean {
  return cols !== lastCols || rows !== lastRows;
}
