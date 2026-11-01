// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileShellTerminalSheet, MobileTerminalSheet } from './mobile-terminal-sheet';
import { MobileOverlayProvider, useMobileOverlay } from './mobile-overlay-context';

vi.mock('@/components/terminal/terminal-manager', () => ({ TerminalManager: () => null }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => children,
  SheetContent: ({ children }: { children: ReactNode }) => children,
  SheetTitle: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/terminal/use-terminal-scope', () => ({
  useTerminalScope: () => ({ groupKey: 'project:ws:proj' }),
  useBottomTerminalScope: () => ({ groupKey: 'shell:project:ws:proj' }),
}));

function OverlayProbe() {
  return useMobileOverlay().overlay ?? 'closed';
}

describe('Mobile terminal sheets', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let probe: HTMLSpanElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(
          MobileOverlayProvider,
          null,
          createElement('span', { id: 'probe' }, createElement(OverlayProbe)),
          createElement(MobileTerminalSheet),
          createElement(MobileShellTerminalSheet),
        ),
      ),
    );
    probe = container.querySelector<HTMLSpanElement>('#probe')!;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function focus(detail: { sessionId: string; groupKey?: string; dock?: 'terminal' | 'shell' }) {
    act(() => {
      window.dispatchEvent(new CustomEvent('terminal:focus', { detail }));
    });
  }

  describe('terminal:focus while closed', () => {
    it('[FR-TERMINAL-1060] should open the shell sheet for a shell session', () => {
      focus({ sessionId: 's1', groupKey: 'shell:project:ws:proj' });
      expect(probe.textContent).toBe('shell');
    });

    it('[FR-TERMINAL-1060] should open the Claude sheet for a project session', () => {
      focus({ sessionId: 's1', groupKey: 'project:ws:proj' });
      expect(probe.textContent).toBe('terminal');
    });

    it('[FR-TERMINAL-1060] should keep the shell sheet for a terminal link to a shell', () => {
      focus({ sessionId: 's1', dock: 'shell' });
      expect(probe.textContent).toBe('shell');
    });

    it('[FR-TERMINAL-1060] should keep the shell sheet when a link reveal replays its focus', () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 1));
      const box = vi
        .spyOn(Element.prototype, 'getBoundingClientRect')
        .mockReturnValue({ left: 0, top: 0, width: 10, height: 10 } as DOMRect);

      act(() => {
        window.dispatchEvent(
          new CustomEvent('terminal:reveal', { detail: { sessionId: 's1', dock: 'shell' } }),
        );
      });
      const replayed: unknown[] = [];
      const record = (e: Event) => replayed.push((e as CustomEvent).detail);
      window.addEventListener('terminal:focus', record);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        vi.advanceTimersByTime(1);
      });
      window.removeEventListener('terminal:focus', record);
      box.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();

      expect(probe.textContent).toBe('shell');
      expect(replayed).toEqual([expect.objectContaining({ sessionId: 's1', dock: 'shell' })]);
    });

    it('[FR-TERMINAL-1060] should open the Claude sheet when the sender gives no group key', () => {
      focus({ sessionId: 's1' });
      expect(probe.textContent).toBe('terminal');
    });
  });
});
