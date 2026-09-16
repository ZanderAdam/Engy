import type { ActivityEvent, TerminalActivityState } from './types';

interface ActivityTracker {
  bumpActivity: (hasPrompt?: boolean) => void;
  handleBell: () => void;
  resetOnUserInput: () => void;
  acknowledge: () => void;
  suppress: () => void;
  suppressOutput: (ms: number) => void;
  dispose: () => void;
}

interface ActivityTrackerOptions {
  debounceMs: number;
  suppressMs: number;
  onActivity: (event: ActivityEvent) => void;
}

/**
 * Factory for the terminal activity state machine (after agent-deck / herdr):
 *   idle → active → (done | waiting) → idle
 *
 * Activity is signalled by output chunks (bumpActivity) or bell (handleBell).
 * Two or more chunks within the debounce window trigger the 'start' event.
 * When output goes quiet for debounceMs the burst *settles*: to 'waiting' if a
 * bell or input-prompt was seen (blocked on the user), otherwise to 'done'
 * (finished but unseen). User input (resetOnUserInput) or viewing the terminal
 * (acknowledge) returns it to idle.
 */
export function createActivityTracker({
  debounceMs,
  suppressMs,
  onActivity,
}: ActivityTrackerOptions): ActivityTracker {
  let chunkCount = 0;
  // Sticky "the program wants the user" flag: set by a bell or a detected input
  // prompt and held until the user acknowledges, so trailing output (e.g. a
  // shell redrawing its prompt after the bell) can't downgrade 'waiting' to
  // 'done'. Cleared only on idle/suppress.
  let wantsInput = false;
  // Last emitted state, so the settle/clear paths know what to transition from.
  let current: TerminalActivityState = 'idle';
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressActivityUntil = Date.now() + suppressMs;

  function clearInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function settleIdle() {
    if (current !== 'idle' || inactivityTimer) {
      clearInactivityTimer();
      chunkCount = 0;
      wantsInput = false;
      current = 'idle';
      onActivity('idle');
    }
  }

  function bumpActivity(hasPrompt = false) {
    if (Date.now() < suppressActivityUntil) return;

    if (hasPrompt) wantsInput = true;
    chunkCount++;

    if (current !== 'active' && chunkCount >= 2) {
      current = 'active';
      onActivity('start');
    }

    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      if (current === 'active') {
        current = wantsInput ? 'waiting' : 'done';
        onActivity(current);
      }
      chunkCount = 0;
    }, debounceMs);
  }

  function handleBell() {
    clearInactivityTimer();
    chunkCount = 0;
    wantsInput = true;
    if (current !== 'waiting') {
      current = 'waiting';
      onActivity('waiting');
    }
  }

  // User typed into the terminal — clears any active/done/waiting indicator.
  function resetOnUserInput() {
    settleIdle();
  }

  // User viewed/focused the terminal — a done/waiting session is now "seen".
  function acknowledge() {
    settleIdle();
  }

  // Heavy reset for reconnect: the daemon replays the scrollback buffer, so
  // drop all state and ignore the replayed bytes for the full window.
  function suppress() {
    suppressActivityUntil = Date.now() + suppressMs;
    clearInactivityTimer();
    chunkCount = 0;
    wantsInput = false;
    current = 'idle';
  }

  // Light, short ignore window for a resize-triggered redraw (collapse/expand,
  // tab reselect, drag-resize). Unlike suppress() this preserves the current
  // state and any pending settle timer, so a quiet done/active dot stays put and
  // a real settle still fires — the redraw burst is simply not counted. Never
  // shortens an active window, so a short resize call cannot undo the longer
  // suppression a reconnect sets.
  function suppressOutput(ms: number) {
    suppressActivityUntil = Math.max(suppressActivityUntil, Date.now() + ms);
    chunkCount = 0;
  }

  function dispose() {
    clearInactivityTimer();
  }

  return { bumpActivity, handleBell, resetOnUserInput, acknowledge, suppress, suppressOutput, dispose };
}
