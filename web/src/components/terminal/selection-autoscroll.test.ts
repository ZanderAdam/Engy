import { describe, it, expect, vi } from 'vitest';
import type { Terminal } from 'ghostty-web';
import { confineSelectionAutoScroll } from './selection-autoscroll';

/**
 * A stand-in for the emulator's selection manager. The edge trigger is modelled
 * faithfully — `updateAutoScroll` is what the emulator calls on every mouse move
 * over the pane, and starting a scroll from it is the behaviour being removed.
 */
function createFakeTerminal() {
  const calls: string[] = [];
  const selectionManager = {
    updateAutoScroll(offsetY: number, clientHeight: number) {
      calls.push(`scroll:${offsetY}/${clientHeight}`);
    },
    startAutoScroll(direction: number) {
      calls.push(`start:${direction}`);
    },
    stopAutoScroll() {
      calls.push('stop');
    },
  };
  return { term: { selectionManager } as unknown as Terminal, selectionManager, calls };
}

describe('terminal selection auto-scroll', () => {
  describe('a drag inside the pane', () => {
    it('[FR-TERMINAL-520] should stop the buffer scrolling, however close to an edge it sits', () => {
      const { term, selectionManager, calls } = createFakeTerminal();

      confineSelectionAutoScroll(term);
      selectionManager.updateAutoScroll(5, 200);
      selectionManager.updateAutoScroll(195, 200);

      expect(calls).toEqual(['stop', 'stop']);
    });

    it('[FR-TERMINAL-520] should leave the scrolling a drag out of the pane relies on', () => {
      const { term, selectionManager, calls } = createFakeTerminal();
      const { startAutoScroll, stopAutoScroll } = selectionManager;

      confineSelectionAutoScroll(term);

      // The emulator drives these two directly from its own mouseleave,
      // mouseenter and document-level move handlers. Replacing either would
      // take the auto-scroll of a drag beyond the pane with it.
      expect(selectionManager.startAutoScroll).toBe(startAutoScroll);
      expect(selectionManager.stopAutoScroll).toBe(stopAutoScroll);

      selectionManager.startAutoScroll(-1);
      expect(calls).toEqual(['start:-1']);
    });
  });

  describe('an emulator that no longer has the hook', () => {
    it('should report the missing member rather than fail', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => confineSelectionAutoScroll({} as unknown as Terminal)).not.toThrow();
      expect(error).toHaveBeenCalledOnce();

      error.mockRestore();
    });

    it('should hold a selection manager that cannot stop either', () => {
      const selectionManager = { updateAutoScroll: () => {} };
      const term = { selectionManager } as unknown as Terminal;

      confineSelectionAutoScroll(term);

      expect(() => selectionManager.updateAutoScroll()).not.toThrow();
    });
  });
});
