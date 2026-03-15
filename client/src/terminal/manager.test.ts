import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty } from 'node-pty';
import { CircularBuffer } from './circular-buffer.js';
import { SessionManager } from './session-manager.js';
import { TerminalManager } from './manager.js';

// Mock node-pty
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345,
  process: 'bash',
  cols: 80,
  rows: 24,
} satisfies Partial<IPty>;

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => mockPtyProcess),
  },
}));

import pty from 'node-pty';
const mockedSpawn = vi.mocked(pty.spawn);

describe('CircularBuffer', () => {
  it('stores written items', () => {
    const buf = new CircularBuffer(5);
    buf.write('a');
    buf.write('b');
    expect(buf.toArray()).toEqual(['a', 'b']);
    expect(buf.length).toBe(2);
  });

  it('wraps around when capacity exceeded', () => {
    const buf = new CircularBuffer(3);
    buf.write('a');
    buf.write('b');
    buf.write('c');
    buf.write('d'); // overwrites 'a'
    expect(buf.toArray()).toEqual(['b', 'c', 'd']);
    expect(buf.length).toBe(3);
  });

  it('returns empty array when empty', () => {
    const buf = new CircularBuffer(5);
    expect(buf.toArray()).toEqual([]);
    expect(buf.length).toBe(0);
  });
});

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  afterEach(() => {
    mgr.stop();
  });

  it('stores and retrieves sessions', () => {
    const session = {
      sessionId: 'test',
      state: 'active' as const,
      outputBuffer: new CircularBuffer(),
      lastActivity: Date.now(),
      initialCommandSent: false,
      ptyProcess: mockPtyProcess as unknown as IPty,
      workingDir: '/tmp',
    };
    mgr.set('test', session);
    expect(mgr.get('test')).toBe(session);
  });

  it('deletes sessions', () => {
    const session = {
      sessionId: 'test',
      state: 'active' as const,
      outputBuffer: new CircularBuffer(),
      lastActivity: Date.now(),
      initialCommandSent: false,
      ptyProcess: mockPtyProcess as unknown as IPty,
      workingDir: '/tmp',
    };
    mgr.set('test', session);
    mgr.delete('test');
    expect(mgr.get('test')).toBeUndefined();
  });

  it('returns all sessions', () => {
    const makeSession = (id: string) => ({
      sessionId: id,
      state: 'active' as const,
      outputBuffer: new CircularBuffer(),
      lastActivity: Date.now(),
      initialCommandSent: false,
      ptyProcess: mockPtyProcess as unknown as IPty,
      workingDir: '/tmp',
    });
    mgr.set('a', makeSession('a'));
    mgr.set('b', makeSession('b'));
    expect(mgr.all()).toHaveLength(2);
  });
});

describe('TerminalManager', () => {
  let sessions: SessionManager;
  let manager: TerminalManager;
  let sent: string[];
  let onDataCallback: ((data: string) => void) | null;
  let onExitCallback: ((ev: { exitCode: number; signal?: number }) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    sent = [];
    onDataCallback = null;
    onExitCallback = null;

    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      onDataCallback = cb;
      return { dispose: vi.fn() };
    });
    mockPtyProcess.onExit.mockImplementation(
      (cb: (ev: { exitCode: number; signal?: number }) => void) => {
        onExitCallback = cb;
        return { dispose: vi.fn() };
      },
    );

    sessions = new SessionManager();
    manager = new TerminalManager(sessions);
    manager.setSendCallback((msg) => sent.push(msg));
  });

  afterEach(() => {
    sessions.stop();
  });

  it('spawns a pty process with correct options', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ cols: 80, rows: 24, cwd: '/tmp', name: 'xterm-256color' }),
    );
  });

  it('relays pty output in compact format when session is active', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });

    onDataCallback?.('hello');

    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg.t).toBe('o');
    expect(msg.sessionId).toBe('abc');
    expect(msg.d).toBe('hello');
  });

  it('buffers output without sending when suspended', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.suspend('abc');
    onDataCallback?.('hello');
    expect(sent).toHaveLength(0);
    const session = sessions.get('abc')!;
    expect(session.outputBuffer.toArray()).toContain('hello');
  });

  it('sends initial command on first data event', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24, command: 'ls' });
    onDataCallback?.('$');

    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\r');
    expect(sessions.get('abc')!.initialCommandSent).toBe(true);
  });

  it('sends compact exit message when pty exits', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    onExitCallback?.({ exitCode: 0 });

    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg.t).toBe('exit');
    expect(msg.exitCode).toBe(0);
    expect(msg.sessionId).toBe('abc');
    expect(sessions.get('abc')).toBeUndefined();
  });

  it('writes raw input to pty', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.write('abc', 'hello');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('hello');
  });

  it('resizes the pty', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.resize('abc', 100, 30);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(100, 30);
  });

  it('kills a session and sends SIGTERM', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.kill('abc');
    expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(sessions.get('abc')).toBeUndefined();
  });

  it('kills all sessions on shutdown', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.spawn({ sessionId: 'def', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.killAll();
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(2);
  });

  it('replays buffer on reconnect in compact format', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    onDataCallback?.('line1');
    onDataCallback?.('line2');

    // Clear sent messages from the initial data events
    sent.length = 0;
    manager.suspend('abc');
    manager.handleReconnect('abc');

    const replayMsg = JSON.parse(sent[0]);
    expect(replayMsg.t).toBe('reconnected');
    expect(replayMsg.sessionId).toBe('abc');
    expect(replayMsg.buffer).toContain('line1');
    expect(replayMsg.buffer).toContain('line2');
  });

  it('sends compact exit for unknown session on reconnect', () => {
    manager.handleReconnect('unknown');
    const msg = JSON.parse(sent[0]);
    expect(msg.t).toBe('exit');
    expect(msg.sessionId).toBe('unknown');
    expect(msg.exitCode).toBe(-1);
  });

  it('sends exit with code -1 when session expires', () => {
    // The constructor wires up an expire callback on the SessionManager.
    // Access it via the private field to simulate an expiry event.
    const cb = (sessions as unknown as { onExpire: (id: string) => void }).onExpire;
    cb('expired-session');

    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg).toEqual({ t: 'exit', sessionId: 'expired-session', exitCode: -1 });
  });

  it('ignores write for unknown or expired session', () => {
    manager.write('nonexistent', 'x');
    expect(mockPtyProcess.write).not.toHaveBeenCalled();
  });
});
