// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestTerminalFocus } from './focus-confirmation';
import { createPendingFocus, FOCUS_REQUEST_TIMEOUT_MS } from './pending-focus';

function announce(sessionId: string, tabId?: string): void {
  window.dispatchEvent(new CustomEvent('terminal:focused', { detail: { sessionId, tabId } }));
}

describe('requestTerminalFocus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('with a mounted dock', () => {
    function mountDock(panelIds: string[]) {
      const pending = createPendingFocus((sessionId) => announce(sessionId, 'tab-1'));
      const dock = {
        getPanel: (id: string) =>
          panelIds.includes(id) ? { api: { setActive: () => undefined } } : undefined,
      };
      function onFocus(e: Event) {
        pending.request((e as CustomEvent<{ sessionId: string }>).detail.sessionId, dock);
      }
      window.addEventListener('terminal:focus', onFocus);
      return () => window.removeEventListener('terminal:focus', onFocus);
    }

    it('[FR-TERMINAL-1150] should not warn when the dock confirms inside the focus dispatch', () => {
      vi.useFakeTimers();
      const unmount = mountDock(['s1']);
      const onMissing = vi.fn();

      requestTerminalFocus({ sessionId: 's1', tabId: 'tab-1', dock: 'terminal', onMissing });
      vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);

      expect(onMissing).not.toHaveBeenCalled();
      unmount();
    });

    it('[FR-TERMINAL-1150] should warn when the mounted dock does not list the session', () => {
      vi.useFakeTimers();
      const unmount = mountDock(['other']);
      const onMissing = vi.fn();

      requestTerminalFocus({ sessionId: 's1', tabId: 'tab-1', dock: 'terminal', onMissing });
      vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);

      expect(onMissing).toHaveBeenCalledOnce();
      unmount();
    });
  });

  it('[FR-TERMINAL-1150] should stay quiet when a manager confirms the focus', () => {
    vi.useFakeTimers();
    const onMissing = vi.fn();
    requestTerminalFocus({ sessionId: 's1', tabId: 'tab-1', dock: 'terminal', onMissing });

    announce('s1', 'tab-1');
    vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);

    expect(onMissing).not.toHaveBeenCalled();
  });

  it('[FR-TERMINAL-1150] should report a terminal that no manager shows', () => {
    vi.useFakeTimers();
    const onMissing = vi.fn();
    requestTerminalFocus({ sessionId: 's1', tabId: 'tab-1', dock: 'terminal', onMissing });

    vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);

    expect(onMissing).toHaveBeenCalledOnce();
  });

  it('[FR-TERMINAL-1150] should ignore confirmations for another session or tab', () => {
    vi.useFakeTimers();
    const onMissing = vi.fn();
    requestTerminalFocus({ sessionId: 's1', tabId: 'tab-1', dock: 'terminal', onMissing });

    announce('other', 'tab-1');
    announce('s1', 'tab-2');
    vi.advanceTimersByTime(FOCUS_REQUEST_TIMEOUT_MS + 1);

    expect(onMissing).toHaveBeenCalledOnce();
  });
});
