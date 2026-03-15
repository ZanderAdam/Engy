import pty from 'node-pty';
import { CircularBuffer } from './circular-buffer.js';
import { SessionManager } from './session-manager.js';
import type { PersistentSession } from './types.js';

const SIGTERM_TIMEOUT_MS = 3_000;

interface SpawnOptions {
  sessionId: string;
  workingDir: string;
  cols: number;
  rows: number;
  command?: string;
  containerWorkspaceFolder?: string;
}

export class TerminalManager {
  private readonly sessions: SessionManager;
  private sendToServer: ((msg: string) => void) | null = null;

  constructor(sessions: SessionManager = new SessionManager()) {
    this.sessions = sessions;
    this.sessions.setExpireCallback((sessionId) => {
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: -1 }));
    });
  }

  setSendCallback(cb: (msg: string) => void): void {
    this.sendToServer = cb;
  }

  spawn(opts: SpawnOptions): void {
    const { containerWorkspaceFolder } = opts;

    if (containerWorkspaceFolder) {
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

    ptyProcess.onData((data) => {
      session.lastActivity = Date.now();
      outputBuffer.write(data);

      // Send initial command once we get first output (shell is ready)
      if (command && !session.initialCommandSent) {
        session.initialCommandSent = true;
        ptyProcess.write(command + '\r');
      }

      if (session.state === 'active') {
        this.sendToServer?.(JSON.stringify({ t: 'o', sessionId, d: data }));
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const code = exitCode ?? 0;
      console.log(
        `[terminal] Session ${sessionId} exited: code=${code}${signal ? ` signal=${signal}` : ''}`,
      );
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: code }));
      this.sessions.delete(sessionId);
    });
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'expired') return;
    try {
      session.ptyProcess.write(data);
    } catch {
      // pty may have exited
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'expired') return;
    try {
      session.ptyProcess.resize(cols, rows);
    } catch {
      // pty may have exited
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.ptyProcess.kill('SIGTERM');
    } catch {
      // already dead
    }

    const killTimer = setTimeout(() => {
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch {
        // already dead
      }
    }, SIGTERM_TIMEOUT_MS);

    // Clear timer if process exits on its own
    session.ptyProcess.onExit(() => clearTimeout(killTimer));
    this.sessions.delete(sessionId);
  }

  handleReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendToServer?.(JSON.stringify({ t: 'exit', sessionId, exitCode: -1 }));
      return;
    }

    session.state = 'active';
    session.suspendedAt = undefined;

    const lines = session.outputBuffer.toArray();
    this.sendToServer?.(JSON.stringify({ t: 'reconnected', sessionId, buffer: lines }));
  }

  suspend(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    console.log(`[terminal] Session ${sessionId} suspended (WS disconnected)`);
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
