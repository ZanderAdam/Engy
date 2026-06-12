import type { ActivityEvent } from './types';

interface ActivityTracker {
  bumpActivity: () => void;
  handleBell: () => void;
  resetOnUserInput: () => void;
  suppress: () => void;
  dispose: () => void;
}

interface ActivityTrackerOptions {
  debounceMs: number;
  suppressMs: number;
  onActivity: (event: ActivityEvent) => void;
}

/**
 * Factory for terminal activity state machine: idle → active → waiting → idle.
 *
 * Activity is signalled by output chunks (bumpActivity) or bell (handleBell).
 * Two or more chunks within the debounce window trigger the 'start' event.
 * Inactivity for debounceMs emits 'waiting'. User input resets to idle.
 */
export function createActivityTracker({
  debounceMs,
  suppressMs,
  onActivity,
}: ActivityTrackerOptions): ActivityTracker {
  let activityChunkCount = 0;
  let isActive = false;
  let isWaiting = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressActivityUntil = Date.now() + suppressMs;

  function clearInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function resetCounters() {
    activityChunkCount = 0;
    isActive = false;
    clearInactivityTimer();
  }

  function bumpActivity() {
    if (Date.now() < suppressActivityUntil) return;

    activityChunkCount++;

    if (!isActive && activityChunkCount >= 2) {
      isActive = true;
      isWaiting = false;
      onActivity('start');
    }

    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      if (isActive) {
        isWaiting = true;
        onActivity('waiting');
      }
      resetCounters();
    }, debounceMs);
  }

  function handleBell() {
    resetCounters();
    isWaiting = true;
    onActivity('waiting');
  }

  function resetOnUserInput() {
    // isWaiting persists past resetCounters() — both paths into 'waiting'
    // reset the counters, which would otherwise make this guard miss and
    // leave the waiting indicator stuck until the next output burst.
    if (isActive || inactivityTimer || isWaiting) {
      resetCounters();
      isWaiting = false;
      onActivity('idle');
    }
  }

  function suppress() {
    suppressActivityUntil = Date.now() + suppressMs;
    resetCounters();
  }

  function dispose() {
    clearInactivityTimer();
  }

  return { bumpActivity, handleBell, resetOnUserInput, suppress, dispose };
}
