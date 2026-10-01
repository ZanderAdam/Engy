import { describe, it, expect } from 'vitest';
import { advanceChord, CHORD_TIMEOUT_MS, IDLE_CHORD, type ChordKey } from './use-go-to-inbox';

function key(k: string, extra: Partial<ChordKey> = {}): ChordKey {
  return { key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra };
}

describe('[FR-INBOX-400] advanceChord', () => {
  it('should arm on g', () => {
    expect(advanceChord(IDLE_CHORD, key('g'), 100)).toEqual({
      state: { armedAt: 100 },
      fire: false,
    });
  });

  it('should fire on i within the timeout', () => {
    expect(advanceChord({ armedAt: 100 }, key('i'), 100 + CHORD_TIMEOUT_MS)).toEqual({
      state: IDLE_CHORD,
      fire: true,
    });
  });

  it('should not fire on i after the timeout', () => {
    expect(advanceChord({ armedAt: 100 }, key('i'), 101 + CHORD_TIMEOUT_MS).fire).toBe(false);
  });

  it('should not fire on i without g', () => {
    expect(advanceChord(IDLE_CHORD, key('i'), 100).fire).toBe(false);
  });

  it('should reset on any other key', () => {
    expect(advanceChord({ armedAt: 100 }, key('x'), 200)).toEqual({
      state: IDLE_CHORD,
      fire: false,
    });
  });

  it('should re-arm when g is pressed twice', () => {
    expect(advanceChord({ armedAt: 100 }, key('g'), 200).state).toEqual({ armedAt: 200 });
  });

  it('should ignore modifier combos and non-character keys', () => {
    const armed = { armedAt: 100 };
    expect(advanceChord(armed, key('i', { metaKey: true }), 200)).toEqual({
      state: armed,
      fire: false,
    });
    expect(advanceChord(armed, key('Shift'), 200)).toEqual({ state: armed, fire: false });
    expect(advanceChord(armed, key('I', { shiftKey: true }), 200).fire).toBe(false);
  });
});
