import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

function streamLines(chunk: Buffer, cb: (line: string) => void): void {
  for (const line of chunk.toString().split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed) cb(trimmed);
  }
}

// `coder ssh` concatenates arguments and re-parses them through the remote
// shell (not exec), so unquoted JSON, prompts with spaces, or any shell
// metachar gets mangled. Wrap each arg in single quotes, escaping embedded
// single quotes as '\''. Leading '~/' is kept outside the quotes so the
// remote shell still performs tilde expansion (quoting `~/foo` would leave
// it as a literal path).
function shellQuote(arg: string): string {
  if (arg.startsWith('~/')) {
    return `~/${quoteInner(arg.slice(2))}`;
  }
  return quoteInner(arg);
}

function quoteInner(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class CoderManager {
  /**
   * Start a Coder workspace. Runs `coder start <workspace> --yes`.
   * Streams progress lines via optional onProgress callback.
   */
  async up(
    workspace: string,
    onProgress?: (line: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('coder', ['start', workspace, '--yes']);

      let stderr = '';
      let settled = false;

      if (onProgress) {
        proc.stdout.on('data', (chunk: Buffer) => streamLines(chunk, onProgress));
      }

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (onProgress) streamLines(chunk, onProgress);
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to start Coder workspace: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(new Error(`coder start failed (exit ${code}): ${stderr.slice(0, 500)}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Execute a command inside the Coder workspace via `coder ssh`.
   * Sets up reverse port forwarding for MCP connectivity.
   * Returns the spawned child process for streaming.
   */
  exec(
    workspace: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
    serverPort?: number,
  ): ChildProcess {
    const sshArgs: string[] = ['ssh', '--no-wait'];

    if (serverPort) {
      sshArgs.push('-R', `${serverPort}:localhost:${serverPort}`);
    }

    if (env) {
      for (const [key, value] of Object.entries(env)) {
        sshArgs.push('-e', `${key}=${value}`);
      }
    }

    sshArgs.push(workspace, '--', shellQuote(command), ...args.map(shellQuote));
    return spawn('coder', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  /**
   * Run a command on the Coder workspace and capture its stdout/stderr.
   * Unlike `exec()`, no PTY or reverse port forwarding is involved — this is
   * for short-lived operations where the caller wants to await the result.
   */
  async execCapture(
    workspace: string,
    command: string,
    args: string[] = [],
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(
      'coder',
      ['ssh', '--no-wait', workspace, '--', shellQuote(command), ...args.map(shellQuote)],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
  }

  /**
   * Stop a Coder workspace.
   */
  async down(workspace: string): Promise<void> {
    const status = await this.status(workspace);
    if (!status.running) return;

    await execFileAsync('coder', ['stop', workspace], {
      maxBuffer: EXEC_MAX_BUFFER,
    });
  }

  /**
   * Check if a Coder workspace is running.
   * Uses `coder show <workspace> --output json` and parses agent status.
   */
  async status(workspace: string): Promise<{ running: boolean }> {
    try {
      const { stdout } = await execFileAsync(
        'coder',
        ['show', workspace, '--output', 'json'],
        { maxBuffer: EXEC_MAX_BUFFER },
      );
      const data = JSON.parse(stdout);
      const agentStatus = data?.latest_build?.resources
        ?.flatMap((r: { agents?: Array<{ status: string }> }) => r.agents ?? [])
        ?.find((a: { status: string }) => a.status === 'connected');
      return { running: !!agentStatus };
    } catch {
      return { running: false };
    }
  }
}
