import { describe, it, expect, vi } from 'vitest';
import { softKeyboardBytes, attachSoftKeyboardInput } from './soft-keyboard-input';

describe('mobile terminal input', () => {
  describe('softKeyboardBytes', () => {
    it('[FR-TERMINAL-470] should send typed characters as-is', () => {
      expect(softKeyboardBytes('insertText', 'a')).toBe('a');
      expect(softKeyboardBytes('insertText', 'hello')).toBe('hello');
    });

    it('[FR-TERMINAL-470] should delete the replaced word before an autocorrection', () => {
      // Without the leading Ctrl+W the terminal keeps the original word and
      // appends the correction — accepting "the" for "teh" gives "tehthe".
      expect(softKeyboardBytes('insertReplacementText', 'the')).toBe('\x17the');
      expect(softKeyboardBytes('insertReplacementText', null)).toBeNull();
    });

    it('[FR-TERMINAL-470] should delete a word on a backspace swipe', () => {
      expect(softKeyboardBytes('deleteWordBackward', null)).toBe('\x17');
    });

    it('[FR-TERMINAL-470] should send line breaks as carriage returns', () => {
      expect(softKeyboardBytes('insertLineBreak', null)).toBe('\r');
      expect(softKeyboardBytes('insertParagraph', null)).toBe('\r');
      expect(softKeyboardBytes('insertText', 'two\nlines')).toBe('two\rlines');
    });

    it('[FR-TERMINAL-470] should map the delete keys to their terminal sequences', () => {
      expect(softKeyboardBytes('deleteContentBackward', null)).toBe('\x7f');
      expect(softKeyboardBytes('deleteContentForward', null)).toBe('\x1b[3~');
    });

    it('[FR-TERMINAL-470] should ignore provisional composition and paste input', () => {
      // Committed by ghostty-web's own compositionend / paste handlers — claiming
      // these here would deliver the same text twice.
      expect(softKeyboardBytes('insertCompositionText', 'wor')).toBeNull();
      expect(softKeyboardBytes('insertFromPaste', 'pasted')).toBeNull();
    });

    it('[FR-TERMINAL-470] should ignore an insert carrying no data', () => {
      expect(softKeyboardBytes('insertText', null)).toBeNull();
      expect(softKeyboardBytes('insertText', '')).toBeNull();
    });
  });

  describe('attachSoftKeyboardInput', () => {
    function createFakeContainer() {
      let handler: ((event: Event) => void) | null = null;
      return {
        addEventListener: (_t: string, h: (event: Event) => void) => {
          handler = h;
        },
        removeEventListener: () => {
          handler = null;
        },
        dispatch: (inputType: string, data: string | null) => {
          const event = {
            inputType,
            data,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          };
          handler?.(event as unknown as Event);
          return event;
        },
        isAttached: () => handler !== null,
      };
    }

    it('[FR-TERMINAL-470] should send mapped input and claim the event', () => {
      const container = createFakeContainer();
      const send = vi.fn();
      attachSoftKeyboardInput(container as unknown as HTMLElement, send);

      const event = container.dispatch('insertText', 'x');

      expect(send).toHaveBeenCalledWith('x');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('[FR-TERMINAL-470] should leave unmapped input for ghostty-web to handle', () => {
      const container = createFakeContainer();
      const send = vi.fn();
      attachSoftKeyboardInput(container as unknown as HTMLElement, send);

      const event = container.dispatch('insertCompositionText', 'wor');

      expect(send).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it('[FR-TERMINAL-470] should detach on dispose', () => {
      const container = createFakeContainer();
      const detach = attachSoftKeyboardInput(container as unknown as HTMLElement, vi.fn());

      expect(container.isAttached()).toBe(true);
      detach();
      expect(container.isAttached()).toBe(false);
    });
  });
});
