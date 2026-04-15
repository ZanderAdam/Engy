import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { SpawnConfig, SpawnResult } from './agent-spawner.js';

const { spawn } = await import('node:child_process');
const { AgentSpawner, TASK_COMPLETION_SCHEMA } = await import('./agent-spawner.js');

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

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

function createMockContainerManager() {
  return { exec: vi.fn() };
}

function createMockCoderManager() {
  return { exec: vi.fn(), up: vi.fn(), down: vi.fn(), status: vi.fn() };
}

const HOST_CONFIG: SpawnConfig = {
  sessionId: 'test-session',
  prompt: 'Do something',
  flags: [],
  containerMode: false,
  workingDir: '/workspace',
};

const CONTAINER_CONFIG: SpawnConfig = {
  sessionId: 'test-session',
  prompt: 'Do something',
  flags: [],
  containerMode: true,
  containerWorkspaceFolder: '/workspace/project',
  workingDir: '/workspace',
};

function expectSpawnResult(result: SpawnResult) {
  expect(result).toHaveProperty('sessionId');
  expect(result).toHaveProperty('exitCode');
  expect(result).toHaveProperty('success');
}

describe('AgentSpawner', () => {
  let spawner: InstanceType<typeof AgentSpawner>;
  let containerManager: ReturnType<typeof createMockContainerManager>;
  let coderManager: ReturnType<typeof createMockCoderManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    containerManager = createMockContainerManager();
    coderManager = createMockCoderManager();
    spawner = new AgentSpawner(containerManager as never, coderManager as never);
  });

  describe('TASK_COMPLETION_SCHEMA', () => {
    it('should define the expected JSON schema', () => {
      expect(TASK_COMPLETION_SCHEMA).toBe(
        JSON.stringify({
          type: 'object',
          properties: {
            taskCompleted: { type: 'boolean' },
            summary: { type: 'string' },
          },
          required: ['taskCompleted', 'summary'],
        }),
      );
    });
  });

  describe('host mode', () => {
    it('should spawn claude with --permission-mode acceptEdits', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn(HOST_CONFIG);

      proc.emit('close', 0);
      const result = await promise;

      expectSpawnResult(result);
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--permission-mode', 'acceptEdits']),
        expect.objectContaining({ cwd: '/workspace' }),
      );
      expect(result.sessionId).toBe('test-session');
    });

    it('should NOT include --dangerously-skip-permissions in host mode', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--dangerously-skip-permissions');
    });

    it('should include --session-id with config sessionId', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const sessionIdIndex = spawnArgs.indexOf('--session-id');
      expect(sessionIdIndex).toBeGreaterThan(-1);
      expect(spawnArgs[sessionIdIndex + 1]).toBe('test-session');
    });

    it('should include --json-schema with TASK_COMPLETION_SCHEMA', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const schemaIndex = spawnArgs.indexOf('--json-schema');
      expect(schemaIndex).toBeGreaterThan(-1);
      expect(spawnArgs[schemaIndex + 1]).toBe(TASK_COMPLETION_SCHEMA);
    });

    it('should include -p and --output-format json', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('-p');
      expect(spawnArgs).toContain('--output-format');
      expect(spawnArgs[spawnArgs.indexOf('--output-format') + 1]).toBe('json');
    });

    it('should NOT add --add-dir for workingDir since it is used as cwd', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace/worktree',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--add-dir');
    });

    it('should pass additional flags', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: ['--append-system-prompt', 'extra context', '--add-dir', '/other'],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--append-system-prompt');
      expect(spawnArgs).toContain('extra context');
      expect(spawnArgs).toContain('--add-dir');
      expect(spawnArgs).toContain('/other');
    });
  });

  describe('container mode', () => {
    it('should spawn via containerManager.exec', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn(CONTAINER_CONFIG);

      proc.emit('close', 0);
      await promise;

      expect(containerManager.exec).toHaveBeenCalledWith(
        '/workspace/project',
        'claude',
        expect.arrayContaining(['--dangerously-skip-permissions']),
        undefined,
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should include --dangerously-skip-permissions in container mode', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: true,
        containerWorkspaceFolder: '/workspace/project',
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const execArgs = containerManager.exec.mock.calls[0][2] as string[];
      expect(execArgs).toContain('--dangerously-skip-permissions');
    });

    it('should NOT include --permission-mode in container mode', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: true,
        containerWorkspaceFolder: '/workspace/project',
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const execArgs = containerManager.exec.mock.calls[0][2] as string[];
      expect(execArgs).not.toContain('--permission-mode');
    });

    it('should pass env to containerManager.exec', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: true,
        containerWorkspaceFolder: '/workspace/project',
        workingDir: '/workspace',
        env: { NODE_ENV: 'test' },
      });

      proc.emit('close', 0);
      await promise;

      expect(containerManager.exec).toHaveBeenCalledWith(
        '/workspace/project',
        'claude',
        expect.any(Array),
        { NODE_ENV: 'test' },
      );
    });

    it('should add --add-dir for workingDir since cwd is containerWorkspaceFolder', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: true,
        containerWorkspaceFolder: '/docs',
        workingDir: '/repos/frontend/.claude/worktrees/session-abc',
      });

      proc.emit('close', 0);
      await promise;

      const execArgs = containerManager.exec.mock.calls[0][2] as string[];
      const addDirIndex = execArgs.indexOf('--add-dir');
      expect(addDirIndex).toBeGreaterThan(-1);
      expect(execArgs[addDirIndex + 1]).toBe('/repos/frontend/.claude/worktrees/session-abc');
    });

    it('should throw when containerWorkspaceFolder is missing in container mode', async () => {
      await expect(
        spawner.spawn({
          sessionId: 'test-session',
          prompt: 'Do something',
          flags: [],
          containerMode: true,
          workingDir: '/workspace',
        }),
      ).rejects.toThrow('containerWorkspaceFolder is required when containerMode is true');
    });
  });

  describe('coder mode', () => {
    it('should spawn via coderManager.exec', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        coderWorkspace: 'my-workspace',
        workingDir: '/home/coder/dev/repo/.claude/worktrees/session-abc',
        serverPort: 3000,
      });

      proc.emit('close', 0);
      await promise;

      expect(coderManager.exec).toHaveBeenCalledWith(
        'my-workspace',
        'claude',
        expect.arrayContaining(['--dangerously-skip-permissions']),
        undefined,
        3000,
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should include --add-dir for workingDir in coder mode', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        coderWorkspace: 'my-workspace',
        workingDir: '/home/coder/dev/repo/.claude/worktrees/session-abc',
      });

      proc.emit('close', 0);
      await promise;

      const execArgs = coderManager.exec.mock.calls[0][2] as string[];
      expect(execArgs).toContain('--add-dir');
      expect(execArgs).toContain('/home/coder/dev/repo/.claude/worktrees/session-abc');
    });

    it('should pass prompt as FIRST positional arg (before flags) and skip stdin', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Use /engy:implement for task-1',
        flags: [],
        containerMode: false,
        coderWorkspace: 'my-workspace',
        workingDir: '/home/coder/dev/repo/.claude/worktrees/session-abc',
      });

      proc.emit('close', 0);
      await promise;

      const execArgs = coderManager.exec.mock.calls[0][2] as string[];
      expect(execArgs[0]).toBe('Use /engy:implement for task-1');
      // Must come before --add-dir so the variadic flag doesn't slurp it.
      expect(execArgs.indexOf('--add-dir')).toBeGreaterThan(0);
      expect(proc.stdin.write).not.toHaveBeenCalled();
    });

    it('should trust agent completion over non-zero coder ssh teardown exit', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do it',
        flags: [],
        containerMode: false,
        coderWorkspace: 'my-workspace',
        workingDir: '/workspace',
      });

      const json = JSON.stringify({
        structured_output: { taskCompleted: true, summary: 'Done' },
      });
      proc.stdout.emit('data', Buffer.from(`${json}\r\n\x1b[?25h`));
      proc.emit('close', 1);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.completion).toEqual({ taskCompleted: true, summary: 'Done' });
    });

    it('should parse JSON output even when PTY escape sequences trail it', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        coderWorkspace: 'my-workspace',
        workingDir: '/workspace',
      });

      const json = JSON.stringify({
        structured_output: { taskCompleted: true, summary: 'All done' },
      });
      proc.stdout.emit('data', Buffer.from(`${json}\r\n\x1b[?1006l\x1b[?25h`));
      proc.emit('close', 0);

      const result = await promise;

      expect(result.completion).toEqual({ taskCompleted: true, summary: 'All done' });
    });

    it('should not require containerWorkspaceFolder when coderWorkspace is set', async () => {
      const proc = createMockProcess();
      coderManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: true,
        coderWorkspace: 'my-workspace',
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      const result = await promise;

      expect(result.exitCode).toBe(0);
    });
  });

  describe('safety validation (FR #14)', () => {
    it('should throw when --dangerously-skip-permissions is used in host mode', async () => {
      await expect(
        spawner.spawn({
          sessionId: 'test-session',
          prompt: 'Do something',
          flags: ['--dangerously-skip-permissions'],
          containerMode: false,
          workingDir: '/workspace',
        }),
      ).rejects.toThrow('--dangerously-skip-permissions can only be used inside a container');
    });

    it('should allow --dangerously-skip-permissions in container mode', async () => {
      const proc = createMockProcess();
      containerManager.exec.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: ['--dangerously-skip-permissions'],
        containerMode: true,
        containerWorkspaceFolder: '/workspace/project',
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      const result = await promise;

      expect(result.exitCode).toBe(0);
    });
  });

  describe('stdin handling', () => {
    it('should write prompt to stdin and close it', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Implement feature X',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      expect(proc.stdin.write).toHaveBeenCalledWith('Implement feature X');
      expect(proc.stdin.end).toHaveBeenCalled();
    });
  });

  describe('json output parsing', () => {
    it('should parse completion from json output', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      const output = JSON.stringify({
        structured_output: { taskCompleted: true, summary: 'Done' },
      });
      proc.stdout.emit('data', Buffer.from(output));
      proc.emit('close', 0);

      const result = await promise;

      expect(result).toEqual({
        sessionId: 'test-session',
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Done' },
      });
    });

    it('should handle result with taskCompleted=false and non-zero exit', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      const output = JSON.stringify({
        structured_output: { taskCompleted: false, summary: 'Failed to complete' },
      });
      proc.stdout.emit('data', Buffer.from(output));
      proc.emit('close', 1);

      const result = await promise;

      expect(result).toEqual({
        sessionId: 'test-session',
        exitCode: 1,
        success: false,
        completion: { taskCompleted: false, summary: 'Failed to complete' },
      });
    });

    it('should mark success=false when exit code is 0 but taskCompleted=false', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      const output = JSON.stringify({
        structured_output: { taskCompleted: false, summary: 'Task not found' },
      });
      proc.stdout.emit('data', Buffer.from(output));
      proc.emit('close', 0);

      const result = await promise;

      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(false);
      expect(result.completion).toEqual({ taskCompleted: false, summary: 'Task not found' });
    });

    it('should resolve without completion when output has no result', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.stdout.emit('data', Buffer.from('not json'));
      proc.emit('close', 0);

      const result = await promise;

      expect(result).toEqual({
        sessionId: 'test-session',
        exitCode: 0,
        success: true,
        completion: undefined,
      });
    });

    it('should handle chunked stdout', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      const output = JSON.stringify({
        structured_output: { taskCompleted: true, summary: 'All done' },
      });
      // Emit in two chunks
      proc.stdout.emit('data', Buffer.from(output.slice(0, 20)));
      proc.stdout.emit('data', Buffer.from(output.slice(20)));
      proc.emit('close', 0);

      const result = await promise;

      expect(result.completion).toEqual({ taskCompleted: true, summary: 'All done' });
    });
  });

  describe('resume mode', () => {
    it('should use --resume instead of --session-id when sessionId is provided', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Continue from where you left off',
        flags: [],
        resumeSessionId: 'existing-session-abc',
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--resume');
      const resumeIndex = spawnArgs.indexOf('--resume');
      expect(spawnArgs[resumeIndex + 1]).toBe('existing-session-abc');
      expect(spawnArgs).not.toContain('--session-id');
    });

    it('should return the config sessionId in the result', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Continue',
        flags: [],
        resumeSessionId: 'existing-session-abc',
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      const result = await promise;

      expect(result.sessionId).toBe('test-session');
    });

    it('should not add --session-id when caller passes --resume via flags', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'new-session',
        prompt: 'Address feedback',
        flags: ['--resume', 'old-session-xyz'],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      await promise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--session-id');
      expect(spawnArgs).toContain('--resume');
      const resumeIndex = spawnArgs.indexOf('--resume');
      expect(spawnArgs[resumeIndex + 1]).toBe('old-session-xyz');
    });
  });

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should send SIGTERM after timeout, then SIGKILL', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something slow',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
        timeoutMs: 5000,
      });

      vi.advanceTimersByTime(5000);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(5000);
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

      proc.emit('close', 137);
      vi.useRealTimers();

      const result = await promise;
      expect(result.exitCode).toBe(137);
      expect(result.success).toBe(false);
    });

    it('should clear timeout when process exits before timeout', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something fast',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
        timeoutMs: 60000,
      });

      proc.emit('close', 0);
      vi.useRealTimers();

      const result = await promise;
      expect(result.exitCode).toBe(0);
      expect(proc.kill).not.toHaveBeenCalled();
    });
  });

  describe('process exit', () => {
    it('should resolve with success=true when exit code is 0', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 0);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('should resolve with success=false when exit code is non-zero', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', 1);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should handle null exit code as exit code 1', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = spawner.spawn({
        sessionId: 'test-session',
        prompt: 'Do something',
        flags: [],
        containerMode: false,
        workingDir: '/workspace',
      });

      proc.emit('close', null);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });
});
