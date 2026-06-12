import { randomBytes } from 'node:crypto';
import { join, basename, posix as pathPosix } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type {
  ClientToServerMessage,
  ExecutionStatusEventMessage,
  ExecutionCompleteEventMessage,
  CreateMemoriesEventMessage,
} from '@engy/common';
import type { SpawnConfig, SpawnResult } from './agent-spawner.js';
import { shellQuote } from '../container/coder-manager.js';

export type { SpawnConfig, SpawnResult };

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

interface RunnerConfig {
  repoPath: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  coderWorkspace?: string;
  coderRepoBasePath?: string;
  remote?: boolean;
  serverPort?: number;
  env?: Record<string, string>;
  // When set, reuse this worktree instead of creating a new one. Used by
  // --resume so the agent runs from the same cwd as the original session
  // and can locate its conversation JSONL on disk.
  existingWorktreePath?: string;
}

export interface AgentProcess {
  kill: (signal?: NodeJS.Signals) => void;
}

export interface AgentSpawner {
  spawn(config: SpawnConfig): Promise<SpawnResult>;
  getProcess(sessionId: string): AgentProcess | null;
}

type SendFn = (message: ClientToServerMessage) => void;

interface SessionEntry {
  worktreePath: string;
  config: RunnerConfig;
  stopped: boolean;
}

// ── Runner ───────────────────────────────────────────────────────────────────

const WORKTREE_DIR = '.claude/worktrees';
const SIGKILL_TIMEOUT_MS = 5_000;

function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

export class Runner {
  private sessions = new Map<string, SessionEntry>();
  private readonly spawner: AgentSpawner;
  private readonly send: SendFn;

  constructor(spawner: AgentSpawner, send: SendFn) {
    this.spawner = spawner;
    this.send = send;
  }

  async start(
    sessionId: string,
    prompt: string,
    flags: string[],
    config: RunnerConfig,
  ): Promise<void> {
    let worktreePath: string;

    console.log(
      `[runner] Starting session=${sessionId} repo=${config.repoPath} container=${config.containerMode} remote=${config.remote ?? false} coder=${config.coderWorkspace ?? 'none'}`,
    );

    if (config.existingWorktreePath) {
      // Resume mode: reuse the original session's worktree so claude --resume
      // can locate its JSONL under ~/.claude/projects/<encoded-cwd>/.
      worktreePath = config.existingWorktreePath;
      console.log(`[runner] Resuming in existing worktree: ${worktreePath}`);
    } else if (config.remote) {
      // Remote mode: no worktree needed, cloud clones the repo
      worktreePath = config.repoPath;
      console.log(`[runner] Remote mode — skipping worktree creation`);
    } else if (config.coderWorkspace && config.coderRepoBasePath) {
      // Coder mode: create worktree remotely. Use path.posix.join so trailing
      // slashes in coderRepoBasePath (e.g. legacy '~/dev/' from older UI default)
      // don't yield '~/dev//engy'. The remote is always POSIX.
      const shortId = generateShortId();
      const branchName = `engy/session-${shortId}`;
      const repoName = basename(config.repoPath);
      const remoteRepoPath = pathPosix.join(config.coderRepoBasePath, repoName);
      worktreePath = pathPosix.join(remoteRepoPath, WORKTREE_DIR, `engy-session-${shortId}`);
      console.log(
        `[runner] Creating remote worktree via coder ssh: ${worktreePath} branch=${branchName}`,
      );
      const args = [
        'ssh',
        config.coderWorkspace,
        '--',
        'git',
        '-C',
        shellQuote(remoteRepoPath),
        'worktree',
        'add',
        shellQuote(worktreePath),
        '-b',
        shellQuote(branchName),
        'main',
      ];
      try {
        await execFileAsync('coder', args);
      } catch (err) {
        // execFileAsync errors carry stdout/stderr/code as properties, but
        // Error.message strips them. Surface git's real stderr so launch
        // failures are diagnosable instead of hiding behind "exited 128".
        const e = err as { stderr?: string; stdout?: string; code?: number };
        throw new Error(
          `coder ssh worktree creation failed (exit ${e.code ?? 'unknown'})\n` +
            `command: coder ${args.join(' ')}\n` +
            `stderr: ${(e.stderr ?? '').trim() || '(empty)'}\n` +
            `stdout: ${(e.stdout ?? '').trim() || '(empty)'}`,
          { cause: err },
        );
      }
      console.log(`[runner] Worktree created`);
    } else {
      // Local mode: create worktree locally
      const shortId = generateShortId();
      const branchName = `engy/session-${shortId}`;
      worktreePath = join(config.repoPath, WORKTREE_DIR, `engy-session-${shortId}`);
      console.log(`[runner] Creating worktree: ${worktreePath} branch=${branchName}`);
      const git = simpleGit(config.repoPath);
      await git.raw(['worktree', 'add', worktreePath, '-b', branchName, 'main']);
      console.log(`[runner] Worktree created`);
    }

    this.sessions.set(sessionId, { worktreePath, config, stopped: false });

    this.emitStatusEvent(sessionId, worktreePath);
    console.log(`[runner] Spawning agent with ${flags.length} flags, prompt=${prompt.length} chars`);

    this.spawner
      .spawn({
        sessionId,
        prompt,
        flags,
        workingDir: worktreePath,
        containerMode: config.containerMode,
        containerWorkspaceFolder: config.containerWorkspaceFolder,
        coderWorkspace: config.coderWorkspace,
        coderRepoBasePath: config.coderRepoBasePath,
        remote: config.remote,
        serverPort: config.serverPort,
        env: config.env,
      })
      .then((result) => {
        console.log(
          `[runner] Agent completed: session=${sessionId} exit=${result.exitCode} success=${result.success}`,
        );
        this.handleCompletion(result);
      })
      .catch((err) => {
        console.error(`[runner] Agent spawn failed: session=${sessionId} error=${err.message}`);
        this.handleCompletion({
          sessionId,
          exitCode: 1,
          success: false,
        });
      });
  }

  stop(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      console.log(`[runner] Stop called but no session found: sessionId=${sessionId}`);
      return;
    }

    const proc = this.spawner.getProcess(sessionId);
    if (!proc) {
      console.log(`[runner] Stop called but no active process for session=${sessionId}`);
      // The process may have already exited but handleCompletion hasn't run yet.
      // Mark stopped so the natural completion path emits no duplicate event.
      entry.stopped = true;
      return;
    }

    console.log(`[runner] Stopping session=${sessionId}`);

    // Mark stopped before killing so handleCompletion skips the real exit event.
    entry.stopped = true;

    proc.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, SIGKILL_TIMEOUT_MS);
    killTimer.unref();

    this.emitCompleteEvent({
      sessionId,
      exitCode: 1,
      success: false,
    });
  }

  async retry(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    console.log(`[runner] Retrying session=${sessionId} worktree=${entry?.worktreePath ?? null}`);
    if (!entry) {
      throw new Error(`No worktree found for session ${sessionId}`);
    }

    const { worktreePath, config } = entry;
    this.emitStatusEvent(sessionId, worktreePath);

    const spawnResult = await this.spawner.spawn({
      sessionId,
      prompt: '',
      flags: [],
      resumeSessionId: sessionId,
      workingDir: worktreePath,
      containerMode: config.containerMode ?? false,
      containerWorkspaceFolder: config.containerWorkspaceFolder,
      coderWorkspace: config.coderWorkspace,
      coderRepoBasePath: config.coderRepoBasePath,
      serverPort: config.serverPort,
      env: config.env,
    });

    await this.handleCompletion(spawnResult);
  }

  private handleCompletion(result: SpawnResult): void {
    const entry = this.sessions.get(result.sessionId);

    // If stop() already emitted a complete event for this session, ignore the
    // real exit so exactly one EXECUTION_COMPLETE_EVENT is emitted per session.
    if (entry?.stopped) {
      console.log(
        `[runner] Ignoring post-stop completion for session=${result.sessionId}`,
      );
      this.sessions.delete(result.sessionId);
      return;
    }

    console.log(
      `[runner] Emitting complete: session=${result.sessionId} exit=${result.exitCode} success=${result.success}`,
    );

    this.sessions.delete(result.sessionId);

    const memories = result.completion?.memories;
    if (memories && memories.length > 0) {
      console.log(`[runner] Sending ${memories.length} completion memories for session=${result.sessionId}`);
      const memoriesMsg: CreateMemoriesEventMessage = {
        type: 'CREATE_MEMORIES_EVENT',
        payload: { sessionId: result.sessionId, memories },
      };
      this.send(memoriesMsg);
    }

    this.emitCompleteEvent({
      sessionId: result.sessionId,
      exitCode: result.exitCode,
      success: result.success,
      completionSummary: result.completion?.summary,
    });
  }

  private emitStatusEvent(sessionId: string, worktreePath: string): void {
    const msg: ExecutionStatusEventMessage = {
      type: 'EXECUTION_STATUS_EVENT',
      payload: { sessionId, worktreePath, status: 'running' },
    };
    this.send(msg);
  }

  private emitCompleteEvent(payload: ExecutionCompleteEventMessage['payload']): void {
    const msg: ExecutionCompleteEventMessage = {
      type: 'EXECUTION_COMPLETE_EVENT',
      payload,
    };
    this.send(msg);
  }
}
