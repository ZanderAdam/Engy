import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type {
  ClientToServerMessage,
  ExecutionStatusEventMessage,
  ExecutionCompleteEventMessage,
} from '@engy/common';
import type { SpawnConfig, SpawnResult } from './agent-spawner.js';

export type { SpawnConfig, SpawnResult };

// ── Types ────────────────────────────────────────────────────────────────────

interface RunnerConfig {
  repoPath: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  env?: Record<string, string>;
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
    const shortId = generateShortId();
    const branchName = `engy/session-${shortId}`;
    const worktreePath = join(config.repoPath, WORKTREE_DIR, `engy-session-${shortId}`);

    console.log(
      `[runner] Starting session=${sessionId} repo=${config.repoPath} container=${config.containerMode}`,
    );
    console.log(`[runner] Creating worktree: ${worktreePath} branch=${branchName}`);

    const git = simpleGit(config.repoPath);
    await git.raw(['worktree', 'add', worktreePath, '-b', branchName, 'main']);
    console.log(`[runner] Worktree created`);

    this.currentWorktreePath = worktreePath;
    this.currentSessionId = sessionId;
    this.currentConfig = config;

    this.emitStatusEvent(sessionId, worktreePath);
    console.log(`[runner] Spawning agent with ${flags.length} flags, prompt=${prompt.length} chars`);

    this.spawner
      .spawn({
        prompt,
        flags,
        workingDir: worktreePath,
        containerMode: config.containerMode,
        containerWorkspaceFolder: config.containerWorkspaceFolder,
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
      prompt: '',
      flags: [],
      resumeSessionId: sessionId,
      workingDir: worktreePath,
      containerMode: this.currentConfig?.containerMode ?? false,
      containerWorkspaceFolder: this.currentConfig?.containerWorkspaceFolder,
      env: this.currentConfig?.env,
    });

    this.currentSessionId = spawnResult.sessionId;

    await this.handleCompletion(spawnResult);
  }

  private handleCompletion(result: SpawnResult): void {
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
