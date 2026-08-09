import { describe, it, expect } from 'vitest';
import { keyOverrideBytes, type KeyChord } from './key-overrides';

const chord = (key: string, modifiers: Partial<KeyChord> = {}): KeyChord => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});

describe('terminal key overrides', () => {
  describe('Shift+Tab', () => {
    it('[FR-TERMINAL-500] should send backtab, which the emulator encodes as a plain tab', () => {
      expect(keyOverrideBytes(chord('Tab', { shiftKey: true }))).toBe('\x1b[Z');
    });

    it('should leave an unmodified tab to the emulator', () => {
      expect(keyOverrideBytes(chord('Tab'))).toBeNull();
    });
  });

  describe('Shift+Enter', () => {
    it('[FR-TERMINAL-510] should send a line continuation', () => {
      expect(keyOverrideBytes(chord('Enter', { shiftKey: true }))).toBe('\\\r');
    });

    it('should leave an unmodified return to the emulator', () => {
      expect(keyOverrideBytes(chord('Enter'))).toBeNull();
    });
  });

  describe('other chords', () => {
    it('should claim no key the emulator encodes correctly', () => {
      expect(keyOverrideBytes(chord('a', { shiftKey: true }))).toBeNull();
      expect(keyOverrideBytes(chord('ArrowUp', { shiftKey: true }))).toBeNull();
    });

    it('[FR-TERMINAL-500][FR-TERMINAL-510] should leave a chord carrying more than Shift alone', () => {
      expect(keyOverrideBytes(chord('Tab', { shiftKey: true, ctrlKey: true }))).toBeNull();
      expect(keyOverrideBytes(chord('Tab', { shiftKey: true, altKey: true }))).toBeNull();
      expect(keyOverrideBytes(chord('Enter', { shiftKey: true, metaKey: true }))).toBeNull();
    });
  });
});
