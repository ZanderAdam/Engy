import { describe, it, expect } from 'vitest';
import {
  advanceChord,
  chordPath,
  CHORD_TIMEOUT_MS,
  IDLE_CHORD,
  isInsideOverlay,
  type ChordKey,
} from './use-go-to-chords';

function key(k: string, extra: Partial<ChordKey> = {}): ChordKey {
  return { key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra };
}

describe('[FR-INBOX-400] advanceChord', () => {
  it('should arm on g', () => {
    expect(advanceChord(IDLE_CHORD, key('g'), 100)).toEqual({
      state: { armedAt: 100 },
      fire: null,
    });
  });

  it('should fire on i within the timeout', () => {
    expect(advanceChord({ armedAt: 100 }, key('i'), 100 + CHORD_TIMEOUT_MS)).toEqual({
      state: IDLE_CHORD,
      fire: 'i',
    });
  });

  it('should not fire on i after the timeout', () => {
    expect(advanceChord({ armedAt: 100 }, key('i'), 101 + CHORD_TIMEOUT_MS).fire).toBeNull();
  });

  it('should not fire on i without g', () => {
    expect(advanceChord(IDLE_CHORD, key('i'), 100).fire).toBeNull();
  });

  it('should reset on any other key', () => {
    expect(advanceChord({ armedAt: 100 }, key('x'), 200)).toEqual({
      state: IDLE_CHORD,
      fire: null,
    });
  });

  it('should re-arm when g is pressed twice', () => {
    expect(advanceChord({ armedAt: 100 }, key('g'), 200).state).toEqual({ armedAt: 200 });
  });

  it('should ignore modifier combos and non-character keys', () => {
    const armed = { armedAt: 100 };
    expect(advanceChord(armed, key('i', { metaKey: true }), 200)).toEqual({
      state: armed,
      fire: null,
    });
    expect(advanceChord(armed, key('Shift'), 200)).toEqual({ state: armed, fire: null });
    expect(advanceChord(armed, key('I', { shiftKey: true }), 200).fire).toBeNull();
  });
});

describe('[FR-INBOX-400] isInsideOverlay', () => {
  it('should be true when the target sits inside a dialog or menu', () => {
    const inside = { closest: (selector: string) => (selector.includes('dialog') ? {} : null) };
    expect(isInsideOverlay(inside)).toBe(true);
  });

  it('should be false for other targets', () => {
    expect(isInsideOverlay({ closest: () => null })).toBe(false);
    expect(isInsideOverlay(null)).toBe(false);
    expect(isInsideOverlay({})).toBe(false);
  });
});

describe('advanceChord targets', () => {
  it.each(['t', 'd', 'c', 'm'])('should fire g then %s', (second) => {
    expect(advanceChord({ armedAt: 100 }, key(second), 200).fire).toBe(second);
  });
});

describe('chordPath', () => {
  it('should stay in the project a tab shows', () => {
    expect(chordPath('t', '/w/engy/projects/initial/docs')).toBe('/w/engy/projects/initial/tasks');
    expect(chordPath('c', '/w/engy/projects/initial')).toBe('/w/engy/projects/initial/code');
  });

  it('should use workspace sections outside a project', () => {
    expect(chordPath('d', '/w/engy/tasks')).toBe('/w/engy/docs');
    expect(chordPath('m', '/w/engy')).toBe('/w/engy/memory');
  });

  it('should have no target where the section does not exist', () => {
    expect(chordPath('c', '/w/engy/tasks')).toBeNull();
    expect(chordPath('t', '/')).toBeNull();
  });
});
