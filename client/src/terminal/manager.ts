import pty from 'node-pty';
import type { TerminalActivityState } from '@engy/common';
import { CircularBuffer } from './circular-buffer.js';
import { SessionManager } from './session-manager.js';
import { createTerminalActivityParser, type TerminalActivityParser } from './activity-parse.js';
import { createActivityTracker } from './activity-tracker.js';
import type { PersistentSession } from './types.js';

const SIGTERM_TIMEOUT_MS = 3_000;
const DANGEROUS_FLAG_RE = /(?:^|\s)--dangerously-skip-permissions(?:\s|$)/;

// Activity detection timings — mirror the browser tracker (terminal.tsx).
const ACTIVITY_DEBOUNCE_MS = 3_000;
const ACTIVITY_SUPPRESS_MS = 3_000;
const RESIZE_SUPPRESS_MS = 1_000;

interface SessionActivity {
  parser: TerminalActivityParser;
  tracker: ReturnType<typeof createActivityTracker>;
}

interface SpawnOptions {
  sessionId: string;
  workingDir: string;
  cols: number;
  rows: number;
  command?: string;
  containerWorkspaceFolder?: string;
  coderWorkspace?: string;
  serverPort?: number;
}

export class TerminalManager {
  private readonly sessions: SessionManager;
  private readonly activity = new Map<string, SessionActivity>();
  private sendToServer: ((msg: string) => void) | null = null;

  constructor(sessions: SessionManager = new SessionManager()) {
    this.sessions = sessions;
    this.sessions.setExpireCallback((sessionId) => {
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: -1 }));
      this.disposeActivity(sessionId);
    });
  }

  // Tear down a session's activity tracker. Safe to call multiple times and for
  // unknown ids — covers every removal path (exit, replace, kill, expire) since
  // the onExit respawn guard skips its own cleanup when a session was already
  // removed (kill/expire delete it first).
  private disposeActivity(sessionId: string): void {
    this.activity.get(sessionId)?.tracker.dispose();
    this.activity.delete(sessionId);
  }

  setSendCallback(cb: (msg: string) => void): void {
    this.sendToServer = cb;
  }

  spawn(opts: SpawnOptions): void {
    const { sessionId, workingDir, cols, rows, command, containerWorkspaceFolder } = opts;

    // SECURITY: Never allow --dangerously-skip-permissions on host
    const isIsolated = !!containerWorkspaceFolder || !!opts.coderWorkspace;
    if (!isIsolated && command && DANGEROUS_FLAG_RE.test(command)) {
      console.error(
        `[terminal] SECURITY: Blocked --dangerously-skip-permissions on host for session ${sessionId}`,
      );
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: 1 }));
      return;
    }

    console.log(
      `[terminal] Spawning session ${sessionId}: cwd=${workingDir} cols=${cols} rows=${rows} command=${command ?? '(shell)'}`,
    );
    console.log(`[terminal] Active sessions: [${this.sessions.all().map((s) => s.sessionId).join(', ')}]`);

    if (opts.coderWorkspace) {
      this.spawnInCoder(opts);
    } else if (containerWorkspaceFolder) {
      this.spawnInContainer(opts);
    } else {
      this.spawnLocal(opts);
    }
  }

  private spawnInContainer(opts: SpawnOptions): void {
    const { workingDir, containerWorkspaceFolder: folder = '' } = opts;
    this.spawnPty(opts, 'devcontainer', [
      'exec',
      '--workspace-folder',
      folder,
      '/bin/bash',
      '-c',
      `cd '${workingDir.replace(/'/g, "'\\''")}' && exec /bin/bash`,
    ]);
  }

  private spawnInCoder(opts: SpawnOptions): void {
    const { workingDir, command, coderWorkspace: workspace = '', serverPort } = opts;
    const sshArgs: string[] = ['ssh', '--no-wait'];
    if (serverPort) {
      sshArgs.push('-R', `${serverPort}:localhost:${serverPort}`);
    }
    const escapedDir = workingDir.replace(/'/g, "'\\''");
    // Pass the command directly in the shell invocation so it runs after cd,
    // avoiding timing issues with SSH startup output triggering initialCommandSent too early
    const shellCmd = command
      ? `cd '${escapedDir}' && ${command}; exec /bin/bash`
      : `cd '${escapedDir}' && exec /bin/bash`;
    sshArgs.push(workspace, '--', '/bin/bash', '-c', shellCmd);
    // Clear command so spawnPty doesn't try to inject it via initialCommandSent
    this.spawnPty({ ...opts, command: undefined }, 'coder', sshArgs);
  }

  private spawnLocal(opts: SpawnOptions): void {
    const shell = process.env.SHELL ?? '/bin/bash';
    this.spawnPty(opts, shell, [], opts.workingDir);
  }

  private spawnPty(
    opts: SpawnOptions,
    cmd: string,
    args: string[],
    cwd?: string,
  ): void {
    const { sessionId, workingDir, cols, rows, command } = opts;

    let ptyProcess: ReturnType<typeof pty.spawn>;
    try {
      ptyProcess = pty.spawn(cmd, args, {
        name: 'xterm-256color',
        cols,
        rows,
        ...(cwd ? { cwd } : {}),
        env: { ...process.env },
        handleFlowControl: true,
      });
    } catch (err) {
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: 1 }));
      console.error(`[terminal] Failed to spawn PTY for session ${sessionId}:`, err);
      return;
    }

    console.log(`[terminal] PTY spawned for session ${sessionId}, pid=${ptyProcess.pid}`);

    // Kill any existing PTY for this id before overwriting — the old onExit identity
    // guard will see a mismatch and skip its cleanup, so we do it here.
    const existing = this.sessions.get(sessionId);
    if (existing) {
      console.log(`[terminal] Replacing existing PTY for session ${sessionId}, killing old pid=${existing.ptyProcess.pid}`);
      this.disposeActivity(sessionId);
      try {
        existing.ptyProcess.kill('SIGKILL');
      } catch {
        // already dead
      }
    }

    const outputBuffer = new CircularBuffer(1000);
    const session: PersistentSession = {
      ptyProcess,
      sessionId,
      workingDir,
      command,
      state: 'active',
      outputBuffer,
      lastActivity: Date.now(),
      initialCommandSent: false,
    };
    this.sessions.set(sessionId, session);

    // Activity detection (badges): runs regardless of whether a browser is
    // attached, so per-project status is available for unmounted terminals.
    const activityParser = createTerminalActivityParser();
    const activityTracker = createActivityTracker({
      debounceMs: ACTIVITY_DEBOUNCE_MS,
      suppressMs: ACTIVITY_SUPPRESS_MS,
      onActivity: (event) => {
        const state: TerminalActivityState = event === 'start' ? 'active' : event;
        this.sendToServer?.(JSON.stringify({ t: 'act', sessionId, state }));
      },
    });
    this.activity.set(sessionId, { parser: activityParser, tracker: activityTracker });

    ptyProcess.onData((data) => {
      session.lastActivity = Date.now();
      outputBuffer.write(data);

      // Feed activity detection before the attach check — badges must reflect
      // output even while the session is suspended (no browser attached).
      const { hasBell, hasPrompt } = activityParser.parse(data);
      if (hasBell) activityTracker.handleBell();
      else if (data.length > 0) activityTracker.bumpActivity(hasPrompt);

      // Send initial command once we get first output (shell is ready)
      if (command && !session.initialCommandSent) {
        session.initialCommandSent = true;
        console.log(`[terminal] Sending initial command for session ${sessionId}: ${command}`);
        ptyProcess.write(command + '\r');
      }

      if (session.state === 'active') {
        this.sendToServer?.(JSON.stringify({ t: 'o', sessionId, d: data }));
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const code = exitCode ?? 0;
      console.log(
        `[terminal] Session ${sessionId} exited: code=${code} signal=${signal ?? 'null'} state=${session.state} pid=${ptyProcess.pid}`,
      );
      // Only act if this PTY is still the registered instance — a respawn may have replaced it.
      if (this.sessions.get(sessionId) !== session) {
        console.log(`[terminal] Session ${sessionId} exit ignored — PTY was replaced`);
        return;
      }
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: code }));
      this.sessions.delete(sessionId);
      this.disposeActivity(sessionId);
      console.log(`[terminal] Remaining sessions: [${this.sessions.all().map((s) => s.sessionId).join(', ')}]`);
    });
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[terminal] write: session ${sessionId} not found, ignoring`);
      return;
    }
    try {
      session.ptyProcess.write(data);
      this.activity.get(sessionId)?.tracker.resetOnUserInput();
    } catch (err) {
      console.warn(`[terminal] write failed for session ${sessionId}:`, err);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[terminal] resize: session ${sessionId} not found, ignoring`);
      return;
    }
    try {
      session.ptyProcess.resize(cols, rows);
      // The PTY redraws on resize; don't count that burst as activity.
      this.activity.get(sessionId)?.tracker.suppressOutput(RESIZE_SUPPRESS_MS);
    } catch (err) {
      console.warn(`[terminal] resize failed for session ${sessionId}:`, err);
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[terminal] kill: session ${sessionId} not found`);
      return;
    }

    console.log(`[terminal] Killing session ${sessionId}, pid=${session.ptyProcess.pid}`);

    try {
      session.ptyProcess.kill('SIGTERM');
    } catch {
      // already dead
    }

    const killTimer = setTimeout(() => {
      console.log(`[terminal] SIGTERM timeout for session ${sessionId}, sending SIGKILL`);
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch {
        // already dead
      }
    }, SIGTERM_TIMEOUT_MS);

    // Clear timer if process exits on its own
    session.ptyProcess.onExit(() => clearTimeout(killTimer));
    this.sessions.delete(sessionId);
    this.disposeActivity(sessionId);
  }

  handleReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(
        `[terminal] handleReconnect: session ${sessionId} NOT FOUND — sending exit -1. Known sessions: [${this.sessions.all().map((s) => `${s.sessionId}(${s.state})`).join(', ')}]`,
      );
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: -1 }));
      return;
    }

    console.log(
      `[terminal] handleReconnect: session ${sessionId} found, state=${session.state}, bufferSize=${session.outputBuffer.toArray().length}`,
    );
    session.state = 'active';
    session.suspendedAt = undefined;

    const lines = session.outputBuffer.toArray();
    this.sendToServer?.(JSON.stringify({ t: 'reconnected', sessionId, buffer: lines }));
  }

  suspend(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[terminal] suspend: session ${sessionId} not found`);
      return;
    }
    console.log(
      `[terminal] Session ${sessionId} suspended (WS disconnected), state was=${session.state}, pid=${session.ptyProcess.pid}`,
    );
    session.state = 'suspended';
    session.suspendedAt = Date.now();
  }

  getAllSessions(): PersistentSession[] {
    return this.sessions.all();
  }

  killAll(): void {
    for (const session of this.sessions.all()) {
      this.kill(session.sessionId);
    }
  }
}
