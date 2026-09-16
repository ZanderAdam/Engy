import { describe, it, expect } from 'vitest';
import { isNumberHintChord, terminalNumberFromKey } from './terminal-number-shortcut';

function key(
  init: Partial<KeyboardEvent> & { code: string; altGraph?: boolean },
): KeyboardEvent {
  const { altGraph = false, ...rest } = init;
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
    ...rest,
  } as KeyboardEvent;
}

describe('terminal number shortcut', () => {
  it('[FR-TERMINAL-900] should read the terminal number from Ctrl+Alt and a digit', () => {
    expect(terminalNumberFromKey(key({ code: 'Digit3', ctrlKey: true, altKey: true }))).toBe(3);
    expect(terminalNumberFromKey(key({ code: 'Digit9', ctrlKey: true, altKey: true }))).toBe(9);
  });

  // Ctrl+digit and Alt+digit belong to the browser's own tabs.
  it('[FR-TERMINAL-900] should ignore a digit without both modifiers', () => {
    expect(terminalNumberFromKey(key({ code: 'Digit3' }))).toBeNull();
    expect(terminalNumberFromKey(key({ code: 'Digit3', ctrlKey: true }))).toBeNull();
    expect(terminalNumberFromKey(key({ code: 'Digit3', altKey: true }))).toBeNull();
  });

  it('should ignore the chord with a further modifier', () => {
    const withShift = key({ code: 'Digit3', ctrlKey: true, altKey: true, shiftKey: true });
    const withMeta = key({ code: 'Digit3', ctrlKey: true, altKey: true, metaKey: true });

    expect(terminalNumberFromKey(withShift)).toBeNull();
    expect(terminalNumberFromKey(withMeta)).toBeNull();
  });

  // Terminals are numbered from 1, so 0 names none of them.
  it('should ignore zero and non-digit keys', () => {
    expect(terminalNumberFromKey(key({ code: 'Digit0', ctrlKey: true, altKey: true }))).toBeNull();
    expect(terminalNumberFromKey(key({ code: 'KeyA', ctrlKey: true, altKey: true }))).toBeNull();
    expect(terminalNumberFromKey(key({ code: 'Numpad3', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('[FR-TERMINAL-900] should report the modifier being held on its own', () => {
    expect(isNumberHintChord(key({ code: 'ControlLeft', ctrlKey: true, altKey: true }))).toBe(true);
    expect(isNumberHintChord(key({ code: 'ControlLeft', ctrlKey: true }))).toBe(false);
  });

  // AltGr reports itself as Ctrl+Alt on several layouts, where its digit row
  // types real characters.
  it('[FR-TERMINAL-900] should ignore AltGr and a digit', () => {
    const altGr = key({ code: 'Digit3', ctrlKey: true, altKey: true, altGraph: true });

    expect(terminalNumberFromKey(altGr)).toBeNull();
    expect(isNumberHintChord(altGr)).toBe(false);
  });
});
