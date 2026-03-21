import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ContainerManager } from '../container/manager.js';

export interface SpawnConfig {
  prompt: string;
  flags: string[];
  sessionId?: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  workingDir: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SpawnResult {
  sessionId: string;
  exitCode: number;
  success: boolean;
  completion?: { taskCompleted: boolean; summary: string };
}

export const TASK_COMPLETION_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    taskCompleted: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['taskCompleted', 'summary'],
});

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const KILL_GRACE_MS = 5000;

export class AgentSpawner {
  private currentProcess: ChildProcess | null = null;

  constructor(private containerManager: ContainerManager) {}

  async spawn(config: SpawnConfig): Promise<SpawnResult> {
    this.validateConfig(config);

    const sessionId = config.sessionId ?? randomUUID();
    const args = this.buildArgs(config, sessionId);
    const proc = this.spawnProcess(config, args);
    this.currentProcess = proc;

    proc.stdin!.write(config.prompt);
    proc.stdin!.end();

    const result = await this.waitForExit(proc, sessionId, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.currentProcess = null;
    return result;
  }

  getProcess(): ChildProcess | null {
    return this.currentProcess;
  }

  private validateConfig(config: SpawnConfig): void {
    if (!config.containerMode && config.flags.includes('--dangerously-skip-permissions')) {
      throw new Error('--dangerously-skip-permissions can only be used inside a container');
    }

    if (config.containerMode && !config.containerWorkspaceFolder) {
      throw new Error('containerWorkspaceFolder is required when containerMode is true');
    }
  }

  private buildArgs(config: SpawnConfig, sessionId: string): string[] {
    const args = ['-p', '--output-format', 'stream-json'];

    if (config.containerMode) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'acceptEdits');
    }

    args.push('--json-schema', TASK_COMPLETION_SCHEMA);

    if (config.sessionId) {
      args.push('--resume', config.sessionId);
    } else {
      args.push('--session-id', sessionId);
    }

    args.push(...config.flags.filter((f) => f !== '--dangerously-skip-permissions'));

    return args;
  }

  private spawnProcess(config: SpawnConfig, args: string[]): ChildProcess {
    if (config.containerMode) {
      return this.containerManager.exec(
        config.containerWorkspaceFolder!,
        'claude',
        args,
        config.env,
      );
    }

    return spawn('claude', args, {
      cwd: config.workingDir,
      env: config.env ? { ...process.env, ...config.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  private waitForExit(proc: ChildProcess, sessionId: string, timeoutMs: number): Promise<SpawnResult> {
    return new Promise((resolve) => {
      let completion: SpawnResult['completion'];
      let buffer = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'result' && msg.result) {
              const parsed = JSON.parse(msg.result);
              if ('taskCompleted' in parsed && 'summary' in parsed) {
                completion = { taskCompleted: parsed.taskCompleted, summary: parsed.summary };
              }
            }
          } catch {
            // Non-JSON lines are ignored
          }
        }
      });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), KILL_GRACE_MS);
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const exitCode = code ?? 1;
        resolve({
          sessionId,
          exitCode,
          success: exitCode === 0,
          completion,
        });
      });
    });
  }
}
