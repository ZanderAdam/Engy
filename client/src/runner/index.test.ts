import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn(() => Buffer.from('a1b2c3', 'hex')),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { simpleGit } from 'simple-git';
import { Runner } from './index.js';
import type { AgentSpawner, SpawnResult, AgentProcess } from './index.js';

const mockedSimpleGit = vi.mocked(simpleGit);
const mockedExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

// Mock execFile as a success (promisify falls through with empty stdout/stderr).
function mockExecFileSuccess() {
  mockedExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  });
}

// Mock execFile as a failure. The error carries code/stdout/stderr properties
// the same way Node's real execFile does on non-zero exit.
function mockExecFileFailure(stderr: string, code = 128) {
  mockedExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) => {
    const err = Object.assign(new Error('Command failed'), {
      code,
      stdout: '',
      stderr,
    });
    cb(err);
  });
}

function createMockSpawner(
  spawnResult?: Partial<SpawnResult>,
): AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } {
  const mockProcess: AgentProcess = { kill: vi.fn() };
  return {
    spawn: vi.fn(async () => ({
      sessionId: 'session-abc',
      exitCode: 0,
      success: true,
      completion: { taskCompleted: true, summary: 'Task completed successfully' },
      ...spawnResult,
    })),
    getProcess: vi.fn(() => mockProcess),
  };
}

function createMockGit() {
  const git = { raw: vi.fn(async () => '') };
  mockedSimpleGit.mockReturnValue(git as unknown as ReturnType<typeof simpleGit>);
  return git;
}

describe('Runner', () => {
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    send = vi.fn();
  });

  describe('start', () => {
    it('should create a git worktree from main', async () => {
      const git = createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', ['--verbose'], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      expect(mockedSimpleGit).toHaveBeenCalledWith('/path/to/repo');
      expect(git.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
        '-b',
        'engy/session-a1b2c3',
        'main',
      ]);
    });

    it('should emit EXECUTION_STATUS_EVENT with status running and worktreePath', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_STATUS_EVENT',
        payload: {
          sessionId: 'session-abc',
          worktreePath: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
          status: 'running',
        },
      });
    });

    it('should call AgentSpawner.spawn with the worktree as workingDir', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', ['--verbose'], {
        repoPath: '/path/to/repo',
        containerMode: true,
        containerWorkspaceFolder: '/workspace',
        env: { NODE_ENV: 'test' },
      });

      expect(spawner.spawn).toHaveBeenCalledWith({
        sessionId: 'session-abc',
        prompt: 'implement feature X',
        flags: ['--verbose'],
        workingDir: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
        containerMode: true,
        containerWorkspaceFolder: '/workspace',
        env: { NODE_ENV: 'test' },
      });
    });

    it('should emit EXECUTION_COMPLETE_EVENT on agent success', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        sessionId: 'session-abc',
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Done building feature' },
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'session-abc',
          exitCode: 0,
          success: true,
          completionSummary: 'Done building feature',
        },
      });
    });

    it('should retain the worktree after completion (no cleanup)', async () => {
      const git = createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      // Verify worktree add was called but no worktree remove
      expect(git.raw).toHaveBeenCalledTimes(1);
      expect(git.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['worktree', 'add']),
      );
    });

    describe('coder mode', () => {
      it('should normalize trailing slash in coderRepoBasePath when building remote paths', async () => {
        mockExecFileSuccess();
        const spawner = createMockSpawner();
        const runner = new Runner(spawner, send);

        await runner.start('session-abc', 'implement feature X', [], {
          repoPath: '/local/path/to/engy',
          containerMode: true,
          coderWorkspace: 'ZanderAdam/AleksGPT',
          coderRepoBasePath: '~/dev/',
        });

        expect(mockedExecFile).toHaveBeenCalledWith(
          'coder',
          [
            'ssh',
            'ZanderAdam/AleksGPT',
            '--',
            'git',
            '-C',
            '~/dev/engy',
            'worktree',
            'add',
            '~/dev/engy/.claude/worktrees/engy-session-a1b2c3',
            '-b',
            'engy/session-a1b2c3',
            'main',
          ],
          expect.any(Function),
        );
      });

      it('should also handle coderRepoBasePath without trailing slash', async () => {
        mockExecFileSuccess();
        const spawner = createMockSpawner();
        const runner = new Runner(spawner, send);

        await runner.start('session-abc', 'implement feature X', [], {
          repoPath: '/local/path/to/engy',
          containerMode: true,
          coderWorkspace: 'ZanderAdam/AleksGPT',
          coderRepoBasePath: '~/dev',
        });

        expect(mockedExecFile).toHaveBeenCalledWith(
          'coder',
          expect.arrayContaining(['-C', '~/dev/engy']),
          expect.any(Function),
        );
      });

      it('should surface git stderr and exit code in error when coder ssh fails', async () => {
        mockExecFileFailure("fatal: invalid reference: 'main'\n", 128);
        const spawner = createMockSpawner();
        const runner = new Runner(spawner, send);

        const err = await runner
          .start('session-abc', 'implement feature X', [], {
            repoPath: '/local/path/to/engy',
            containerMode: true,
            coderWorkspace: 'ZanderAdam/AleksGPT',
            coderRepoBasePath: '~/dev',
          })
          .catch((e: Error) => e);

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/exit 128/);
        expect((err as Error).message).toMatch(/invalid reference: 'main'/);
      });

      it('should include the coder ssh command in the thrown error', async () => {
        mockExecFileFailure('fatal: not a git repository\n', 128);
        const spawner = createMockSpawner();
        const runner = new Runner(spawner, send);

        await expect(
          runner.start('session-abc', 'implement feature X', [], {
            repoPath: '/local/path/to/engy',
            containerMode: true,
            coderWorkspace: 'ZanderAdam/AleksGPT',
            coderRepoBasePath: '~/dev',
          }),
        ).rejects.toThrow(/coder ssh ZanderAdam\/AleksGPT/);
      });
    });
  });

  describe('stop', () => {
    it('should send SIGTERM to the agent process', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      // Start to initialize internal state
      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      runner.stop();

      const proc = spawner.getProcess();
      expect(proc!.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should emit EXECUTION_COMPLETE_EVENT with success=false', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      send.mockClear();
      runner.stop();

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'session-abc',
          exitCode: 1,
          success: false,
        },
      });
    });

    it('should retain the worktree when stopped', async () => {
      const git = createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      runner.stop();

      // Only the initial worktree add, no remove
      expect(git.raw).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when no process is running', () => {
      const spawner = createMockSpawner();
      spawner.getProcess.mockReturnValue(null);
      const runner = new Runner(spawner, send);

      // stop() should not throw
      runner.stop();

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('should spawn agent with --resume flag in the same worktree', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      // Start first to establish worktree
      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      spawner.spawn.mockClear();
      send.mockClear();

      await runner.retry('abc-123');

      expect(spawner.spawn).toHaveBeenCalledWith({
        sessionId: 'abc-123',
        prompt: '',
        flags: [],
        resumeSessionId: 'abc-123',
        workingDir: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
        containerMode: false,
      });
    });

    it('should emit EXECUTION_STATUS_EVENT on retry', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      send.mockClear();

      await runner.retry('abc-123');

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_STATUS_EVENT',
        payload: {
          sessionId: 'abc-123',
          worktreePath: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
          status: 'running',
        },
      });
    });

    it('should emit EXECUTION_COMPLETE_EVENT after retry completes', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        sessionId: 'retry-session',
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Retry succeeded' },
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      send.mockClear();

      await runner.retry('abc-123');

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'retry-session',
          exitCode: 0,
          success: true,
          completionSummary: 'Retry succeeded',
        },
      });
    });

    it('should throw when no worktree exists for the session', async () => {
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      await expect(runner.retry('nonexistent')).rejects.toThrow(
        'No worktree found for session nonexistent',
      );
    });
  });

  describe('completion handling', () => {
    it('should handle agent exit without completion data', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        sessionId: 'session-abc',
        exitCode: 1,
        success: false,
        completion: undefined,
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'session-abc',
          exitCode: 1,
          success: false,
          completionSummary: undefined,
        },
      });
    });
  });
});
