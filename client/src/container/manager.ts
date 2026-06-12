import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export class ContainerManager {
  /**
   * Start a dev container for the given workspace folder.
   * Runs `devcontainer up --workspace-folder {path}` and parses JSON output.
   * Streams build progress lines via optional onProgress callback.
   */
  async up(
    workspaceFolder: string,
    onProgress?: (line: string) => void,
  ): Promise<{ containerId: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('devcontainer', ['up', '--workspace-folder', workspaceFolder]);

      let stdout = '';
      let settled = false;

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        if (!onProgress) return;
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (trimmed) onProgress(trimmed);
        }
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to start devcontainer: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        let result: { outcome: string; containerId?: string; message?: string };
        try {
          result = JSON.parse(stdout);
        } catch {
          reject(new Error(`Failed to parse devcontainer output: ${stdout.slice(0, 200)}`));
          return;
        }
        if (code !== 0 || result.outcome !== 'success') {
          reject(new Error(result.message || 'devcontainer up failed'));
          return;
        }
        resolve({ containerId: result.containerId! });
      });
    });
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
   * Uses a read-only `docker ps` filtered by the devcontainer workspace-folder
   * label so a stopped container is never inadvertently started.
   */
  async status(workspaceFolder: string): Promise<{ running: boolean; containerId?: string }> {
    try {
      const label = `devcontainer.local_folder=${workspaceFolder}`;
      const { stdout } = await execFileAsync(
        'docker',
        ['ps', '-a', '--filter', `label=${label}`, '--format', '{{.ID}}\t{{.Status}}'],
        { maxBuffer: EXEC_MAX_BUFFER },
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return { running: false };
      const running = lines.find((l) => l.split('\t')[1]?.toLowerCase().startsWith('up'));
      if (running) {
        const containerId = running.split('\t')[0];
        return { running: true, containerId };
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }
}
