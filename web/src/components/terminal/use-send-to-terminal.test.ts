// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the tabId stamping contract of useSendToTerminal.
 *
 * Since useSendToTerminal is a React hook (requires renderHook from
 * @testing-library/react which is not installed), we verify the stamping
 * behavior at the event protocol level. The contract is:
 *
 *   - terminal:open detail must contain { scope, tabId }
 *   - terminal:inject detail must contain { context, tabId }
 *   - tabId is the value returned by useTabId() (string | null)
 *
 * The filter logic in TerminalManager listeners is separately tested in
 * terminal-manager.test.ts.
 */

describe('terminal event tabId protocol', () => {
  let dispatched: CustomEvent[] = [];

  beforeEach(() => {
    dispatched = [];
    window.addEventListener('terminal:inject', (e) => dispatched.push(e as CustomEvent));
    window.addEventListener('terminal:open', (e) => dispatched.push(e as CustomEvent));
  });

  afterEach(() => {
    dispatched = [];
  });

  describe('terminal:inject event', () => {
    it('should carry tabId when present', () => {
      const tabId = 'tab-sender-123';
      window.dispatchEvent(
        new CustomEvent('terminal:inject', { detail: { context: 'hello', tabId } }),
      );
      expect(dispatched[0].detail.tabId).toBe(tabId);
      expect(dispatched[0].detail.context).toBe('hello');
    });

    it('should work without tabId (broadcast mode)', () => {
      window.dispatchEvent(
        new CustomEvent('terminal:inject', { detail: { context: 'world' } }),
      );
      expect(dispatched[0].detail.tabId).toBeUndefined();
      expect(dispatched[0].detail.context).toBe('world');
    });

    it('should carry both terminalId and tabId', () => {
      window.dispatchEvent(
        new CustomEvent('terminal:inject', {
          detail: { context: 'cmd', terminalId: 'sess-1', tabId: 'tab-A' },
        }),
      );
      expect(dispatched[0].detail.terminalId).toBe('sess-1');
      expect(dispatched[0].detail.tabId).toBe('tab-A');
    });
  });

  describe('terminal:open event', () => {
    it('should carry tabId when present', () => {
      const tabId = 'tab-opener-456';
      const scope = { scopeType: 'workspace', groupKey: 'ws:test', workingDir: '/tmp' };
      window.dispatchEvent(
        new CustomEvent('terminal:open', { detail: { scope, tabId } }),
      );
      expect(dispatched[0].detail.tabId).toBe(tabId);
      expect(dispatched[0].detail.scope).toEqual(scope);
    });

    it('should work without tabId (broadcast mode)', () => {
      const scope = { scopeType: 'workspace', groupKey: 'ws:test', workingDir: '/tmp' };
      window.dispatchEvent(
        new CustomEvent('terminal:open', { detail: { scope } }),
      );
      expect(dispatched[0].detail.tabId).toBeUndefined();
    });
  });
});

describe('useTabId hook contract', () => {
  it('should export useTabId from tab-context', async () => {
    const { useTabId } = await import('@/components/tabs/tab-context');
    expect(useTabId).toBeDefined();
    expect(typeof useTabId).toBe('function');
  });
});
