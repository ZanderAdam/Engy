import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActivityTracker } from './activity-tracker';
import type { ActivityEvent } from './types';

const DEBOUNCE_MS = 3000;
const SUPPRESS_MS = 3000;

describe('createActivityTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const events: ActivityEvent[] = [];
    const onActivity = (event: ActivityEvent) => events.push(event);
    const tracker = createActivityTracker({
      debounceMs: DEBOUNCE_MS,
      suppressMs: SUPPRESS_MS,
      onActivity,
    });
    return { tracker, events };
  }

  /** Advance past the initial suppress window so activity is detected. */
  function skipInitialSuppress() {
    vi.advanceTimersByTime(SUPPRESS_MS + 1);
  }

  describe('output chunk activity', () => {
    it('should stay idle after a single output chunk', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();

      expect(events).toEqual([]);
    });

    it('should emit start after two output chunks within debounce window', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual(['start']);
    });

    it('should emit done after debounce with no new output (no prompt seen)', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(events).toEqual(['start', 'done']);
    });

    it('should reset inactivity timer on each new output chunk', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      // Two chunks to become active
      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      // Send chunks every 1s for 10s — each resets the debounce
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(1000);
        tracker.bumpActivity();
        // Should not settle yet
        expect(events).toEqual(['start']);
      }

      // Now wait 3s after the last chunk — should settle to done
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(events).toEqual(['start', 'done']);
    });

    it('should emit only one start even with many chunks', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      for (let i = 0; i < 20; i++) {
        tracker.bumpActivity();
      }

      const startEvents = events.filter((e) => e === 'start');
      expect(startEvents).toHaveLength(1);
    });
  });

  describe('bell signal', () => {
    it('should emit waiting immediately on bell from idle state', () => {
      const { tracker, events } = setup();

      tracker.handleBell();

      expect(events).toEqual(['waiting']);
    });

    it('should emit waiting immediately on bell from active state', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      tracker.handleBell();

      expect(events).toEqual(['start', 'waiting']);
    });

    it('should not emit waiting from inactivity timer after bell resets state', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      tracker.handleBell();

      vi.advanceTimersByTime(DEBOUNCE_MS);

      // No extra waiting — bell already emitted it and reset counters
      expect(events).toEqual(['start', 'waiting']);
    });

    it('should stay waiting (not done) when output continues after a bell', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.handleBell();
      expect(events).toEqual(['waiting']);

      // Trailing output (e.g. shell redrawing its prompt) flips to active...
      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['waiting', 'start']);

      // ...but the sticky wantsInput flag settles it back to waiting, not done.
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(events).toEqual(['waiting', 'start', 'waiting']);
    });
  });

  describe('title changes', () => {
    it('should emit start after two bumpActivity calls (title-driven)', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      // Title changes call bumpActivity externally
      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual(['start']);
    });
  });

  describe('user input reset', () => {
    it('should emit idle and reset state when user types while active', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      tracker.resetOnUserInput();

      expect(events).toEqual(['start', 'idle']);
    });

    it('should emit idle when user types while inactivity timer is pending', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity(); // single chunk — inactivityTimer started but not active

      tracker.resetOnUserInput();

      // Timer was pending (inactivityTimer set), so idle is emitted
      expect(events).toEqual(['idle']);
    });

    it('should not emit idle when user types while already idle', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.resetOnUserInput();

      expect(events).toEqual([]);
    });

    it('should emit idle when user types after a bell', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.handleBell();
      expect(events).toEqual(['waiting']);

      tracker.resetOnUserInput();

      expect(events).toEqual(['waiting', 'idle']);
    });

    it('should emit idle when user types after debounce-triggered done', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
      expect(events).toEqual(['start', 'done']);

      tracker.resetOnUserInput();

      expect(events).toEqual(['start', 'done', 'idle']);
    });
  });

  describe('prompt detection (waiting vs done)', () => {
    it('should settle to waiting when an input-prompt was seen in output', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity(true); // chunk carried an input prompt
      expect(events).toEqual(['start']);

      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(events).toEqual(['start', 'waiting']);
    });

    it('should settle to done when no prompt was seen', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity(false);
      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(events).toEqual(['start', 'done']);
    });
  });

  describe('acknowledge (view/focus)', () => {
    it('should emit idle when a done session is acknowledged', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
      expect(events).toEqual(['start', 'done']);

      tracker.acknowledge();

      expect(events).toEqual(['start', 'done', 'idle']);
    });

    it('should emit idle when a waiting (bell) session is acknowledged', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.handleBell();
      expect(events).toEqual(['waiting']);

      tracker.acknowledge();

      expect(events).toEqual(['waiting', 'idle']);
    });

    it('should not emit idle when acknowledging an already-idle session', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.acknowledge();

      expect(events).toEqual([]);
    });
  });

  describe('suppress window (reconnect)', () => {
    it('should swallow activity for suppressMs after suppress()', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      // Confirm activity works normally
      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      // Reconnect — suppress activity
      tracker.suppress();

      // Activity during suppress window should be ignored
      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);
    });

    it('should resume activity after suppress window expires', () => {
      const { tracker, events } = setup();

      tracker.suppress();

      vi.advanceTimersByTime(SUPPRESS_MS + 1);

      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual(['start']);
    });

    it('should not emit activity during initial suppress window', () => {
      // Tracker starts with a suppress window from construction
      const { tracker, events } = setup();

      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual([]);
    });
  });

  describe('suppressOutput (resize redraw)', () => {
    it('should ignore output within the window without disturbing a settled done', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
      expect(events).toEqual(['start', 'done']);

      // A resize redraw arrives; it must not flip done back to active.
      tracker.suppressOutput(1000);
      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual(['start', 'done']);
    });

    it('should leave a pending settle timer intact (no stuck active)', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      // Resize while active: the existing inactivity timer must still settle.
      tracker.suppressOutput(1000);
      vi.advanceTimersByTime(DEBOUNCE_MS);

      expect(events).toEqual(['start', 'done']);
    });

    it('should resume counting output after the window expires', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.suppressOutput(1000);
      vi.advanceTimersByTime(1001);

      tracker.bumpActivity();
      tracker.bumpActivity();

      expect(events).toEqual(['start']);
    });
  });

  describe('dispose', () => {
    it('should not fire inactivity callback after dispose', () => {
      const { tracker, events } = setup();
      skipInitialSuppress();

      tracker.bumpActivity();
      tracker.bumpActivity();
      expect(events).toEqual(['start']);

      tracker.dispose();

      vi.advanceTimersByTime(DEBOUNCE_MS);

      // No waiting event after dispose clears the timer
      expect(events).toEqual(['start']);
    });
  });
});
