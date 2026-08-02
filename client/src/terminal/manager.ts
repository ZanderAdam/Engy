import pty from 'node-pty';
// @xterm/headless ships a UMD bundle whose named exports Node's ESM loader
// cannot detect — Terminal is only reachable via the default (module.exports).
import headless from '@xterm/headless';
import type { ITerminalAddon } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import type { TerminalActivityState } from '@engy/common';
import { SessionManager } from './session-manager.js';
import { createTerminalActivityParser, type TerminalActivityParser } from './activity-parse.js';
import { createActivityTracker } from './activity-tracker.js';
import type { PersistentSession } from './types.js';

const { Terminal: HeadlessTerminal } = headless;

const SIGTERM_TIMEOUT_MS = 3_000;
// Matches the browser xterm's scrollback (terminal.tsx) so a snapshot resync
// restores the same history depth the browser would have accumulated live.
const SCROLLBACK_LINES = 5_000;
// Blocks unsandboxed execution on host for any agent CLI: Claude Code's
// --dangerously-skip-permissions and Codex's --dangerously-bypass-approvals-and-sandbox.
const DANGEROUS_FLAG_RE =
  /(?:^|\s)--dangerously-(?:skip-permissions|bypass-approvals-and-sandbox)(?:\s|$)/;
const ADD_DIR_CLAUDE_MD_ENV = 'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD';

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
      this.disposeSession(sessionId, this.sessions.get(sessionId));
    });
  }

  // Tear down a session's screen mirror and activity tracker. Safe to call
  // multiple times and for unknown ids — covers every removal path (exit,
  // replace, kill, expire) since the onExit respawn guard skips its own
  // cleanup when a session was already removed (kill/expire delete it first).
  private disposeSession(sessionId: string, session: PersistentSession | undefined): void {
    session?.screen.dispose();
    this.activity.get(sessionId)?.tracker.dispose();
    this.activity.delete(sessionId);
  }

  setSendCallback(cb: (msg: string) => void): void {
    this.sendToServer = cb;
  }

  spawn(opts: SpawnOptions): void {
    const { sessionId, workingDir, cols, rows, command, containerWorkspaceFolder } = opts;

    // SECURITY: Never allow permission-bypass flags on host
    const isIsolated = !!containerWorkspaceFolder || !!opts.coderWorkspace;
    if (!isIsolated && command && DANGEROUS_FLAG_RE.test(command)) {
      console.error(
        `[terminal] SECURITY: Blocked permission-bypass flag on host for session ${sessionId}`,
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
      '--remote-env',
      `${ADD_DIR_CLAUDE_MD_ENV}=1`,
      '/bin/bash',
      '-c',
      `cd '${workingDir.replace(/'/g, "'\\''")}' && exec /bin/bash`,
    ]);
  }

  private spawnInCoder(opts: SpawnOptions): void {
    const { workingDir, command, coderWorkspace: workspace = '', serverPort } = opts;
    const sshArgs: string[] = ['ssh', '--no-wait', '-e', `${ADD_DIR_CLAUDE_MD_ENV}=1`];
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
    // The command is baked into the shell invocation above, so mark it as
    // already sent — session.command must survive for reconnect snapshots.
    this.spawnPty(opts, 'coder', sshArgs, undefined, { commandInShell: true });
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
    { commandInShell = false } = {},
  ): void {
    const { sessionId, workingDir, cols, rows, command } = opts;

    let ptyProcess: ReturnType<typeof pty.spawn>;
    try {
      ptyProcess = pty.spawn(cmd, args, {
        name: 'xterm-256color',
        cols,
        rows,
        ...(cwd ? { cwd } : {}),
        env: { ...process.env, [ADD_DIR_CLAUDE_MD_ENV]: '1' },
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
      this.disposeSession(sessionId, existing);
      try {
        existing.ptyProcess.kill('SIGKILL');
      } catch {
        // already dead
      }
    }

    // Headless mirror of the PTY screen. Reconnecting browsers get a serialized
    // snapshot of this terminal's state — replaying raw output chunks would tear
    // TUI repaints, whose cursor-relative frames only render correctly against
    // the screen they were emitted into. convertEol mirrors the browser xterm.
    const screen = new HeadlessTerminal({
      cols,
      rows,
      scrollback: SCROLLBACK_LINES,
      convertEol: true,
      allowProposedApi: true,
    });
    const serializeAddon = new SerializeAddon();
    // The serialize addon is typed against the DOM build's Terminal but runs on
    // the same core as headless — upstream types just don't cover the pairing.
    screen.loadAddon(serializeAddon as unknown as ITerminalAddon);

    const session: PersistentSession = {
      ptyProcess,
      sessionId,
      workingDir,
      command,
      state: 'active',
      screen,
      serializeAddon,
      lastActivity: Date.now(),
      initialCommandSent: commandInShell,
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
      session.screen.write(data);

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
      this.disposeSession(sessionId, session);
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
      session.screen.resize(cols, rows);
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
    this.disposeSession(sessionId, session);
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

    console.log(`[terminal] handleReconnect: session ${sessionId} found, state=${session.state}`);
    session.state = 'active';
    session.suspendedAt = undefined;

    // Serialize only after xterm's write queue has drained, so output that
    // arrived just before the reconnect is part of the snapshot.
    session.screen.write('', () => {
      // The flush is async — the session may have been killed, expired, or
      // replaced meanwhile, and its screen disposed. Same identity guard as
      // the onExit handler; serializing a disposed terminal would throw, and
      // an uncaught throw here takes down every session via shutdown().
      if (this.sessions.get(sessionId) !== session) {
        console.log(`[terminal] handleReconnect: session ${sessionId} gone before flush, skipping snapshot`);
        return;
      }
      // Command sessions: TUIs repaint constantly, so scrollback is stacked
      // frames, not history — screen only.
      const snapshot = session.serializeAddon.serialize(
        session.command ? { scrollback: 0 } : undefined,
      );
      console.log(
        `[terminal] handleReconnect: session ${sessionId} snapshot ${snapshot.length} chars`,
      );
      this.sendToServer?.(JSON.stringify({ t: 'reconnected', sessionId, snapshot }));
    });
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

  // The user viewed/focused the terminal in a browser — clear its activity
  // state so daemon-computed badges stop reporting done/waiting.
  acknowledge(sessionId: string): void {
    this.activity.get(sessionId)?.tracker.acknowledge();
  }

  // Current activity state per live session, sent with the reconnect sync so
  // the server heals states dropped while the relay was down.
  getActivityStates(): { sessionId: string; state: TerminalActivityState }[] {
    return Array.from(this.activity.entries(), ([sessionId, a]) => ({
      sessionId,
      state: a.tracker.getState(),
    }));
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
