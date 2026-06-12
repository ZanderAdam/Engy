import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushTimer } from './use-auto-save';

describe('flushTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does nothing when no timer is pending', () => {
    const timerRef = { current: null } as { current: ReturnType<typeof setTimeout> | null };
    const pendingSaveRef = { current: null } as { current: (() => void) | null };
    // Should not throw
    flushTimer(timerRef, pendingSaveRef);
    expect(timerRef.current).toBeNull();
    expect(pendingSaveRef.current).toBeNull();
  });

  it('executes the pending save immediately and clears the timer', () => {
    const timerRef = { current: null } as { current: ReturnType<typeof setTimeout> | null };
    const pendingSaveRef = { current: null } as { current: (() => void) | null };
    const saveFn = vi.fn();

    timerRef.current = setTimeout(() => {}, 1000);
    pendingSaveRef.current = saveFn;

    flushTimer(timerRef, pendingSaveRef);

    expect(saveFn).toHaveBeenCalledOnce();
    expect(timerRef.current).toBeNull();
    expect(pendingSaveRef.current).toBeNull();
  });

  it('does not call setTimeout callback after flush', () => {
    const timerRef = { current: null } as { current: ReturnType<typeof setTimeout> | null };
    const pendingSaveRef = { current: null } as { current: (() => void) | null };
    const saveFn = vi.fn();

    timerRef.current = setTimeout(() => saveFn(), 1000);
    pendingSaveRef.current = saveFn;

    flushTimer(timerRef, pendingSaveRef);

    // Advance time — the original setTimeout callback should not fire again
    vi.advanceTimersByTime(2000);

    // saveFn was called once by flushTimer, not again by the timer
    expect(saveFn).toHaveBeenCalledOnce();
  });
});
