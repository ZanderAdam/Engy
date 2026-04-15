import { spawn, type ChildProcess } from 'node:child_process';
import type { ContainerManager } from '../container/manager.js';
import type { CoderManager } from '../container/coder-manager.js';

export interface SpawnConfig {
  sessionId: string;
  prompt: string;
  flags: string[];
  resumeSessionId?: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  coderWorkspace?: string;
  coderRepoBasePath?: string;
  remote?: boolean;
  workingDir: string;
  serverPort?: number;
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

// Claude's `--output-format json` emits one JSON object on its own line. In
// coder mode, `coder ssh` allocates a PTY and appends terminal escape
// sequences after the JSON, which breaks a whole-buffer JSON.parse. Find the
// JSON line (starts with `{`, ends with `}`) and parse that.
function extractJsonOutput(stdout: string): { structured_output?: { taskCompleted: boolean; summary: string } } | null {
  try {
    return JSON.parse(stdout);
  } catch {
    const line = stdout.split('\n').find((l) => {
      const t = l.trim();
      return t.startsWith('{') && t.endsWith('}');
    });
    if (!line) {
      console.warn(`[agent-spawner] No JSON line found in stdout`);
      return null;
    }
    try {
      return JSON.parse(line.trim());
    } catch (err) {
      console.warn(`[agent-spawner] Failed to parse JSON line: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

export class AgentSpawner {
  private currentProcess: ChildProcess | null = null;

  constructor(
    private containerManager: ContainerManager,
    private coderManager?: CoderManager,
  ) {}

  async spawn(config: SpawnConfig): Promise<SpawnResult> {
    this.validateConfig(config);

    const { sessionId } = config;
    const args = this.buildArgs(config, sessionId);
    const mode = config.remote ? 'remote' : config.containerMode ? 'container' : 'host';
    console.log(
      `[agent-spawner] Spawning claude (${mode}): cwd=${config.workingDir} sessionId=${sessionId}`,
    );
    console.log(`[agent-spawner] Args: ${args.filter((a) => !a.startsWith('{')).join(' ')}`);

    const proc = this.spawnProcess(config, args);
    this.currentProcess = proc;
    console.log(`[agent-spawner] Process spawned: pid=${proc.pid}`);

    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[agent-spawner] stderr: ${chunk.toString().trim()}`);
    });

    proc.on('error', (err) => {
      console.error(`[agent-spawner] Process error: ${err.message}`);
    });

    if (!config.remote && !config.coderWorkspace) {
      proc.stdin!.write(config.prompt);
      proc.stdin!.end();
      console.log(`[agent-spawner] Prompt written to stdin (${config.prompt.length} chars)`);
    }

    const result = await this.waitForExit(proc, sessionId, config.timeoutMs ?? DEFAULT_TIMEOUT_MS, config.remote);
    this.currentProcess = null;
    console.log(
      `[agent-spawner] Exit: code=${result.exitCode} success=${result.success} completion=${result.completion ? 'yes' : 'no'}`,
    );
    return result;
  }

  getProcess(): ChildProcess | null {
    return this.currentProcess;
  }

  private validateConfig(config: SpawnConfig): void {
    if (config.remote) return; // Remote mode has no local validation constraints

    const isIsolated = config.containerMode || !!config.coderWorkspace;
    if (!isIsolated && config.flags.includes('--dangerously-skip-permissions')) {
      throw new Error('--dangerously-skip-permissions can only be used inside a container');
    }

    if (config.containerMode && !config.containerWorkspaceFolder && !config.coderWorkspace) {
      throw new Error('containerWorkspaceFolder is required when containerMode is true');
    }
  }

  private buildArgs(config: SpawnConfig, sessionId: string): string[] {
    // Remote mode: prompt must be passed as CLI arg (stdin falls back to print mode)
    if (config.remote) {
      return ['--remote', config.prompt];
    }

    const args = ['-p', '--output-format', 'json'];
    const isIsolated = config.containerMode || !!config.coderWorkspace;

    if (isIsolated) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'acceptEdits');
    }

    args.push('--json-schema', TASK_COMPLETION_SCHEMA);

    // --session-id is incompatible with --resume; skip it when either side
    // resumes (config.resumeSessionId or a --resume flag from the caller).
    // claude --resume appends to the same JSONL under the resumed session id.
    const flagsHaveResume = config.flags.includes('--resume');
    if (config.resumeSessionId) {
      args.push('--resume', config.resumeSessionId);
    } else if (!flagsHaveResume) {
      args.push('--session-id', sessionId);
    }

    args.push(...config.flags.filter((f) => f !== '--dangerously-skip-permissions'));

    // In container/coder mode, workingDir isn't used as cwd,
    // so add it as --add-dir so Claude can access the worktree
    if (isIsolated && config.workingDir) {
      args.push('--add-dir', config.workingDir);
    }

    // Coder mode: pass prompt as the FIRST positional arg. `coder ssh`
    // allocates a PTY that echoes piped stdin instead of forwarding it, so
    // stdin is unusable. Placing the prompt before all flags avoids it being
    // slurped by variadic flags like `--add-dir <directories...>`.
    if (config.coderWorkspace && config.prompt) {
      return [config.prompt, ...args];
    }

    return args;
  }

  private spawnProcess(config: SpawnConfig, args: string[]): ChildProcess {
    if (config.coderWorkspace && this.coderManager) {
      return this.coderManager.exec(
        config.coderWorkspace,
        'claude',
        args,
        config.env,
        config.serverPort,
      );
    }

    if (config.containerMode) {
      return this.containerManager.exec(
        config.containerWorkspaceFolder!,
        'claude',
        args,
        config.env,
      );
    }

    if (config.remote) {
      // Remote mode: piped stdout causes the CLI to enter print mode which conflicts
      // with --remote. Use 'inherit' for stdio so the CLI behaves like a terminal.
      // Output is visible in daemon logs; completionSummary is set from exit code.
      return spawn('claude', args, {
        cwd: config.workingDir,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    }

    return spawn('claude', args, {
      cwd: config.workingDir,
      env: config.env ? { ...process.env, ...config.env } : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  private waitForExit(proc: ChildProcess, sessionId: string, timeoutMs: number, remote?: boolean): Promise<SpawnResult> {
    return new Promise((resolve) => {
      let completion: SpawnResult['completion'];
      const chunks: string[] = [];

      proc.stdout?.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString());
      });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), KILL_GRACE_MS);
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const exitCode = code ?? 1;

        if (remote) {
          // Remote mode: stdio is inherited (not piped) so stdout is empty here.
          // The actual CLI output (session URL) is visible in daemon logs.
          const summary = exitCode === 0
            ? 'Remote session submitted — check claude.ai/code for progress'
            : `Remote submission failed (exit code ${exitCode})`;
          completion = { taskCompleted: exitCode === 0, summary };
        } else {
          const stdout = chunks.join('');
          const output = extractJsonOutput(stdout);
          const structured = output?.structured_output;
          if (structured && 'taskCompleted' in structured && 'summary' in structured) {
            completion = { taskCompleted: structured.taskCompleted, summary: structured.summary };
          }
        }

        // When the agent emitted structured completion, trust its taskCompleted
        // over the exit code: `coder ssh` often exits non-zero on teardown
        // (e.g. "Accept SSH listener connection: EOF") even though the remote
        // claude ran to completion successfully.
        const success = completion ? completion.taskCompleted : exitCode === 0;
        resolve({
          sessionId,
          exitCode,
          success,
          completion,
        });
      });
    });
  }
}
