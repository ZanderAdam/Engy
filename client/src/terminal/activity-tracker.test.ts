import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActivityTracker } from './activity-tracker.js';

const DEBOUNCE_MS = 3000;
const SUPPRESS_MS = 3000;

type ActivityEvent = 'start' | 'idle' | 'waiting' | 'done';

describe('[FR-TERMINAL-130] createActivityTracker (daemon)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const events: ActivityEvent[] = [];
    const tracker = createActivityTracker({
      debounceMs: DEBOUNCE_MS,
      suppressMs: SUPPRESS_MS,
      onActivity: (e) => events.push(e),
    });
    return { tracker, events };
  }

  function skipInitialSuppress() {
    vi.advanceTimersByTime(SUPPRESS_MS + 1);
  }

  it('should ignore output during the initial suppress window', () => {
    const { tracker, events } = setup();
    tracker.bumpActivity();
    tracker.bumpActivity();
    expect(events).toEqual([]);
  });

  it('should emit start after two chunks, then settle to done when quiet', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity();
    expect(events).toEqual(['start']);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual(['start', 'done']);
  });

  it('should settle to waiting when an input prompt was seen', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity(true);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual(['start', 'waiting']);
  });

  it('should emit waiting immediately on bell', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.handleBell();
    expect(events).toEqual(['waiting']);
  });

  it('should stay waiting (not done) when output continues after a bell', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.handleBell();
    tracker.bumpActivity();
    tracker.bumpActivity();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual(['waiting', 'start', 'waiting']);
  });

  it('should reset to idle on user input', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity();
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(events).toEqual(['start', 'done']);
    tracker.resetOnUserInput();
    expect(events).toEqual(['start', 'done', 'idle']);
  });

  it('[FR-TERMINAL-240] should reset to idle on acknowledge and be a no-op when already idle', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity();
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(events).toEqual(['start', 'done']);
    tracker.acknowledge();
    expect(events).toEqual(['start', 'done', 'idle']);
    tracker.acknowledge();
    expect(events).toEqual(['start', 'done', 'idle']);
  });

  it('[FR-TERMINAL-230] should expose the current state via getState', () => {
    const { tracker } = setup();
    skipInitialSuppress();
    expect(tracker.getState()).toBe('idle');
    tracker.bumpActivity();
    tracker.bumpActivity();
    expect(tracker.getState()).toBe('active');
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(tracker.getState()).toBe('done');
  });

  it('should ignore a resize redraw burst via suppressOutput without losing a pending settle', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity();
    expect(events).toEqual(['start']);
    tracker.suppressOutput(1000);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual(['start', 'done']);
  });

  it('[FR-TERMINAL-890] should not let a shorter suppressOutput cut an active longer one short', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.suppressOutput(3000);
    tracker.suppressOutput(1000);

    vi.advanceTimersByTime(1500);
    tracker.bumpActivity();
    tracker.bumpActivity();
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    expect(events).toEqual([]);
  });

  it('[FR-TERMINAL-890] should resume counting once the longer suppressOutput window ends', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.suppressOutput(3000);
    tracker.suppressOutput(1000);

    vi.advanceTimersByTime(3001);
    tracker.bumpActivity();
    tracker.bumpActivity();
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    expect(events).toEqual(['start', 'done']);
  });

  it('should not fire after dispose', () => {
    const { tracker, events } = setup();
    skipInitialSuppress();
    tracker.bumpActivity();
    tracker.bumpActivity();
    tracker.dispose();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(events).toEqual(['start']);
  });
});
