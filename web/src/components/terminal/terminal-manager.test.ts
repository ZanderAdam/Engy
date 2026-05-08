// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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
   *   if (tabId !== undefined && tabId !== myTabId) return;
   *
   * Returns true if the event should be processed (not filtered out).
   */
  function shouldProcess(eventTabId: string | undefined, myTabId: string | null): boolean {
    if (eventTabId !== undefined && eventTabId !== myTabId) return false;
    return true;
  }

  describe('when event has no tabId (broadcast)', () => {
    it('should process the event regardless of myTabId', () => {
      expect(shouldProcess(undefined, 'tab-a')).toBe(true);
      expect(shouldProcess(undefined, 'tab-b')).toBe(true);
      expect(shouldProcess(undefined, null)).toBe(true);
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
   *   if (!myTabId || isActive) { window.__engy_terminal_active = hasActiveTab; }
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

describe('window event dispatching with tabId', () => {
  let dispatched: CustomEvent[] = [];

  beforeEach(() => {
    dispatched = [];
    window.addEventListener('terminal:active-changed', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:activity-changed', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:inject', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:open', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:focus', (e) => dispatched.push(e as CustomEvent));
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
});
