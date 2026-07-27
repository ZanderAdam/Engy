import { describe, it, expect } from 'vitest';
import { keyboardInsetOf } from './use-keyboard-inset';

describe('keyboard inset', () => {
  describe('keyboardInsetOf', () => {
    it('should report no inset while no keyboard is up', () => {
      expect(keyboardInsetOf(900, { height: 900, offsetTop: 0 })).toBe(0);
    });

    it('should report the keyboard height when only the visual viewport shrinks', () => {
      expect(keyboardInsetOf(900, { height: 560, offsetTop: 0 })).toBe(340);
    });

    it('should report no inset when the layout viewport shrank with the keyboard', () => {
      // `interactive-widget: resizes-content` — window and visual viewport agree.
      expect(keyboardInsetOf(560, { height: 560, offsetTop: 0 })).toBe(0);
    });

    it('should discount a scrolled-away visual viewport', () => {
      expect(keyboardInsetOf(900, { height: 560, offsetTop: 100 })).toBe(240);
    });

    it('should never report a negative inset', () => {
      expect(keyboardInsetOf(560, { height: 900, offsetTop: 0 })).toBe(0);
    });

    it('should round to whole pixels', () => {
      expect(keyboardInsetOf(900, { height: 560.4, offsetTop: 0 })).toBe(340);
    });
  });
});
