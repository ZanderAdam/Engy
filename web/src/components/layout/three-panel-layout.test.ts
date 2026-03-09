/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { matchShortcut, DEFAULT_LEFT_SHORTCUT, DEFAULT_RIGHT_SHORTCUT } from './three-panel-layout';

function makeKeyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('three-panel-layout', () => {
  describe('DEFAULT_LEFT_SHORTCUT', () => {
    const def = DEFAULT_LEFT_SHORTCUT;

    it('should match Cmd+Shift+,', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: ',', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Ctrl+Shift+, on non-Mac', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: ',', ctrlKey: true, shiftKey: true }))).toBe(true);
    });

    it('should not match without modifier key', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: ',', shiftKey: true }))).toBe(false);
    });

    it('should not match without shift', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: ',', metaKey: true }))).toBe(false);
    });

    it('should not match wrong key', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '.', metaKey: true, shiftKey: true }))).toBe(false);
    });
  });

  describe('DEFAULT_RIGHT_SHORTCUT', () => {
    const def = DEFAULT_RIGHT_SHORTCUT;

    it('should match Cmd+Shift+.', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '.', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Ctrl+Shift+. on non-Mac', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '.', ctrlKey: true, shiftKey: true }))).toBe(true);
    });

    it('should not match without modifier key', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '.', shiftKey: true }))).toBe(false);
    });

    it('should not match without shift', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '.', metaKey: true }))).toBe(false);
    });

    it('should not match left shortcut key', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: ',', metaKey: true, shiftKey: true }))).toBe(false);
    });
  });

  describe('matchShortcut with ctrl', () => {
    const def = { ctrl: true, key: '`' };

    it('should match Ctrl+`', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '`', ctrlKey: true }))).toBe(true);
    });

    it('should not match Cmd+` without ctrl', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '`', metaKey: true }))).toBe(false);
    });

    it('should not match without modifier', () => {
      expect(matchShortcut(def, makeKeyboardEvent({ key: '`' }))).toBe(false);
    });
  });
});
