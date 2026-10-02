import type { Terminal } from '@xterm/xterm';
import type { TerminalReconnectedEvent } from '@engy/common';

type SnapshotTarget = Pick<Terminal, 'resize' | 'reset' | 'write' | 'scrollToBottom'>;

// A daemon that predates the size fields still sends a usable snapshot.
type SnapshotEvent = Pick<TerminalReconnectedEvent, 'snapshot'> &
  Partial<Pick<TerminalReconnectedEvent, 'cols' | 'rows'>>;

// A snapshot holds cursor-addressed frames for one exact grid. Written into a
// grid of another size (the 80x24 default before the first fit, or a hidden
// pane that cannot fit), a full-screen program's frame wraps and scrolls away,
// and its later cell-level diffs land on a blank screen. `refit` runs after the
// write so a gap between that grid and the pane reaches the PTY as a resize,
// and the program repaints.
export function applyReconnectSnapshot(
  term: SnapshotTarget,
  event: SnapshotEvent,
  refit: () => void,
): void {
  if (event.cols && event.rows) term.resize(event.cols, event.rows);
  // reset, not clear: it also drops modes a torn-down program left set.
  term.reset();
  term.write(event.snapshot, () => {
    term.scrollToBottom();
    refit();
  });
}
