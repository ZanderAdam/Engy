import { randomBytes } from 'node:crypto';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type {
  ClientToServerMessage,
  ExecutionStatusEventMessage,
  ExecutionCompleteEventMessage,
} from '@engy/common';
import type { SpawnConfig, SpawnResult } from './agent-spawner.js';

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
  getProcess(): AgentProcess | null;
}

type SendFn = (message: ClientToServerMessage) => void;

// ── Runner ───────────────────────────────────────────────────────────────────

const WORKTREE_DIR = '.claude/worktrees';
const SIGKILL_TIMEOUT_MS = 5_000;

function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

export class Runner {
  private currentSessionId: string | null = null;
  private currentWorktreePath: string | null = null;
  private currentConfig: RunnerConfig | null = null;
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
      // Coder mode: create worktree remotely
      const shortId = generateShortId();
      const branchName = `engy/session-${shortId}`;
      const repoName = basename(config.repoPath);
      const remoteRepoPath = `${config.coderRepoBasePath}/${repoName}`;
      worktreePath = `${remoteRepoPath}/${WORKTREE_DIR}/engy-session-${shortId}`;
      console.log(`[runner] Creating remote worktree via coder ssh: ${worktreePath} branch=${branchName}`);
      await execFileAsync('coder', [
        'ssh', config.coderWorkspace, '--',
        'git', '-C', remoteRepoPath, 'worktree', 'add', worktreePath, '-b', branchName, 'main',
      ]);
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

    this.currentWorktreePath = worktreePath;
    this.currentSessionId = sessionId;
    this.currentConfig = config;

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

  stop(): void {
    const proc = this.spawner.getProcess();
    if (!proc) {
      console.log(`[runner] Stop called but no active process`);
      return;
    }

    console.log(`[runner] Stopping session=${this.currentSessionId}`);
    proc.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      proc.kill('SIGKILL');
    }, SIGKILL_TIMEOUT_MS);
    killTimer.unref();

    this.emitCompleteEvent({
      sessionId: this.currentSessionId!,
      exitCode: 1,
      success: false,
    });
  }

  async retry(sessionId: string): Promise<void> {
    console.log(`[runner] Retrying session=${sessionId} worktree=${this.currentWorktreePath}`);
    if (!this.currentWorktreePath) {
      throw new Error(`No worktree found for session ${sessionId}`);
    }

    const worktreePath = this.currentWorktreePath;

    this.emitStatusEvent(sessionId, worktreePath);

    const spawnResult = await this.spawner.spawn({
      sessionId,
      prompt: '',
      flags: [],
      resumeSessionId: sessionId,
      workingDir: worktreePath,
      containerMode: this.currentConfig?.containerMode ?? false,
      containerWorkspaceFolder: this.currentConfig?.containerWorkspaceFolder,
      coderWorkspace: this.currentConfig?.coderWorkspace,
      coderRepoBasePath: this.currentConfig?.coderRepoBasePath,
      serverPort: this.currentConfig?.serverPort,
      env: this.currentConfig?.env,
    });

    await this.handleCompletion(spawnResult);
  }

  private handleCompletion(result: SpawnResult): void {
    console.log(
      `[runner] Emitting complete: session=${result.sessionId} exit=${result.exitCode} success=${result.success}`,
    );
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
