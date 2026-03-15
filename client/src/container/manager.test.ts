import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock child_process: execFile must use node's custom promisify symbol
// so we mock the module to provide an execFile that already has a
// promisify-compatible __promisify__ method.
const mockExecFileAsync = vi.fn<(cmd: string, args: string[], opts: { maxBuffer: number }) => Promise<{ stdout: string; stderr: string }>>();

vi.mock('node:child_process', () => {
  const execFileFn = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFileAsync,
    __promisify__: mockExecFileAsync,
  });
  return { execFile: execFileFn, spawn: vi.fn() };
});

// Must import after vi.mock
const { spawn } = await import('node:child_process');
const { ContainerManager } = await import('./manager.js');

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('ContainerManager', () => {
  let manager: InstanceType<typeof ContainerManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ContainerManager();
  });

  describe('up', () => {
    it('should return containerId on success', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('/workspace/project');

      proc.stdout.emit('data', Buffer.from(JSON.stringify({ outcome: 'success', containerId: 'abc123' })));
      proc.emit('close', 0);

      const result = await promise;

      expect(result).toEqual({ containerId: 'abc123' });
      expect(mockSpawn).toHaveBeenCalledWith(
        'devcontainer',
        ['up', '--workspace-folder', '/workspace/project'],
      );
    });

    it('should throw when outcome is not success', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('/workspace/project');

      proc.stdout.emit('data', Buffer.from(JSON.stringify({ outcome: 'error', message: 'build failed' })));
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow('build failed');
    });

    it('should throw with default message when outcome fails without message', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('/workspace/project');

      proc.stdout.emit('data', Buffer.from(JSON.stringify({ outcome: 'error' })));
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow('devcontainer up failed');
    });

    it('should stream stderr lines to onProgress callback', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const progressLines: string[] = [];
      const promise = manager.up('/workspace/project', (line) => {
        progressLines.push(line);
      });

      proc.stderr.emit('data', Buffer.from('Step 1/5: Pulling image...\nStep 2/5: Building...\n'));
      proc.stdout.emit('data', Buffer.from(JSON.stringify({ outcome: 'success', containerId: 'abc123' })));
      proc.emit('close', 0);

      await promise;

      expect(progressLines).toEqual(['Step 1/5: Pulling image...', 'Step 2/5: Building...']);
    });

    it('should reject when spawn emits error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('/workspace/project');
      proc.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('Failed to start devcontainer: ENOENT');
    });

    it('should reject when stdout is not valid JSON', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('/workspace/project');

      proc.stdout.emit('data', Buffer.from('not json'));
      proc.emit('close', 0);

      await expect(promise).rejects.toThrow('Failed to parse devcontainer output');
    });
  });

  describe('exec', () => {
    it('should spawn devcontainer exec with correct args', () => {
      const fakeProcess = { pid: 123 } as ChildProcess;
      mockSpawn.mockReturnValue(fakeProcess);

      const result = manager.exec('/workspace/project', 'bash', ['-c', 'echo hello']);

      expect(result).toBe(fakeProcess);
      expect(mockSpawn).toHaveBeenCalledWith(
        'devcontainer',
        ['exec', '--workspace-folder', '/workspace/project', 'bash', '-c', 'echo hello'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should include --remote-env flags when env is provided', () => {
      const fakeProcess = { pid: 123 } as ChildProcess;
      mockSpawn.mockReturnValue(fakeProcess);

      manager.exec('/workspace/project', 'node', ['index.js'], {
        NODE_ENV: 'production',
        PORT: '3000',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'devcontainer',
        [
          'exec',
          '--workspace-folder',
          '/workspace/project',
          '--remote-env',
          'NODE_ENV=production',
          '--remote-env',
          'PORT=3000',
          'node',
          'index.js',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should handle exec with no args or env', () => {
      const fakeProcess = { pid: 123 } as ChildProcess;
      mockSpawn.mockReturnValue(fakeProcess);

      manager.exec('/workspace/project', 'ls');

      expect(mockSpawn).toHaveBeenCalledWith(
        'devcontainer',
        ['exec', '--workspace-folder', '/workspace/project', 'ls'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });
  });

  describe('down', () => {
    it('should stop the container when running', async () => {
      // First call: status check (devcontainer up --expect-existing-container)
      // Second call: docker stop
      mockExecFileAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ outcome: 'success', containerId: 'abc123' }),
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await manager.down('/workspace/project');

      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
      expect(mockExecFileAsync).toHaveBeenLastCalledWith(
        'docker',
        ['stop', 'abc123'],
        expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
      );
    });

    it('should do nothing when container is not running', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('no container'));

      await manager.down('/workspace/project');

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('status', () => {
    it('should return running=true with containerId when container exists', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ outcome: 'success', containerId: 'abc123' }),
        stderr: '',
      });

      const result = await manager.status('/workspace/project');

      expect(result).toEqual({ running: true, containerId: 'abc123' });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'devcontainer',
        ['up', '--workspace-folder', '/workspace/project', '--expect-existing-container'],
        expect.objectContaining({ maxBuffer: 10 * 1024 * 1024 }),
      );
    });

    it('should return running=false when no container exists', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('no container'));

      const result = await manager.status('/workspace/project');

      expect(result).toEqual({ running: false });
    });

    it('should return running=false when outcome is not success', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({ outcome: 'error' }),
        stderr: '',
      });

      const result = await manager.status('/workspace/project');

      expect(result).toEqual({ running: false });
    });
  });
});
