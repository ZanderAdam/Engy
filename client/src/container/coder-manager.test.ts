import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

const { spawn, execFile } = await import('node:child_process');
const { CoderManager } = await import('./coder-manager.js');

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function createMockProcess(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  pid: number;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

describe('CoderManager', () => {
  let manager: InstanceType<typeof CoderManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new CoderManager();
  });

  describe('up', () => {
    it('should run coder start with --yes flag', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('my-workspace');
      proc.emit('close', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('coder', ['start', 'my-workspace', '--yes']);
    });

    it('should stream progress from stdout', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      const lines: string[] = [];

      const promise = manager.up('my-workspace', (line) => lines.push(line));
      proc.stdout.emit('data', Buffer.from('Starting workspace...\n'));
      proc.emit('close', 0);
      await promise;

      expect(lines).toContain('Starting workspace...');
    });

    it('should reject on non-zero exit', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('my-workspace');
      proc.stderr.emit('data', Buffer.from('workspace not found'));
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow('coder start failed (exit 1)');
    });

    it('should reject on spawn error', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.up('my-workspace');
      proc.emit('error', new Error('command not found'));

      await expect(promise).rejects.toThrow('Failed to start Coder workspace');
    });
  });

  describe('exec', () => {
    it('should spawn coder ssh with shell-quoted command and args', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'claude', ['-p', '--output-format', 'json']);

      expect(mockSpawn).toHaveBeenCalledWith(
        'coder',
        ['ssh', '--no-wait', 'my-workspace', '--', "'claude'", "'-p'", "'--output-format'", "'json'"],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should shell-quote args containing JSON, spaces, and other shell metachars', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const schema = '{"type":"object","required":["x"]}';
      manager.exec('my-workspace', 'claude', ['--json-schema', schema, 'prompt with spaces']);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain(`'${schema}'`);
      expect(spawnArgs).toContain(`'prompt with spaces'`);
    });

    it("should escape embedded single quotes as '\\''", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'claude', ["it's fine"]);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain(`'it'\\''s fine'`);
    });

    it('should keep leading ~/ outside quotes so the remote shell expands it', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'git', ['-C', '~/dev/engy']);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain(`~/'dev/engy'`);
    });

    it('should include reverse port forwarding when serverPort is set', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'claude', ['-p'], undefined, 3000);

      expect(mockSpawn).toHaveBeenCalledWith(
        'coder',
        ['ssh', '--no-wait', '-R', '3000:localhost:3000', 'my-workspace', '--', "'claude'", "'-p'"],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should include env vars via -e flags', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'claude', [], { NODE_ENV: 'test', FOO: 'bar' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      const eIndex1 = args.indexOf('-e');
      expect(eIndex1).toBeGreaterThan(-1);
      expect(args[eIndex1 + 1]).toBe('NODE_ENV=test');
      const eIndex2 = args.indexOf('-e', eIndex1 + 2);
      expect(eIndex2).toBeGreaterThan(-1);
      expect(args[eIndex2 + 1]).toBe('FOO=bar');
    });

    it('should combine reverse forwarding and env vars', () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      manager.exec('my-workspace', 'bash', [], { KEY: 'val' }, 4000);

      expect(mockSpawn).toHaveBeenCalledWith(
        'coder',
        ['ssh', '--no-wait', '-R', '4000:localhost:4000', '-e', 'KEY=val', 'my-workspace', '--', "'bash'"],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });
  });

  describe('execCapture', () => {
    it('should invoke coder ssh with shell-quoted command and capture output', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
          cb(null, { stdout: 'result', stderr: '' });
          return createMockProcess();
        },
      );

      const result = await manager.execCapture('my-workspace', 'git', ['-C', '/tmp/repo', 'status']);

      expect(result.stdout).toBe('result');
      const callArgs = mockExecFile.mock.calls[0][1] as string[];
      expect(callArgs).toEqual([
        'ssh',
        '--no-wait',
        'my-workspace',
        '--',
        "'git'",
        "'-C'",
        "'/tmp/repo'",
        "'status'",
      ]);
    });
  });

  describe('down', () => {
    it('should run coder stop when workspace is running', async () => {
      // Mock status check — running
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        if (args[0] === 'show') {
          cb(null, {
            stdout: JSON.stringify({
              latest_build: {
                resources: [{ agents: [{ status: 'connected' }] }],
              },
            }),
          });
        } else if (args[0] === 'stop') {
          cb(null, { stdout: '' });
        }
      });

      await manager.down('my-workspace');

      // Verify stop was called (second call)
      const stopCall = mockExecFile.mock.calls.find(
        (c: unknown[]) => (c[1] as string[])[0] === 'stop',
      );
      expect(stopCall).toBeDefined();
      expect(stopCall![1]).toEqual(['stop', 'my-workspace']);
    });

    it('should skip stop when workspace is not running', async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        if (args[0] === 'show') {
          cb(new Error('not found'), { stdout: '' });
        }
      });

      await manager.down('my-workspace');

      const stopCall = mockExecFile.mock.calls.find(
        (c: unknown[]) => (c[1] as string[])[0] === 'stop',
      );
      expect(stopCall).toBeUndefined();
    });
  });

  describe('status', () => {
    it('should return running=true when agent is connected', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        cb(null, {
          stdout: JSON.stringify({
            latest_build: {
              resources: [{ agents: [{ status: 'connected' }] }],
            },
          }),
        });
      });

      const result = await manager.status('my-workspace');
      expect(result).toEqual({ running: true });
    });

    it('should return running=false when no connected agent', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        cb(null, {
          stdout: JSON.stringify({
            latest_build: {
              resources: [{ agents: [{ status: 'disconnected' }] }],
            },
          }),
        });
      });

      const result = await manager.status('my-workspace');
      expect(result).toEqual({ running: false });
    });

    it('should return running=false on error', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        cb(new Error('not found'));
      });

      const result = await manager.status('my-workspace');
      expect(result).toEqual({ running: false });
    });
  });
});
