interface FocusablePanel {
  api: { setActive(): void };
}

interface FocusableDock {
  getPanel(id: string): FocusablePanel | undefined;
}

export const FOCUS_REQUEST_TIMEOUT_MS = 10_000;

export function createPendingFocus(onActivated: (sessionId: string) => void) {
  let pendingId: string | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    pendingId = null;
    clearTimeout(expiry);
  }

  function activate(dock: FocusableDock, sessionId: string): boolean {
    const panel = dock.getPanel(sessionId);
    if (!panel) return false;
    panel.api.setActive();
    onActivated(sessionId);
    return true;
  }

  return {
    request(sessionId: string, dock: FocusableDock | null): void {
      if (dock && activate(dock, sessionId)) return;
      clearTimeout(expiry);
      pendingId = sessionId;
      expiry = setTimeout(clear, FOCUS_REQUEST_TIMEOUT_MS);
    },
    flush(dock: FocusableDock): void {
      if (pendingId && activate(dock, pendingId)) clear();
    },
  };
}
