import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty } from 'node-pty';
import type { Terminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { SessionManager } from './session-manager.js';
import type { PersistentSession } from './types.js';

const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 99999,
  process: 'bash',
  cols: 80,
  rows: 24,
} satisfies Partial<IPty>;

function makeSession(id: string): PersistentSession {
  return {
    sessionId: id,
    state: 'active',
    screen: { dispose: vi.fn() } as unknown as Terminal,
    serializeAddon: { serialize: vi.fn(() => '') } as unknown as SerializeAddon,
    lastActivity: Date.now(),
    initialCommandSent: false,
    ptyProcess: mockPtyProcess as unknown as IPty,
    workingDir: '/tmp',
  };
}

describe('SessionManager', () => {
  describe('cleanup timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('[FR-TERMINAL-040] should kill a suspended session after the expiry window and fire the expire callback', () => {
      const mgr = new SessionManager();
      const expired: string[] = [];
      mgr.setExpireCallback((id) => expired.push(id));
      mgr.start();

      const session = makeSession('sess-1');
      session.state = 'suspended';
      session.suspendedAt = Date.now();
      mgr.set('sess-1', session);

      // Advance past 5-minute expiry (SESSION_EXPIRY_MS = 5 * 60 * 1000).
      // The cleanup interval fires every 30s; advance 6 minutes so the 12th tick
      // sees now - suspendedAt = 360000 > 300000.
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(expired).toContain('sess-1');
      expect(mockPtyProcess.kill).toHaveBeenCalled();
      expect(mgr.get('sess-1')).toBeUndefined();

      mgr.stop();
    });

    it('should not expire an active session', () => {
      const mgr = new SessionManager();
      const expired: string[] = [];
      mgr.setExpireCallback((id) => expired.push(id));
      mgr.start();

      const session = makeSession('active-sess');
      session.state = 'active';
      mgr.set('active-sess', session);

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(expired).not.toContain('active-sess');
      expect(mgr.get('active-sess')).toBeDefined();

      mgr.stop();
    });

    it('should not expire a session that was suspended recently', () => {
      const mgr = new SessionManager();
      const expired: string[] = [];
      mgr.setExpireCallback((id) => expired.push(id));
      mgr.start();

      const session = makeSession('fresh-sess');
      session.state = 'suspended';
      session.suspendedAt = Date.now();
      mgr.set('fresh-sess', session);

      // Advance only 2 minutes — not yet expired
      vi.advanceTimersByTime(2 * 60 * 1000);

      expect(expired).not.toContain('fresh-sess');
      expect(mgr.get('fresh-sess')).toBeDefined();

      mgr.stop();
    });

    it('should not run cleanup after stop() is called', () => {
      const mgr = new SessionManager();
      const expired: string[] = [];
      mgr.setExpireCallback((id) => expired.push(id));
      mgr.start();

      const session = makeSession('stopped-sess');
      session.state = 'suspended';
      session.suspendedAt = Date.now();
      mgr.set('stopped-sess', session);

      mgr.stop();

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(expired).not.toContain('stopped-sess');
    });
  });
});
