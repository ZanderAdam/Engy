import type { TerminalActivityState } from '@engy/common';

// Daemon copy of web/src/components/terminal/activity-tracker.ts. The state
// machine is duplicated rather than shared because @engy/common is types-only.
// The "view" signal arrives as a relayed { t: 'ack' } from the browser
// (acknowledge); idle is also reached via user input (resetOnUserInput).
// suppress()/suppressOutput() guard against reconnect/resize redraw bursts.
type ActivityEvent = 'start' | 'idle' | 'waiting' | 'done';

interface ActivityTracker {
  bumpActivity: (hasPrompt?: boolean) => void;
  handleBell: () => void;
  resetOnUserInput: () => void;
  acknowledge: () => void;
  getState: () => TerminalActivityState;
  suppressOutput: (ms: number) => void;
  dispose: () => void;
}

interface ActivityTrackerOptions {
  debounceMs: number;
  suppressMs: number;
  onActivity: (event: ActivityEvent) => void;
}

/**
 * Terminal activity state machine: idle → active → (done | waiting) → idle.
 * Two+ output chunks within the debounce window emit 'start'; when output goes
 * quiet for debounceMs the burst settles to 'waiting' (a bell or input-prompt
 * was seen) or 'done' (finished). User input returns it to idle.
 */
export function createActivityTracker({
  debounceMs,
  suppressMs,
  onActivity,
}: ActivityTrackerOptions): ActivityTracker {
  let chunkCount = 0;
  // Sticky "the program wants the user" flag (bell or input-prompt), held until
  // idle so trailing output can't downgrade 'waiting' to 'done'.
  let wantsInput = false;
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

  function resetOnUserInput() {
    settleIdle();
  }

  // User viewed/focused the terminal in a browser — mirrors the web tracker's
  // acknowledge so the daemon-computed badge state clears once seen.
  function acknowledge() {
    settleIdle();
  }

  function getState() {
    return current;
  }

  // Short ignore window for a resize-triggered redraw, preserving current state
  // and any pending settle. Never shortens an active window — a reconnect
  // widens suppression past the resize it performs, and that shorter call must
  // not undo the longer one.
  function suppressOutput(ms: number) {
    suppressActivityUntil = Math.max(suppressActivityUntil, Date.now() + ms);
    chunkCount = 0;
  }

  function dispose() {
    clearInactivityTimer();
  }

  return {
    bumpActivity,
    handleBell,
    resetOnUserInput,
    acknowledge,
    getState,
    suppressOutput,
    dispose,
  };
}
