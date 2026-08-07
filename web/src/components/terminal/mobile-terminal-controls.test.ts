// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  MOBILE_TERMINAL_BUTTONS,
  MOBILE_TERMINAL_EXTRA_BUTTONS,
  isOutsidePress,
} from './mobile-terminal-controls';

/**
 * Byte-mapping contract for the mobile terminal control column.
 *
 * The PTY relay on the server forwards the `data` payload verbatim, so these
 * byte sequences must match what a terminal emulator sends for the equivalent physical
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
      for (const btn of [...MOBILE_TERMINAL_BUTTONS, ...MOBILE_TERMINAL_EXTRA_BUTTONS]) {
        expect(btn.ariaLabel).toMatch(/^Send /);
      }
    });
  });

  describe('extra key column', () => {
    it('[FR-TERMINAL-440] should render 4, 5, Ctrl+C, Ctrl+V, left, right top-to-bottom', () => {
      expect(MOBILE_TERMINAL_EXTRA_BUTTONS.map((b) => b.id)).toEqual([
        '4',
        '5',
        'ctrl-c',
        'ctrl-v',
        'left',
        'right',
      ]);
    });

    const cases: Array<[string, string]> = [
      ['4', '4'],
      ['5', '5'],
      ['ctrl-c', '\x03'],
      ['ctrl-v', '\x16'],
      ['left', '\x1b[D'],
      ['right', '\x1b[C'],
    ];

    it.each(cases)(
      '[FR-TERMINAL-440] should send %s as the expected byte sequence',
      (id, expected) => {
        const btn = MOBILE_TERMINAL_EXTRA_BUTTONS.find((b) => b.id === id);
        expect(btn?.data).toBe(expected);
      },
    );

    it('[FR-TERMINAL-440] should not duplicate any key already on the persistent rail', () => {
      const railIds = new Set(MOBILE_TERMINAL_BUTTONS.map((b) => b.id));
      const overlap = MOBILE_TERMINAL_EXTRA_BUTTONS.filter((b) => railIds.has(b.id));
      expect(overlap).toEqual([]);
    });
  });

  describe('isOutsidePress', () => {
    const root = document.createElement('div');
    const child = document.createElement('button');
    root.appendChild(child);
    const stranger = document.createElement('div');

    it('[FR-TERMINAL-440] should treat a press on the control area itself as inside', () => {
      expect(isOutsidePress(root, root)).toBe(false);
    });

    it('[FR-TERMINAL-440] should treat a press on a key within the control area as inside', () => {
      expect(isOutsidePress(child, root)).toBe(false);
    });

    it('[FR-TERMINAL-440] should treat a press on an unrelated element as outside', () => {
      expect(isOutsidePress(stranger, root)).toBe(true);
    });

    it('[FR-TERMINAL-440] should treat a non-Node target as outside', () => {
      expect(isOutsidePress(new EventTarget(), root)).toBe(true);
    });

    it('[FR-TERMINAL-440] should treat any press as outside before the root mounts', () => {
      expect(isOutsidePress(child, null)).toBe(true);
    });
  });
});
