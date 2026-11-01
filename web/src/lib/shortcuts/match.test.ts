import { describe, it, expect } from 'vitest';
import {
  bindingKeys,
  shortcutForEvent,
  shortcutKeys,
  shortcutLimit,
  type MatchContext,
} from './match';
import { SHORTCUTS, getShortcut } from './registry';

function press(init: Partial<KeyboardEvent> & { altGraph?: boolean }): KeyboardEvent {
  const { altGraph = false, ...rest } = init;
  return {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
    ...rest,
  } as KeyboardEvent;
}

const windows: MatchContext = { mac: false, typing: false, inTerminal: false, phase: 'capture' };
const mac: MatchContext = { ...windows, mac: true };
const inTerminal = { typing: true, inTerminal: true };

describe('shortcut matching', () => {
  describe('platform modifier', () => {
    it('should use Ctrl on Windows and Cmd on Mac', () => {
      expect(shortcutForEvent(press({ key: 'k', ctrlKey: true }), windows)).toBe('search');
      expect(shortcutForEvent(press({ key: 'k', metaKey: true }), mac)).toBe('search');
    });

    it('should not treat the other modifier as mod', () => {
      expect(shortcutForEvent(press({ key: 'k', metaKey: true }), windows)).toBeNull();
      expect(shortcutForEvent(press({ key: 'k', ctrlKey: true }), mac)).toBeNull();
    });

    it('should match the terminal toggle with Ctrl on both platforms', () => {
      const event = press({ key: '`', code: 'Backquote', ctrlKey: true });
      expect(shortcutForEvent(event, windows)).toBe('toggleTerminal');
      expect(shortcutForEvent(event, mac)).toBe('toggleTerminal');
    });
  });

  describe('exact modifiers', () => {
    it('should not match Ctrl+Shift+J as Ctrl+J', () => {
      const event = press({ key: 'J', ctrlKey: true, shiftKey: true });
      expect(shortcutForEvent(event, windows)).toBeNull();
    });

    it('[FR-TERMINAL-1110] should tell the terminal toggle from the focus jump', () => {
      const jump = press({ key: '`', code: 'Backquote', ctrlKey: true, altKey: true });
      expect(shortcutForEvent(jump, windows)).toBe('focusTerminal');
    });

    it('should ignore AltGr, which reports as Ctrl+Alt', () => {
      const event = press({
        key: '`',
        code: 'Backquote',
        ctrlKey: true,
        altKey: true,
        altGraph: true,
      });
      expect(shortcutForEvent(event, windows)).toBeNull();
    });
  });

  describe('shifted punctuation', () => {
    it.each([
      ['>', 'Period', 'toggleRightPanel'],
      ['<', 'Comma', 'toggleLeftPanel'],
      [':', 'Semicolon', 'toggleInboxList'],
    ])('should match %s by its physical key', (key, code, id) => {
      const event = press({ key, code, ctrlKey: true, shiftKey: true });
      expect(shortcutForEvent(event, windows)).toBe(id);
    });
  });

  describe('option-rewritten keys', () => {
    it('should match Cmd+Option+W when Option turns the key into ∑', () => {
      const event = press({ key: '∑', code: 'KeyW', metaKey: true, altKey: true });
      expect(shortcutForEvent(event, mac)).toBe('closeTab');
    });
  });

  describe('focus', () => {
    it('[FR-TERMINAL-1100] should fire the terminal toggle with focus in a terminal', () => {
      const event = press({ key: '`', code: 'Backquote', ctrlKey: true });
      expect(shortcutForEvent(event, { ...windows, ...inTerminal })).toBe('toggleTerminal');
    });

    it('[FR-TERMINAL-1110] should leave Ctrl+letter readline keys to a focused terminal', () => {
      for (const key of ['k', 'p']) {
        const event = press({ key, ctrlKey: true });
        expect(shortcutForEvent(event, { ...windows, ...inTerminal })).toBeNull();
      }
    });

    it('should let Cmd+K fire in a terminal on Mac', () => {
      const event = press({ key: 'k', metaKey: true });
      expect(shortcutForEvent(event, { ...mac, ...inTerminal })).toBe('search');
    });

    it('should keep Ctrl+K working in a plain text field', () => {
      const event = press({ key: 'k', ctrlKey: true });
      expect(shortcutForEvent(event, { ...windows, typing: true })).toBe('search');
    });

    it('should not fire typing-unsafe shortcuts in a text field', () => {
      const event = press({ key: 'j', ctrlKey: true });
      expect(shortcutForEvent(event, windows)).toBe('toggleBottomTerminal');
      expect(shortcutForEvent(event, { ...windows, typing: true })).toBeNull();
    });
  });

  describe('page-owned keys', () => {
    const question = press({ key: '?', code: 'Slash', shiftKey: true });

    it('should wait for the bubble phase for ?', () => {
      expect(shortcutForEvent(question, windows)).toBeNull();
      expect(shortcutForEvent(question, { ...windows, phase: 'bubble' })).toBe('help');
    });

    it('should read ? without Shift, as some layouts type it', () => {
      const unshifted = press({ key: '?', code: 'Minus' });
      expect(shortcutForEvent(unshifted, { ...windows, phase: 'bubble' })).toBe('help');
    });

    it('should type ? in a text field', () => {
      const context: MatchContext = { ...windows, typing: true, phase: 'bubble' };
      expect(shortcutForEvent(question, context)).toBeNull();
    });
  });
});

describe('shortcut labels', () => {
  it('should show Mac symbols on Mac and words elsewhere', () => {
    expect(shortcutKeys('toggleLeftPanel', true)).toEqual(['⌘', '⇧', ',']);
    expect(shortcutKeys('toggleLeftPanel', false)).toEqual(['Ctrl', 'Shift', ',']);
  });

  it('should show the Alt form first for keys a browser keeps', () => {
    expect(shortcutKeys('closeTab', false)).toEqual(['Ctrl', 'Alt', 'W']);
  });

  it('should show arrows as symbols', () => {
    expect(bindingKeys({ mod: true, alt: true, key: 'ArrowRight' }, false)).toEqual([
      'Ctrl',
      'Alt',
      '→',
    ]);
  });

  it('should give display keys for shortcuts with their own handler', () => {
    expect(shortcutKeys('goInbox')).toEqual(['g', 'i']);
  });

  it('should explain where a shortcut stays silent', () => {
    expect(shortcutLimit('toggleBottomTerminal', false)).toBe('Not in text fields');
    expect(shortcutLimit('search', false)).toBe('Not in terminals');
    expect(shortcutLimit('search', true)).toBeNull();
    expect(shortcutLimit('goTasks', false)).toBe('Not in text fields');
    expect(shortcutLimit('focusTerminalNumber', false)).toBeNull();
  });
});

describe('registry', () => {
  it('should have unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should give every shortcut keys to display', () => {
    for (const def of SHORTCUTS) expect(shortcutKeys(def.id).length).toBeGreaterThan(0);
  });

  it('should fail with the fix for an unknown id', () => {
    expect(() => getShortcut('nope' as never)).toThrow(/registry\.ts/);
  });
});
