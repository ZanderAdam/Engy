/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { defaultLeftShortcut, defaultRightShortcut } from './three-panel-layout';

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
  describe('defaultLeftShortcut', () => {
    it('should match Cmd+Shift+< (via < key)', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: '<', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Cmd+Shift+, (via , key)', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: ',', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Ctrl+Shift+< on non-Mac', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: '<', ctrlKey: true, shiftKey: true }))).toBe(true);
    });

    it('should not match without modifier key', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: '<', shiftKey: true }))).toBe(false);
    });

    it('should not match without shift', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: '<', metaKey: true }))).toBe(false);
    });

    it('should not match wrong key', () => {
      expect(defaultLeftShortcut(makeKeyboardEvent({ key: '>', metaKey: true, shiftKey: true }))).toBe(false);
    });
  });

  describe('defaultRightShortcut', () => {
    it('should match Cmd+Shift+> (via > key)', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '>', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Cmd+Shift+. (via . key)', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '.', metaKey: true, shiftKey: true }))).toBe(true);
    });

    it('should match Ctrl+Shift+> on non-Mac', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '>', ctrlKey: true, shiftKey: true }))).toBe(true);
    });

    it('should not match without modifier key', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '>', shiftKey: true }))).toBe(false);
    });

    it('should not match without shift', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '>', metaKey: true }))).toBe(false);
    });

    it('should not match left shortcut keys', () => {
      expect(defaultRightShortcut(makeKeyboardEvent({ key: '<', metaKey: true, shiftKey: true }))).toBe(false);
    });
  });
});
