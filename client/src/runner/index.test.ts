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
    spawn: vi.fn(async (config: { sessionId: string }) => ({
      sessionId: config.sessionId,
      exitCode: 0,
      success: true,
      completion: { taskCompleted: true, summary: 'Task completed successfully' },
      ...spawnResult,
      // Always return the requested sessionId unless overridden.
      ...(spawnResult?.sessionId ? {} : { sessionId: config.sessionId }),
    })),
    getProcess: vi.fn((_sessionId: string) => mockProcess),
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
            "~/'dev/engy'",
            'worktree',
            'add',
            "~/'dev/engy/.claude/worktrees/engy-session-a1b2c3'",
            '-b',
            "'engy/session-a1b2c3'",
            'main',
          ],
          expect.any(Function),
        );
      });

      it('should shell-quote paths containing spaces in coder remote command', async () => {
        mockExecFileSuccess();
        const spawner = createMockSpawner();
        const runner = new Runner(spawner, send);

        await runner.start('session-abc', 'implement feature X', [], {
          repoPath: '/local/path/to/my repo',
          containerMode: true,
          coderWorkspace: 'ZanderAdam/AleksGPT',
          coderRepoBasePath: '~/My Projects',
        });

        // Paths with spaces must be single-quoted for the remote shell.
        // shellQuote preserves leading ~/ outside quotes, so ~/My Projects/repo
        // becomes ~/'My Projects/repo'.
        const call = (mockedExecFile.mock.calls[0] as unknown[]);
        const args = call[1] as string[];
        // -C arg (remoteRepoPath) must be quoted
        const cIdx = args.indexOf('-C');
        expect(cIdx).toBeGreaterThan(-1);
        expect(args[cIdx + 1]).toBe("~/'My Projects/my repo'");
        // worktree add path must also be quoted
        const addIdx = args.indexOf('add');
        expect(addIdx).toBeGreaterThan(-1);
        expect(args[addIdx + 1]).toContain("~/'My Projects/my repo/");
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
          expect.arrayContaining(['-C', "~/'dev/engy'"]),
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
        ).rejects.toThrow(/coder ssh/);
      });
    });
  });

  describe('stop', () => {
    it('should send SIGTERM to the named session process', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => { resolveSpawn = res; });
      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };
      const runner = new Runner(spawner, send);

      // Fire-and-forget start so the entry is created but spawn hasn't completed yet.
      runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));

      runner.stop('session-abc');

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      resolveSpawn({ sessionId: 'session-abc', exitCode: 1, success: false });
    });

    it('should emit EXECUTION_COMPLETE_EVENT with success=false', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => { resolveSpawn = res; });
      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };
      const runner = new Runner(spawner, send);

      runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
      send.mockClear();

      runner.stop('session-abc');

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'session-abc',
          exitCode: 1,
          success: false,
        },
      });
      resolveSpawn({ sessionId: 'session-abc', exitCode: 1, success: false });
    });

    it('should retain the worktree when stopped', async () => {
      const git = createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => { resolveSpawn = res; });
      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };
      const runner = new Runner(spawner, send);

      runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));

      runner.stop('session-abc');

      // Only the initial worktree add, no remove
      expect(git.raw).toHaveBeenCalledTimes(1);
      resolveSpawn({ sessionId: 'session-abc', exitCode: 1, success: false });
    });

    it('should do nothing when no session is found', () => {
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);

      // stop() should not throw
      runner.stop('nonexistent-session');

      expect(send).not.toHaveBeenCalled();
    });

    it('should only kill the named session, not others', async () => {
      createMockGit();

      // Two separate mock processes keyed by sessionId.
      const procA: AgentProcess = { kill: vi.fn() };
      const procB: AgentProcess = { kill: vi.fn() };
      const processes: Record<string, AgentProcess> = {
        'session-a': procA,
        'session-b': procB,
      };

      const spawnPromises: Record<string, { resolve: (r: SpawnResult) => void }> = {};
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn((config: { sessionId: string }) => new Promise<SpawnResult>((res) => {
          spawnPromises[config.sessionId] = { resolve: res };
        })),
        getProcess: vi.fn((id: string) => processes[id] ?? null),
      };

      const runner = new Runner(spawner, send);

      runner.start('session-a', 'task A', [], { repoPath: '/path/to/repo', containerMode: false }).catch(() => {});
      runner.start('session-b', 'task B', [], { repoPath: '/path/to/repo', containerMode: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 10));

      send.mockClear();
      runner.stop('session-a');

      // Only session-a's process killed
      expect(procA.kill).toHaveBeenCalledWith('SIGTERM');
      expect(procB.kill).not.toHaveBeenCalled();

      // Complete event only for session-a
      const completeCalls = (send.mock.calls as unknown[][])
        .map((c) => c[0] as { type: string; payload: { sessionId: string } })
        .filter((m) => m.type === 'EXECUTION_COMPLETE_EVENT');
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0]!.payload.sessionId).toBe('session-a');

      spawnPromises['session-a']?.resolve({ sessionId: 'session-a', exitCode: 1, success: false });
      spawnPromises['session-b']?.resolve({ sessionId: 'session-b', exitCode: 0, success: true });
    });
  });

  describe('stop + process close (duplicate-complete suppression)', () => {
    it('should emit exactly one EXECUTION_COMPLETE_EVENT after stop() followed by process close', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => {
        resolveSpawn = res;
      });

      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };

      const runner = new Runner(spawner, send);

      // Fire-and-forget start (don't await — spawn won't settle until we resolve it)
      runner.start('session-abc', 'task', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});

      // Give start() time to register the session and call spawn
      await new Promise((r) => setTimeout(r, 10));
      send.mockClear();

      // stop() emits the synthetic complete
      runner.stop('session-abc');

      const completeAfterStop = (send.mock.calls as unknown[][])
        .filter((c) => (c[0] as { type: string }).type === 'EXECUTION_COMPLETE_EVENT');
      expect(completeAfterStop).toHaveLength(1);
      expect((completeAfterStop[0]![0] as { payload: { success: boolean } }).payload.success).toBe(false);

      send.mockClear();

      // Now the process "dies" and the spawn promise resolves
      resolveSpawn({ sessionId: 'session-abc', exitCode: 1, success: false });
      await new Promise((r) => setTimeout(r, 10));

      // No second EXECUTION_COMPLETE_EVENT
      const completeAfterExit = (send.mock.calls as unknown[][])
        .filter((c) => (c[0] as { type: string }).type === 'EXECUTION_COMPLETE_EVENT');
      expect(completeAfterExit).toHaveLength(0);
    });

    it('should not send CREATE_MEMORIES_REQUEST after stop()', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => {
        resolveSpawn = res;
      });

      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };

      const runner = new Runner(spawner, send);

      runner.start('session-abc', 'task', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 10));

      runner.stop('session-abc');
      send.mockClear();

      // Process exits with memories attached — must be suppressed
      resolveSpawn({
        sessionId: 'session-abc',
        exitCode: 0,
        success: true,
        completion: {
          taskCompleted: true,
          summary: 'done',
          memories: [{ content: 'some memory' }],
        },
      });
      await new Promise((r) => setTimeout(r, 10));

      const memoriesCalls = (send.mock.calls as unknown[][]).filter(
        (c) => (c[0] as { type: string }).type === 'CREATE_MEMORIES_EVENT',
      );
      expect(memoriesCalls).toHaveLength(0);

      const completeCalls = (send.mock.calls as unknown[][]).filter(
        (c) => (c[0] as { type: string }).type === 'EXECUTION_COMPLETE_EVENT',
      );
      expect(completeCalls).toHaveLength(0);
    });
  });

  describe('retry', () => {
    // Use a deferred spawn for the initial start so the session entry exists
    // (handleCompletion hasn't run yet) when retry is called. This matches
    // production behaviour where a completed session is retried before cleanup.
    function startAndHold(
      runner: Runner,
      sessionId: string,
      spawnResult?: Partial<SpawnResult>,
    ): { resolveFirstSpawn: (r: SpawnResult) => void } {
      let resolveFirstSpawn!: (r: SpawnResult) => void;
      const firstSpawnPromise = new Promise<SpawnResult>((res) => {
        resolveFirstSpawn = res;
      });
      // Rebuild spawner with deferred first spawn; subsequent calls resolve immediately.
      let callCount = 0;
      const spawnerOnRunner = (runner as unknown as { spawner: AgentSpawner }).spawner as {
        spawn: ReturnType<typeof vi.fn>;
        getProcess: ReturnType<typeof vi.fn>;
      };
      const mockProcess: AgentProcess = { kill: vi.fn() };
      spawnerOnRunner.spawn = vi.fn((config: { sessionId: string }) => {
        if (callCount++ === 0) return firstSpawnPromise;
        return Promise.resolve({
          sessionId: config.sessionId,
          exitCode: 0,
          success: true,
          completion: { taskCompleted: true, summary: 'Retry succeeded' },
          ...spawnResult,
          ...(spawnResult?.sessionId ? {} : { sessionId: config.sessionId }),
        });
      });
      spawnerOnRunner.getProcess = vi.fn((_id: string) => mockProcess);
      runner.start(sessionId, 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});
      return { resolveFirstSpawn };
    }

    it('should spawn agent with --resume flag in the same worktree', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);
      const { resolveFirstSpawn } = startAndHold(runner, 'session-abc');
      await new Promise((r) => setTimeout(r, 10));

      const retrySpawn = (runner as unknown as { spawner: { spawn: ReturnType<typeof vi.fn> } }).spawner.spawn;
      retrySpawn.mockClear();
      send.mockClear();

      // Retry runs while the first spawn is still pending — entry exists.
      const retryPromise = runner.retry('session-abc');
      resolveFirstSpawn({ sessionId: 'session-abc', exitCode: 0, success: true });
      await retryPromise;

      expect(retrySpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-abc',
          prompt: '',
          flags: [],
          resumeSessionId: 'session-abc',
          workingDir: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
          containerMode: false,
        }),
      );
    });

    it('should emit EXECUTION_STATUS_EVENT on retry', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);
      const { resolveFirstSpawn } = startAndHold(runner, 'session-abc');
      await new Promise((r) => setTimeout(r, 10));
      send.mockClear();

      const retryPromise = runner.retry('session-abc');
      resolveFirstSpawn({ sessionId: 'session-abc', exitCode: 0, success: true });
      await retryPromise;

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_STATUS_EVENT',
        payload: {
          sessionId: 'session-abc',
          worktreePath: '/path/to/repo/.claude/worktrees/engy-session-a1b2c3',
          status: 'running',
        },
      });
    });

    it('should emit EXECUTION_COMPLETE_EVENT after retry completes', async () => {
      createMockGit();
      const spawner = createMockSpawner();
      const runner = new Runner(spawner, send);
      const { resolveFirstSpawn } = startAndHold(runner, 'session-abc', {
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Retry succeeded' },
      });
      await new Promise((r) => setTimeout(r, 10));
      send.mockClear();

      const retryPromise = runner.retry('session-abc');
      resolveFirstSpawn({ sessionId: 'session-abc', exitCode: 0, success: true });
      await retryPromise;

      expect(send).toHaveBeenCalledWith({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: {
          sessionId: 'session-abc',
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

  describe('session entry cleanup', () => {
    it('should remove the session entry after normal completion so retry() throws', async () => {
      createMockGit();
      const spawner = createMockSpawner({ exitCode: 0, success: true });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'task', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      // After completion, the entry must be gone — retry() should throw, not silently no-op.
      await expect(runner.retry('session-abc')).rejects.toThrow(
        'No worktree found for session session-abc',
      );
    });

    it('should remove the session entry after stop() + process close so retry() throws', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => {
        resolveSpawn = res;
      });

      const mockProcess: AgentProcess = { kill: vi.fn() };
      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        getProcess: vi.fn((_id: string) => mockProcess),
      };

      const runner = new Runner(spawner, send);

      runner.start('session-abc', 'task', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 10));

      runner.stop('session-abc');

      // Simulate process exit after stop
      resolveSpawn({ sessionId: 'session-abc', exitCode: 1, success: false });
      await new Promise((r) => setTimeout(r, 10));

      // Entry must be cleaned up — retry() should throw
      await expect(runner.retry('session-abc')).rejects.toThrow(
        'No worktree found for session session-abc',
      );
    });

    it('should not emit duplicate complete when stop() races with natural exit (proc=null)', async () => {
      createMockGit();

      let resolveSpawn!: (result: SpawnResult) => void;
      const spawnPromise = new Promise<SpawnResult>((res) => {
        resolveSpawn = res;
      });

      const spawner: AgentSpawner & { spawn: ReturnType<typeof vi.fn>; getProcess: ReturnType<typeof vi.fn> } = {
        spawn: vi.fn(() => spawnPromise),
        // getProcess returns null — process already exited before stop() was called
        getProcess: vi.fn((_id: string) => null),
      };

      const runner = new Runner(spawner, send);

      runner.start('session-abc', 'task', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 10));
      send.mockClear();

      // stop() finds entry but no live proc; marks stopped
      runner.stop('session-abc');

      // No complete event emitted when proc is null
      const completeAfterStop = (send.mock.calls as unknown[][]).filter(
        (c) => (c[0] as { type: string }).type === 'EXECUTION_COMPLETE_EVENT',
      );
      expect(completeAfterStop).toHaveLength(0);

      // Process "exits" naturally — handleCompletion sees stopped=true and suppresses
      resolveSpawn({ sessionId: 'session-abc', exitCode: 0, success: true });
      await new Promise((r) => setTimeout(r, 10));

      const completeAfterExit = (send.mock.calls as unknown[][]).filter(
        (c) => (c[0] as { type: string }).type === 'EXECUTION_COMPLETE_EVENT',
      );
      expect(completeAfterExit).toHaveLength(0);
    });
  });

  describe('completion handling', () => {
    it('should handle agent exit without completion data', async () => {
      createMockGit();
      const spawner = createMockSpawner({
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

    it('should send CREATE_MEMORIES_EVENT before EXECUTION_COMPLETE_EVENT when memories present', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        exitCode: 0,
        success: true,
        completion: {
          taskCompleted: true,
          summary: 'Done',
          memories: [
            { content: 'Pattern: always use transactions', type: 'capture' },
            { content: 'Gotcha: migration order matters' },
          ],
        },
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      const calls = send.mock.calls.map((c: unknown[]) => c[0]) as Array<{ type: string }>;
      const memoriesCall = calls.find((m) => m.type === 'CREATE_MEMORIES_EVENT');
      const completeCall = calls.find((m) => m.type === 'EXECUTION_COMPLETE_EVENT');

      expect(memoriesCall).toEqual({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'session-abc',
          memories: [
            { content: 'Pattern: always use transactions', type: 'capture' },
            { content: 'Gotcha: migration order matters' },
          ],
        },
      });

      expect(completeCall).toBeDefined();

      // Memories must be sent before the complete event
      expect(calls.indexOf(memoriesCall!)).toBeLessThan(calls.indexOf(completeCall!));
    });

    it('should not send CREATE_MEMORIES_EVENT when memories are absent', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Done' },
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      const memoriesCall = (send.mock.calls as unknown[][]).find(
        (c) => (c[0] as { type: string }).type === 'CREATE_MEMORIES_EVENT',
      );
      expect(memoriesCall).toBeUndefined();
    });

    it('should not send CREATE_MEMORIES_EVENT when memories array is empty', async () => {
      createMockGit();
      const spawner = createMockSpawner({
        exitCode: 0,
        success: true,
        completion: { taskCompleted: true, summary: 'Done', memories: [] },
      });
      const runner = new Runner(spawner, send);

      await runner.start('session-abc', 'implement feature X', [], {
        repoPath: '/path/to/repo',
        containerMode: false,
      });

      const memoriesCall = (send.mock.calls as unknown[][]).find(
        (c) => (c[0] as { type: string }).type === 'CREATE_MEMORIES_EVENT',
      );
      expect(memoriesCall).toBeUndefined();
    });
  });
});
