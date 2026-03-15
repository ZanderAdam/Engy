import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export class ContainerManager {
  /**
   * Start a dev container for the given workspace folder.
   * Runs `devcontainer up --workspace-folder {path}` and parses JSON output.
   */
  async up(workspaceFolder: string): Promise<{ containerId: string }> {
    const { stdout } = await execFileAsync(
      'devcontainer',
      ['up', '--workspace-folder', workspaceFolder],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
    let result: { outcome: string; containerId?: string; message?: string };
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new Error(`Failed to parse devcontainer output: ${stdout.slice(0, 200)}`);
    }
    if (result.outcome !== 'success') {
      throw new Error(result.message || 'devcontainer up failed');
    }
    return { containerId: result.containerId! };
  }

  /**
   * Execute a command inside the running container.
   * Returns the spawned child process for streaming.
   */
  exec(
    workspaceFolder: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
  ): ChildProcess {
    const execArgs = ['exec', '--workspace-folder', workspaceFolder];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        execArgs.push('--remote-env', `${key}=${value}`);
      }
    }
    execArgs.push(command, ...args);
    return spawn('devcontainer', execArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  /**
   * Stop a dev container for the given workspace folder.
   * There's no native `devcontainer down`, so we use docker stop on the container.
   */
  async down(workspaceFolder: string): Promise<void> {
    const status = await this.status(workspaceFolder);
    if (!status.running || !status.containerId) return;

    await execFileAsync('docker', ['stop', status.containerId], {
      maxBuffer: EXEC_MAX_BUFFER,
    });
  }

  /**
   * Check if a container is running for the given workspace folder.
   * Uses `devcontainer up --expect-existing-container` to probe without starting.
   */
  async status(workspaceFolder: string): Promise<{ running: boolean; containerId?: string }> {
    try {
      const { stdout } = await execFileAsync(
        'devcontainer',
        ['up', '--workspace-folder', workspaceFolder, '--expect-existing-container'],
        { maxBuffer: EXEC_MAX_BUFFER },
      );
      const result = JSON.parse(stdout);
      if (result.outcome === 'success' && result.containerId) {
        return { running: true, containerId: result.containerId };
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }
}
