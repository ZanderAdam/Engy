import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty } from 'node-pty';
import type { Terminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
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

function makeStubSession(id: string) {
  return {
    sessionId: id,
    state: 'active' as const,
    screen: { dispose: vi.fn() } as unknown as Terminal,
    serializeAddon: { serialize: vi.fn(() => '') } as unknown as SerializeAddon,
    lastActivity: Date.now(),
    initialCommandSent: false,
    ptyProcess: mockPtyProcess as unknown as IPty,
    workingDir: '/tmp',
  };
}

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  it('stores and retrieves sessions', () => {
    const session = makeStubSession('test');
    mgr.set('test', session);
    expect(mgr.get('test')).toBe(session);
  });

  it('deletes sessions', () => {
    mgr.set('test', makeStubSession('test'));
    mgr.delete('test');
    expect(mgr.get('test')).toBeUndefined();
  });

  it('returns all sessions', () => {
    mgr.set('a', makeStubSession('a'));
    mgr.set('b', makeStubSession('b'));
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

  // The snapshot is serialized behind xterm's async write queue, so the
  // reconnected message lands a tick after handleReconnect returns.
  async function reconnectSnapshot(sessionId: string) {
    manager.handleReconnect(sessionId);
    await vi.waitFor(() =>
      expect(sent.some((m) => m.startsWith('{"t":"reconnected"'))).toBe(true),
    );
    return JSON.parse(sent.find((m) => m.startsWith('{"t":"reconnected"'))!);
  }

  it('spawns a pty process with correct options', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ cols: 80, rows: 24, cwd: '/tmp', name: 'xterm-256color' }),
    );
  });

  it('[FR-TERMINAL-430] sets CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD in the pty env', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        env: expect.objectContaining({ CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' }),
      }),
    );
  });

  it('[FR-TERMINAL-430] forwards CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD into container sessions', () => {
    manager.spawn({
      sessionId: 'abc',
      workingDir: '/tmp',
      cols: 80,
      rows: 24,
      containerWorkspaceFolder: '/ws',
    });
    const args = mockedSpawn.mock.calls[0][1] as string[];
    expect(mockedSpawn.mock.calls[0][0]).toBe('devcontainer');
    expect(args).toContain('--remote-env');
    expect(args).toContain('CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1');
  });

  it('[FR-TERMINAL-430] forwards CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD into coder sessions', () => {
    manager.spawn({
      sessionId: 'abc',
      workingDir: '/tmp',
      cols: 80,
      rows: 24,
      coderWorkspace: 'my-ws',
    });
    const args = mockedSpawn.mock.calls[0][1] as string[];
    expect(mockedSpawn.mock.calls[0][0]).toBe('coder');
    expect(args).toContain('-e');
    expect(args).toContain('CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1');
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

  it('[FR-TERMINAL-040] buffers output without sending when suspended', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.suspend('abc');
    onDataCallback?.('hello');
    expect(sent).toHaveLength(0);

    // The suspended output must still be present in the resync snapshot.
    const replay = await reconnectSnapshot('abc');
    expect(replay.snapshot).toContain('hello');
  });

  it('sends initial command on first data event', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24, command: 'ls' });
    onDataCallback?.('$');

    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\r');
    expect(sessions.get('abc')!.initialCommandSent).toBe(true);
  });

  it('[FR-TERMINAL-090] sends compact exit message when pty exits', () => {
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

  it('resizes the pty and the headless screen mirror', () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.resize('abc', 100, 30);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(100, 30);
    const screen = sessions.get('abc')!.screen;
    expect(screen.cols).toBe(100);
    expect(screen.rows).toBe(30);
  });

  it('[FR-TERMINAL-080] kills a session and sends SIGTERM', () => {
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

  it('[FR-TERMINAL-050] replies with a serialized snapshot on reconnect', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    onDataCallback?.('line1\r\n');
    onDataCallback?.('line2');

    // Clear sent messages from the initial data events
    sent.length = 0;
    manager.suspend('abc');

    const replayMsg = await reconnectSnapshot('abc');
    expect(replayMsg.t).toBe('reconnected');
    expect(replayMsg.sessionId).toBe('abc');
    expect(replayMsg.snapshot).toContain('line1');
    expect(replayMsg.snapshot).toContain('line2');
  });

  it('[FR-TERMINAL-450] serializes only the screen for command sessions', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24, command: 'claude' });
    for (let i = 0; i < 40; i++) onDataCallback?.(`frame${i}\r\n`);
    sent.length = 0;
    manager.suspend('abc');

    const replayMsg = await reconnectSnapshot('abc');
    expect(replayMsg.snapshot).toContain('frame39');
    expect(replayMsg.snapshot).not.toContain('frame5');
  });

  it('[FR-TERMINAL-450] serializes only the screen for coder command sessions', async () => {
    manager.spawn({
      sessionId: 'abc',
      workingDir: '/tmp',
      cols: 80,
      rows: 24,
      command: 'claude',
      coderWorkspace: 'my-ws',
    });
    for (let i = 0; i < 40; i++) onDataCallback?.(`frame${i}\r\n`);
    sent.length = 0;
    manager.suspend('abc');

    const replayMsg = await reconnectSnapshot('abc');
    expect(replayMsg.snapshot).toContain('frame39');
    expect(replayMsg.snapshot).not.toContain('frame5');
    // The command rides in the SSH shell invocation — never typed into the PTY.
    expect(mockPtyProcess.write).not.toHaveBeenCalled();
  });

  it('[FR-TERMINAL-450] keeps full scrollback in snapshots for plain sessions', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    for (let i = 0; i < 40; i++) onDataCallback?.(`frame${i}\r\n`);
    sent.length = 0;
    manager.suspend('abc');

    const replayMsg = await reconnectSnapshot('abc');
    expect(replayMsg.snapshot).toContain('frame5');
    expect(replayMsg.snapshot).toContain('frame39');
  });

  it('skips the snapshot when the session is killed before the flush fires', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.suspend('abc');
    manager.handleReconnect('abc');
    // Kill lands before xterm's deferred flush callback — the disposed screen
    // must not be serialized and no reconnected message may go out.
    manager.kill('abc');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.some((m) => m.startsWith('{"t":"reconnected"'))).toBe(false);
  });

  it('marks the session active again on reconnect', async () => {
    manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
    manager.suspend('abc');
    expect(sessions.get('abc')!.state).toBe('suspended');

    await reconnectSnapshot('abc');
    expect(sessions.get('abc')!.state).toBe('active');
    expect(sessions.get('abc')!.suspendedAt).toBeUndefined();
  });

  it('sends compact exit for unknown session on reconnect', () => {
    manager.handleReconnect('unknown');
    const msg = JSON.parse(sent[0]);
    expect(msg.t).toBe('exit');
    expect(msg.sessionId).toBe('unknown');
    expect(msg.exitCode).toBe(-1);
  });

  it('[FR-TERMINAL-040] sends exit with code -1 when session expires', () => {
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

  describe('headless screen disposal', () => {
    it('disposes the screen when the pty exits', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const disposeSpy = vi.spyOn(sessions.get('abc')!.screen, 'dispose');
      onExitCallback?.({ exitCode: 0 });
      expect(disposeSpy).toHaveBeenCalledOnce();
    });

    it('disposes the screen on kill', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const disposeSpy = vi.spyOn(sessions.get('abc')!.screen, 'dispose');
      manager.kill('abc');
      expect(disposeSpy).toHaveBeenCalledOnce();
    });

    it('disposes the screen on session expiry', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const disposeSpy = vi.spyOn(sessions.get('abc')!.screen, 'dispose');
      const cb = (sessions as unknown as { onExpire: (id: string) => void }).onExpire;
      cb('abc');
      expect(disposeSpy).toHaveBeenCalledOnce();
    });

    it('disposes the replaced screen when respawning the same sessionId', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const disposeSpy = vi.spyOn(sessions.get('abc')!.screen, 'dispose');
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      expect(disposeSpy).toHaveBeenCalledOnce();
      expect(sessions.get('abc')!.screen).not.toBe(disposeSpy.mock.instances[0]);
    });
  });

  describe('PTY identity guards', () => {
    it('should not emit exit or remove the new session when the stale PTY exits after respawn', () => {
      // Capture exit callbacks indexed by spawn call order
      const exitCallbacks: Array<(ev: { exitCode: number; signal?: number }) => void> = [];
      mockPtyProcess.onExit.mockImplementation((cb: (ev: { exitCode: number; signal?: number }) => void) => {
        exitCallbacks.push(cb);
        onExitCallback = cb;
        return { dispose: vi.fn() };
      });

      // Spawn first PTY for sessionId 'abc'
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const firstExitCb = exitCallbacks[0];
      expect(sessions.get('abc')).toBeDefined();

      // Respawn the same sessionId — replaces the entry
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      const newSession = sessions.get('abc');
      expect(newSession).toBeDefined();

      // Clear sent messages from spawns
      sent.length = 0;

      // Old PTY's onExit fires (SIGTERM grace period expired)
      firstExitCb({ exitCode: 143 });

      // Should NOT send exit, NOT remove the new session
      expect(sent).toHaveLength(0);
      expect(sessions.get('abc')).toBe(newSession);
    });

    it('should kill the existing PTY when respawning the same sessionId', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      // Clear the kill mock to isolate the respawn
      mockPtyProcess.kill.mockClear();

      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });

      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('[FR-TERMINAL-140] security', () => {
    it('should block --dangerously-skip-permissions on host', () => {
      manager.spawn({
        sessionId: 'sec-1',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'claude --dangerously-skip-permissions',
      });

      expect(mockedSpawn).not.toHaveBeenCalled();
      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.t).toBe('exit');
      expect(msg.sessionId).toBe('sec-1');
      expect(msg.exitCode).toBe(1);
    });

    it('should allow --dangerously-skip-permissions in container', () => {
      manager.spawn({
        sessionId: 'sec-2',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'claude --dangerously-skip-permissions',
        containerWorkspaceFolder: '/workspace',
      });

      expect(mockedSpawn).toHaveBeenCalled();
    });

    it('should allow commands without --dangerously-skip-permissions on host', () => {
      manager.spawn({
        sessionId: 'sec-3',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'claude --permission-mode acceptEdits',
      });

      expect(mockedSpawn).toHaveBeenCalled();
    });

    it('[FR-TERMINAL-140] should block codex --dangerously-bypass-approvals-and-sandbox on host', () => {
      manager.spawn({
        sessionId: 'sec-codex',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'codex --dangerously-bypass-approvals-and-sandbox',
      });

      expect(mockedSpawn).not.toHaveBeenCalled();
      const msg = JSON.parse(sent[0]);
      expect(msg).toMatchObject({ t: 'exit', sessionId: 'sec-codex', exitCode: 1 });
    });

    it('should allow codex --dangerously-bypass-approvals-and-sandbox in container', () => {
      manager.spawn({
        sessionId: 'sec-codex-2',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'codex --dangerously-bypass-approvals-and-sandbox',
        containerWorkspaceFolder: '/workspace',
      });

      expect(mockedSpawn).toHaveBeenCalled();
    });

    it('[FR-TERMINAL-140] should block --dangerously-skip-permissions mid-command on host', () => {
      manager.spawn({
        sessionId: 'sec-4',
        workingDir: '/tmp',
        cols: 80,
        rows: 24,
        command: 'claude --model opus --dangerously-skip-permissions --some-flag',
      });

      expect(mockedSpawn).not.toHaveBeenCalled();
      const msg = JSON.parse(sent[0]);
      expect(msg.t).toBe('exit');
      expect(msg.exitCode).toBe(1);
    });
  });

  describe('[FR-TERMINAL-130] activity events', () => {
    let sessions: SessionManager;
    let manager: TerminalManager;
    let sent: string[];
    let onDataCallback: ((data: string) => void) | null;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
      sent = [];
      onDataCallback = null;
      mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
        onDataCallback = cb;
        return { dispose: vi.fn() };
      });
      mockPtyProcess.onExit.mockImplementation(() => ({ dispose: vi.fn() }));
      sessions = new SessionManager();
      manager = new TerminalManager(sessions);
      manager.setSendCallback((msg) => sent.push(msg));
    });

    afterEach(() => vi.useRealTimers());

    function acts() {
      return sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'act');
    }

    it('emits an act:active then act:done as output flows then quiets', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      vi.advanceTimersByTime(3001); // past the initial suppress window
      onDataCallback?.('a');
      onDataCallback?.('b');
      expect(acts().map((m) => m.state)).toEqual(['active']);
      vi.advanceTimersByTime(3000);
      expect(acts().map((m) => m.state)).toEqual(['active', 'done']);
    });

    it('emits act:idle on user input', () => {
      manager.spawn({ sessionId: 'abc', workingDir: '/tmp', cols: 80, rows: 24 });
      vi.advanceTimersByTime(3001);
      onDataCallback?.('a');
      onDataCallback?.('b');
      vi.advanceTimersByTime(3000);
      manager.write('abc', 'x');
      expect(acts().map((m) => m.state)).toEqual(['active', 'done', 'idle']);
    });
  });
});
