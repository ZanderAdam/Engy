// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomTerminalSplit } from './bottom-terminal-split';

const manager = vi.hoisted(() => ({ onReveal: undefined as (() => void) | undefined }));

vi.mock('./terminal-manager', async () => {
  const { createElement: h } = await import('react');
  return {
    TerminalManager: ({ onReveal }: { onReveal?: () => void }) => {
      manager.onReveal = onReveal;
      return h('div', { id: 'manager' });
    },
  };
});
vi.mock('./bottom-terminal-toggle', () => ({ BottomTerminalToggle: () => null }));
vi.mock('./use-terminal-scope', () => ({
  useBottomTerminalScope: () => ({ groupKey: 'shell:ws:proj' }),
}));

describe('BottomTerminalSplit', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  describe('reveal', () => {
    it('[FR-TERMINAL-1060] should expand the collapsed dock when its manager reveals', () => {
      act(() => root.render(createElement(BottomTerminalSplit, null, 'page')));
      const clip = container.querySelector<HTMLElement>('#manager')!.parentElement!.parentElement!;
      expect(clip.style.visibility).toBe('hidden');

      act(() => manager.onReveal?.());

      expect(clip.style.visibility).toBe('visible');
    });
  });
});
