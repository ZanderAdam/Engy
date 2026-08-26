// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveInjectTarget } from './terminal-manager';

/**
 * Tests for the tabId-scoped event filtering in TerminalManager.
 *
 * TerminalManager itself is a complex Dockview-based component and is not
 * feasible to unit test with renderHook. These tests verify the filter
 * predicate logic in isolation, ensuring the correct guard condition is met.
 */

describe('TerminalManager tabId filter predicate', () => {
  /**
   * The guard logic extracted from the terminal-manager listeners:
   *   if (tabId != null && tabId !== myTabId) return;
   *
   * Returns true if the event should be processed (not filtered out).
   */
  function shouldProcess(eventTabId: string | undefined | null, myTabId: string | null): boolean {
    if (eventTabId != null && eventTabId !== myTabId) return false;
    return true;
  }

  describe('when event has no tabId (broadcast)', () => {
    it('should process the event regardless of myTabId', () => {
      expect(shouldProcess(undefined, 'tab-a')).toBe(true);
      expect(shouldProcess(undefined, 'tab-b')).toBe(true);
      expect(shouldProcess(undefined, null)).toBe(true);
    });

    // useTabId() returns null (not undefined) outside a TabContext, which is
    // where the voice indicator lives. Treating that null as a tab address
    // meant every manager dropped dictation silently.
    it('should process a null tabId as broadcast, not as an unmatched address', () => {
      expect(shouldProcess(null, 'tab-a')).toBe(true);
      expect(shouldProcess(null, null)).toBe(true);
    });
  });

  describe('when event tabId matches myTabId', () => {
    it('should process the event', () => {
      expect(shouldProcess('tab-a', 'tab-a')).toBe(true);
    });
  });

  describe('when event tabId does not match myTabId', () => {
    it('should filter out the event', () => {
      expect(shouldProcess('tab-a', 'tab-b')).toBe(false);
      expect(shouldProcess('tab-a', null)).toBe(false);
    });
  });
});

describe('broadcastActive global flag gate', () => {
  /**
   * The logic for writing window.__engy_terminal_active:
   *   if (!tabId || isActiveRef.current) { window.__engy_terminal_active = hasActiveTab; }
   *
   * Returns true if the global flag should be written.
   */
  function shouldWriteGlobalFlag(myTabId: string | null, isActive: boolean): boolean {
    return !myTabId || isActive;
  }

  it('should write global flag when there is no tabId (no TabContext)', () => {
    expect(shouldWriteGlobalFlag(null, false)).toBe(true);
    expect(shouldWriteGlobalFlag(null, true)).toBe(true);
  });

  it('should write global flag when current tab is the active tab', () => {
    expect(shouldWriteGlobalFlag('tab-a', true)).toBe(true);
  });

  it('should NOT write global flag when current tab is inactive', () => {
    expect(shouldWriteGlobalFlag('tab-a', false)).toBe(false);
    expect(shouldWriteGlobalFlag('tab-b', false)).toBe(false);
  });
});

describe('flag ownership cleanup (Bug B fix)', () => {
  /**
   * Simulates the cleanup logic:
   *   if (wroteActiveTrueRef.current) window.__engy_terminal_active = false;
   *
   * Previously: cleanup cleared only when !tabId (never, since every manager
   * has a tabId) — leaving the global stuck at true after tab close.
   */
  function simulateCleanup(
    wroteActiveTrue: boolean,
    globalBefore: boolean,
  ): boolean {
    let global = globalBefore;
    if (wroteActiveTrue) global = false;
    return global;
  }

  it('clears global when this manager last wrote true', () => {
    expect(simulateCleanup(true, true)).toBe(false);
  });

  it('does NOT clear global when this manager never wrote true', () => {
    // Tab B (inactive) unmounts — should leave Tab A's flag intact
    expect(simulateCleanup(false, true)).toBe(true);
  });

  it('is a no-op when global was already false', () => {
    expect(simulateCleanup(true, false)).toBe(false);
    expect(simulateCleanup(false, false)).toBe(false);
  });
});

describe('window event dispatching with tabId', () => {
  let dispatched: CustomEvent[] = [];

  beforeEach(() => {
    dispatched = [];
    window.addEventListener('terminal:active-changed', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:activity-changed', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:inject', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:open', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:focus', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:close', (e) => dispatched.push(e as CustomEvent));
  });

  afterEach(() => {
    dispatched = [];
  });

  it('terminal:active-changed should carry tabId in detail', () => {
    const TAB_ID = 'tab-test-1';
    window.dispatchEvent(
      new CustomEvent('terminal:active-changed', { detail: { hasActiveTab: true, tabId: TAB_ID } }),
    );
    expect(dispatched[0].detail.tabId).toBe(TAB_ID);
    expect(dispatched[0].detail.hasActiveTab).toBe(true);
  });

  it('terminal:activity-changed should carry tabId in detail', () => {
    const TAB_ID = 'tab-test-2';
    window.dispatchEvent(
      new CustomEvent('terminal:activity-changed', {
        detail: { sessionId: 'sess-1', activityState: 'active', tabId: TAB_ID },
      }),
    );
    expect(dispatched[0].detail.tabId).toBe(TAB_ID);
    expect(dispatched[0].detail.sessionId).toBe('sess-1');
  });

  it('terminal:open should carry tabId from sender', () => {
    const TAB_ID = 'tab-sender';
    window.dispatchEvent(
      new CustomEvent('terminal:open', {
        detail: { scope: { scopeType: 'workspace' }, tabId: TAB_ID },
      }),
    );
    expect(dispatched[0].detail.tabId).toBe(TAB_ID);
  });

  it('terminal:focus should carry tabId from sender', () => {
    const TAB_ID = 'tab-focus';
    window.dispatchEvent(
      new CustomEvent('terminal:focus', {
        detail: { sessionId: 'sess-focus', tabId: TAB_ID },
      }),
    );
    expect(dispatched[0].detail.tabId).toBe(TAB_ID);
    expect(dispatched[0].detail.sessionId).toBe('sess-focus');
  });

  it('terminal:close should carry sessionId and tabId from sender', () => {
    const TAB_ID = 'tab-close';
    window.dispatchEvent(
      new CustomEvent('terminal:close', {
        detail: { sessionId: 'sess-close', tabId: TAB_ID },
      }),
    );
    expect(dispatched[0].detail.tabId).toBe(TAB_ID);
    expect(dispatched[0].detail.sessionId).toBe('sess-close');
  });
});

describe('resolveInjectTarget', () => {
  const base = {
    eventTabId: undefined as string | undefined | null,
    myTabId: null as string | null,
    terminalId: undefined as string | undefined,
    disableExternalEvents: false,
    primaryReady: false,
    activePanelId: 'panel-1',
    hasHandler: () => true,
  };

  it('declines when the event addresses a different tab', () => {
    expect(resolveInjectTarget({ ...base, eventTabId: 'tab-a', myTabId: 'tab-b' })).toBeNull();
  });

  it('a null event tabId is a broadcast, not an address no one owns', () => {
    expect(resolveInjectTarget({ ...base, eventTabId: null, myTabId: 'tab-a' })).toBe('panel-1');
  });

  it('declines when there is no active panel', () => {
    expect(resolveInjectTarget({ ...base, activePanelId: undefined })).toBeNull();
  });

  it('declines when the active panel has no registered write handler', () => {
    expect(resolveInjectTarget({ ...base, hasHandler: () => false })).toBeNull();
  });

  it('an explicit terminalId is targeted directly, bypassing activePanelId', () => {
    expect(resolveInjectTarget({ ...base, terminalId: 'panel-2', activePanelId: 'panel-1' })).toBe(
      'panel-2',
    );
  });

  // Regression: the BOTTOM (fallback, disableExternalEvents=true) manager's
  // terminal:inject listener registers before the RIGHT (primary) manager's —
  // it lives in ThreePanelLayout's centerContent, mounted ahead of
  // rightContent — so a plain "first eligible listener claims it" race always
  // let a collapsed, invisible BOTTOM terminal steal dictation from a visible
  // RIGHT one. Without the primaryReady guard, resolveInjectTarget would
  // return 'panel-1' here (BOTTOM has an active panel + handler) even though
  // a primary is ready and should take it instead.
  describe('fallback (BOTTOM) defers to a ready primary', () => {
    it('a fallback manager with its own active panel still declines when a primary is ready', () => {
      expect(
        resolveInjectTarget({ ...base, disableExternalEvents: true, primaryReady: true }),
      ).toBeNull();
    });

    it('a fallback manager claims when no primary is ready (the right panel is empty)', () => {
      expect(
        resolveInjectTarget({ ...base, disableExternalEvents: true, primaryReady: false }),
      ).toBe('panel-1');
    });

    it('a primary manager (disableExternalEvents=false) always claims its own active panel', () => {
      expect(
        resolveInjectTarget({ ...base, disableExternalEvents: false, primaryReady: true }),
      ).toBe('panel-1');
    });

    it('an explicit terminalId bypasses the defer-to-primary guard', () => {
      expect(
        resolveInjectTarget({
          ...base,
          disableExternalEvents: true,
          primaryReady: true,
          terminalId: 'panel-1',
        }),
      ).toBe('panel-1');
    });
  });
});
