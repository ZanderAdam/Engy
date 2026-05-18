import { describe, it, expect } from 'vitest';
import { MOBILE_TERMINAL_BUTTONS } from './mobile-terminal-controls';

/**
 * Byte-mapping contract for the mobile terminal control column.
 *
 * The PTY relay on the server forwards the `data` payload verbatim, so these
 * byte sequences must match what xterm.js sends for the equivalent physical
 * keys. Changing any of them silently breaks Claude's interactive prompts on
 * mobile.
 */
describe('mobile terminal controls', () => {
  describe('button order', () => {
    it('should render Esc, 1, 2, 3, up, down, Tab, Mode, Enter top-to-bottom', () => {
      expect(MOBILE_TERMINAL_BUTTONS.map((b) => b.id)).toEqual([
        'esc',
        '1',
        '2',
        '3',
        'up',
        'down',
        'tab',
        'mode',
        'enter',
      ]);
    });
  });

  describe('byte mappings', () => {
    const cases: Array<[string, string]> = [
      ['esc', '\x1b'],
      ['1', '1'],
      ['2', '2'],
      ['3', '3'],
      ['up', '\x1b[A'],
      ['down', '\x1b[B'],
      ['tab', '\t'],
      ['mode', '\x1b[Z'],
      ['enter', '\r'],
    ];

    it.each(cases)('should send %s as the expected byte sequence', (id, expected) => {
      const btn = MOBILE_TERMINAL_BUTTONS.find((b) => b.id === id);
      expect(btn?.data).toBe(expected);
    });
  });

  describe('accessibility', () => {
    it('should provide an aria-label for every button', () => {
      for (const btn of MOBILE_TERMINAL_BUTTONS) {
        expect(btn.ariaLabel).toMatch(/^Send /);
      }
    });
  });
});
