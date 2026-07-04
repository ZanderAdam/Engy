import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { WebSocket } from 'ws';
import { createAppState, type AppState } from '../trpc/context';
import {
  createWebSocketServer,
  dispatchValidation,
  dispatchFileSearch,
  dispatchGlobFiles,
  dispatchGitWorktreeList,
  dispatchWorktreeAdd,
  dispatchWorktreeRemove,
  dispatchCreateDir,
  dispatchFsDelete,
  dispatchFsRename,
  dispatchGhPrList,
  dispatchGhPrFailedLogs,
  dispatchGhPrReviewComments,
} from './server';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { agentSessions, tasks, taskGroups, projects, workspaces, fleetingMemories } from '../db/schema';

let openClients: WebSocket[] = [];

function startServer(state: AppState): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    const wss = createWebSocketServer(state);
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('WebSocket Server', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  describe('[FR-WS-010] REGISTER', () => {
    it('[FR-WS-010] should set daemon reference on REGISTER', async () => {
      const ws = await connectClient(port);
      expect(state.daemon).toBeNull();

      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );
    });

    it('[FR-WS-020] should replace daemon when a second client registers', async () => {
      const ws1 = await connectClient(port);
      ws1.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const firstDaemon = state.daemon;
      const ws2 = await connectClient(port);
      ws2.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBe(firstDaemon);
      });
    });

    it('[FR-WS-030] should clear daemon reference on close', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      ws.close();

      await vi.waitFor(() => {
        expect(state.daemon).toBeNull();
      });
    });
  });

  describe('[FR-WS-090] FILE_CHANGE', () => {
    it('[FR-WS-090] should store file change events in the ring buffer', async () => {
      const ws = await connectClient(port);

      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'my-ws', path: '/src/index.ts', eventType: 'change' },
        }),
      );

      await vi.waitFor(() => {
        const events = state.fileChanges.get('my-ws');
        expect(events).toHaveLength(1);
        expect(events![0].path).toBe('/src/index.ts');
        expect(events![0].eventType).toBe('change');
        expect(events![0].timestamp).toBeGreaterThan(0);
      });
    });

    it('[FR-WS-090] should cap events at 100 per workspace', async () => {
      const ws = await connectClient(port);

      for (let i = 0; i < 110; i++) {
        ws.send(
          JSON.stringify({
            type: 'FILE_CHANGE',
            payload: { workspaceSlug: 'big-ws', path: `/file-${i}.ts`, eventType: 'add' },
          }),
        );
      }

      await vi.waitFor(() => {
        const events = state.fileChanges.get('big-ws');
        expect(events).toHaveLength(100);
        expect(events![0].path).toBe('/file-10.ts');
        expect(events![99].path).toBe('/file-109.ts');
      });
    });

    it('[FR-WS-090] should keep separate ring buffers per workspace', async () => {
      const ws = await connectClient(port);

      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'ws-a', path: '/a.ts', eventType: 'add' },
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'FILE_CHANGE',
          payload: { workspaceSlug: 'ws-b', path: '/b.ts', eventType: 'change' },
        }),
      );

      await vi.waitFor(() => {
        expect(state.fileChanges.get('ws-a')).toHaveLength(1);
        expect(state.fileChanges.get('ws-b')).toHaveLength(1);
      });
    });
  });

  describe('VALIDATE_PATHS_RESPONSE', () => {
    it('[FR-WS-040] [FR-WS-050] should resolve pending validation on response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const messagePromise = waitForMessage(ws);
      const validationPromise = dispatchValidation(['/src/index.ts'], state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; paths: string[] };
      };
      expect(request.type).toBe('VALIDATE_PATHS_REQUEST');
      expect(request.payload.paths).toEqual(['/src/index.ts']);

      ws.send(
        JSON.stringify({
          type: 'VALIDATE_PATHS_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [{ path: '/src/index.ts', exists: true }],
          },
        }),
      );

      const results = await validationPromise;
      expect(results).toEqual([{ path: '/src/index.ts', exists: true }]);
    });

    it('[FR-WS-060] should reject if no daemon is connected', async () => {
      await expect(dispatchValidation(['/foo.ts'], state)).rejects.toThrow('No daemon connected');
    });

    it('[FR-WS-070] should time out if no response arrives', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const validationPromise = dispatchValidation(['/slow.ts'], state, 50);

      await expect(validationPromise).rejects.toThrow('Validation timed out');
      expect(state.pendingValidations.size).toBe(0);
    });
  });

  describe('SEARCH_FILES_RESPONSE', () => {
    it('[FR-WS-040] [FR-WS-050] should resolve pending file search on response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const messagePromise = waitForMessage(ws);
      const searchPromise = dispatchFileSearch(['/tmp/repo'], 'index', 20, state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; dirs: string[]; query: string; limit: number };
      };
      expect(request.type).toBe('SEARCH_FILES_REQUEST');
      expect(request.payload.dirs).toEqual(['/tmp/repo']);
      expect(request.payload.query).toBe('index');
      expect(request.payload.limit).toBe(20);

      ws.send(
        JSON.stringify({
          type: 'SEARCH_FILES_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [{ label: 'repo', path: 'src/index.ts' }],
          },
        }),
      );

      const results = await searchPromise;
      expect(results).toEqual([{ label: 'repo', path: 'src/index.ts' }]);
    });

    it('[FR-WS-060] should reject if no daemon is connected', async () => {
      await expect(dispatchFileSearch(['/tmp'], '', 20, state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('[FR-WS-070] should time out if no response arrives', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const searchPromise = dispatchFileSearch(['/tmp'], '', 20, state, 50);

      await expect(searchPromise).rejects.toThrow('File search timed out');
      expect(state.pendingFileSearches.size).toBe(0);
    });
  });

  describe('GLOB_FILES_RESPONSE', () => {
    it('[FR-WS-040] [FR-WS-050] should resolve with files on success response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const messagePromise = waitForMessage(ws);
      const globPromise = dispatchGlobFiles('/tmp/repo', ['*.test.ts', '*.test.tsx'], state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; repoDir: string; patterns: string[] };
      };
      expect(request.type).toBe('GLOB_FILES_REQUEST');
      expect(request.payload.repoDir).toBe('/tmp/repo');
      expect(request.payload.patterns).toEqual(['*.test.ts', '*.test.tsx']);

      ws.send(
        JSON.stringify({
          type: 'GLOB_FILES_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            files: ['src/foo.test.ts', 'src/bar.test.tsx'],
          },
        }),
      );

      const result = await globPromise;
      expect(result).toEqual({ files: ['src/foo.test.ts', 'src/bar.test.tsx'] });
    });

    it('[FR-WS-050] should reject on error payload', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const messagePromise = waitForMessage(ws);
      const globPromise = dispatchGlobFiles('/tmp/repo', ['*.test.ts'], state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string };
      };

      ws.send(
        JSON.stringify({
          type: 'GLOB_FILES_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            error: 'git command failed',
          },
        }),
      );

      await expect(globPromise).rejects.toThrow('git command failed');
      expect(state.pendingGlobFiles.size).toBe(0);
    });

    it('[FR-WS-060] should reject if no daemon is connected', async () => {
      await expect(dispatchGlobFiles('/tmp/repo', ['*.test.ts'], state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('[FR-WS-030] should reject all pending glob ops when daemon disconnects', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      // Start a glob op but don't respond — then close the daemon
      const globPromise = dispatchGlobFiles('/tmp/repo', ['*.test.ts'], state);

      ws.close();

      await expect(globPromise).rejects.toThrow('Daemon disconnected');
      expect(state.pendingGlobFiles.size).toBe(0);
    });
  });

  describe('GIT_WORKTREE_LIST_RESPONSE', () => {
    it('[FR-WS-040] [FR-WS-050] should resolve pending worktree list on response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const messagePromise = waitForMessage(ws);
      const worktreePromise = dispatchGitWorktreeList('/tmp/repo', state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; repoDir: string };
      };
      expect(request.type).toBe('GIT_WORKTREE_LIST_REQUEST');
      expect(request.payload.repoDir).toBe('/tmp/repo');

      ws.send(
        JSON.stringify({
          type: 'GIT_WORKTREE_LIST_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            worktrees: [
              { path: '/tmp/repo', branch: 'main', isMain: true, isLocked: false },
              { path: '/tmp/repo-wt', branch: 'feature', isMain: false, isLocked: false },
            ],
          },
        }),
      );

      const result = await worktreePromise;
      expect(result.worktrees).toHaveLength(2);
      expect(result.worktrees[0]).toEqual({
        path: '/tmp/repo',
        branch: 'main',
        isMain: true,
        isLocked: false,
      });
    });

    it('[FR-WS-060] should reject if no daemon is connected', async () => {
      await expect(dispatchGitWorktreeList('/tmp/repo', state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('[FR-WS-050] should reject on error response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const messagePromise = waitForMessage(ws);
      const worktreePromise = dispatchGitWorktreeList('/bad/path', state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string };
      };

      ws.send(
        JSON.stringify({
          type: 'GIT_WORKTREE_LIST_RESPONSE',
          payload: { requestId: request.payload.requestId, error: 'not a git repo' },
        }),
      );

      await expect(worktreePromise).rejects.toThrow('not a git repo');
    });

    it('should forward coderWorkspace in the request payload', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(() => {
        expect(state.daemon).not.toBeNull();
      });

      const messagePromise = waitForMessage(ws);
      dispatchGitWorktreeList('/remote/repo', state, 'my-coder-ws').catch(() => {});

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; repoDir: string; coderWorkspace?: string };
      };
      expect(request.payload.coderWorkspace).toBe('my-coder-ws');
    });
  });

  describe('WORKTREE_ADD_RESULT', () => {
    it('resolves with worktreePath and branch on success', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(state.daemon).not.toBeNull());

      const messagePromise = waitForMessage(ws);
      const promise = dispatchWorktreeAdd(state, {
        repoDir: '/repo',
        worktreePath: '/wt/feat',
        branch: 'feat',
        createBranch: true,
      });

      const request = (await messagePromise) as { type: string; payload: { requestId: string } };
      expect(request.type).toBe('WORKTREE_ADD_REQUEST');

      ws.send(
        JSON.stringify({
          type: 'WORKTREE_ADD_RESULT',
          payload: {
            requestId: request.payload.requestId,
            success: true,
            worktreePath: '/wt/feat',
            branch: 'feat',
          },
        }),
      );

      await expect(promise).resolves.toEqual({ worktreePath: '/wt/feat', branch: 'feat' });
    });

    it('rejects with code attached on error', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(state.daemon).not.toBeNull());

      const messagePromise = waitForMessage(ws);
      const promise = dispatchWorktreeAdd(state, {
        repoDir: '/repo',
        worktreePath: '/wt/feat',
        branch: 'feat',
        createBranch: true,
      });
      const request = (await messagePromise) as { type: string; payload: { requestId: string } };

      ws.send(
        JSON.stringify({
          type: 'WORKTREE_ADD_RESULT',
          payload: {
            requestId: request.payload.requestId,
            error: 'branch exists',
            code: 'BRANCH_EXISTS',
          },
        }),
      );

      await expect(promise).rejects.toMatchObject({
        message: 'branch exists',
        code: 'BRANCH_EXISTS',
      });
    });
  });

  describe('WORKTREE_REMOVE_RESULT', () => {
    it('resolves on success', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(state.daemon).not.toBeNull());

      const messagePromise = waitForMessage(ws);
      const promise = dispatchWorktreeRemove(state, {
        repoDir: '/repo',
        worktreePath: '/wt/feat',
        force: false,
      });
      const request = (await messagePromise) as { type: string; payload: { requestId: string } };
      expect(request.type).toBe('WORKTREE_REMOVE_REQUEST');

      ws.send(
        JSON.stringify({
          type: 'WORKTREE_REMOVE_RESULT',
          payload: { requestId: request.payload.requestId, success: true },
        }),
      );

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects with DIRTY code on dirty worktree', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(state.daemon).not.toBeNull());

      const messagePromise = waitForMessage(ws);
      const promise = dispatchWorktreeRemove(state, {
        repoDir: '/repo',
        worktreePath: '/wt/feat',
        force: false,
      });
      const request = (await messagePromise) as { type: string; payload: { requestId: string } };

      ws.send(
        JSON.stringify({
          type: 'WORKTREE_REMOVE_RESULT',
          payload: {
            requestId: request.payload.requestId,
            error: 'is dirty',
            code: 'DIRTY',
          },
        }),
      );

      await expect(promise).rejects.toMatchObject({ message: 'is dirty', code: 'DIRTY' });
    });
  });

  describe('CREATE_DIR_RESPONSE', () => {
    it('[FR-WS-040] [FR-WS-050] should resolve with results on success response', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const messagePromise = waitForMessage(ws);
      const createDirPromise = dispatchCreateDir(['/tmp/newdir', '/tmp/anotherdir'], state);

      const request = (await messagePromise) as {
        type: string;
        payload: { requestId: string; paths: string[] };
      };
      expect(request.type).toBe('CREATE_DIR_REQUEST');
      expect(request.payload.paths).toEqual(['/tmp/newdir', '/tmp/anotherdir']);

      ws.send(
        JSON.stringify({
          type: 'CREATE_DIR_RESPONSE',
          payload: {
            requestId: request.payload.requestId,
            results: [
              { path: '/tmp/newdir', success: true },
              { path: '/tmp/anotherdir', success: true },
            ],
          },
        }),
      );

      const result = await createDirPromise;
      expect(result).toEqual({
        results: [
          { path: '/tmp/newdir', success: true },
          { path: '/tmp/anotherdir', success: true },
        ],
      });
    });

    it('[FR-WS-060] should reject if no daemon is connected', async () => {
      await expect(dispatchCreateDir(['/tmp/newdir'], state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('[FR-WS-070] should time out if no response arrives', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      const createDirPromise = dispatchCreateDir(['/tmp/slow'], state, 50);

      await expect(createDirPromise).rejects.toThrow('timed out');
      expect(state.pendingCreateDirs.size).toBe(0);
    });

    it('[FR-WS-030] should reject pending dirs when daemon disconnects and clear daemonHomeDir', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: { homeDir: '/home/testuser' } }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      expect(state.daemonHomeDir).toBe('/home/testuser');

      const createDirPromise = dispatchCreateDir(['/tmp/pending'], state);

      ws.close();

      await expect(createDirPromise).rejects.toThrow('Daemon disconnected');
      expect(state.pendingCreateDirs.size).toBe(0);

      await vi.waitFor(() => {
        expect(state.daemonHomeDir).toBeNull();
      });
    });
  });

  describe('[FR-WS-010] REGISTER homeDir', () => {
    it('[FR-WS-010] should store homeDir from REGISTER payload', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: { homeDir: '/home/alice' } }));

      await vi.waitFor(
        () => {
          expect(state.daemonHomeDir).toBe('/home/alice');
        },
        { timeout: 5000 },
      );
    });

    it('[FR-WS-010] should set daemonHomeDir to null when homeDir is absent from payload', async () => {
      state.daemonHomeDir = '/old/home';
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));

      await vi.waitFor(
        () => {
          expect(state.daemon).not.toBeNull();
        },
        { timeout: 5000 },
      );

      expect(state.daemonHomeDir).toBeNull();
    });

    it('[FR-WS-030] should clear daemonHomeDir when daemon disconnects', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: { homeDir: '/home/bob' } }));

      await vi.waitFor(() => {
        expect(state.daemonHomeDir).toBe('/home/bob');
      });

      ws.close();

      await vi.waitFor(() => {
        expect(state.daemonHomeDir).toBeNull();
      });
    });
  });

  describe('malformed messages', () => {
    it('should ignore invalid JSON', async () => {
      const ws = await connectClient(port);
      ws.send('not json at all');

      await new Promise((r) => setTimeout(r, 50));
      expect(state.daemon).toBeNull();
    });
  });
});

describe('Execution event handling', () => {
  let ctx: TestContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    ctx = setupTestDb();

    // Insert workspace + project so we can create tasks
    const ws = ctx.db.insert(workspaces).values({ name: 'Test', slug: 'test' }).returning().get();
    ctx.db
      .insert(projects)
      .values({ workspaceId: ws.id, name: 'Test Project', slug: 'test-project' })
      .run();

    const result = await startServer(ctx.state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
    ctx.cleanup();
  });

  describe('EXECUTION_STATUS_EVENT', () => {
    it('should update agentSession and task subStatus when taskId is provided', async () => {
      // Seed a task and agent session
      const task = ctx.db
        .insert(tasks)
        .values({ title: 'Test task', status: 'in_progress' })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'abc-123', taskId: task.id, status: 'active' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_STATUS_EVENT',
          payload: { sessionId: 'abc-123', status: 'implementing', taskId: task.id },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'abc-123'))
          .get();
        expect(session!.status).toBe('active');

        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.subStatus).toBe('implementing');
      });
    });

    it('should update agentSession without taskId', async () => {
      ctx.db.insert(agentSessions).values({ sessionId: 'no-task-session', status: 'active' }).run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_STATUS_EVENT',
          payload: { sessionId: 'no-task-session', status: 'planning' },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'no-task-session'))
          .get();
        expect(session).toBeDefined();
      });
    });

    it('should log warning for non-existent sessionId and not crash', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_STATUS_EVENT',
          payload: { sessionId: 'nonexistent', status: 'implementing' },
        }),
      );

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
      });

      warnSpy.mockRestore();
    });
  });

  describe('EXECUTION_COMPLETE_EVENT', () => {
    it('[FR-EXECUTION-160] should set session to completed and clear task subStatus on success', async () => {
      const task = ctx.db
        .insert(tasks)
        .values({ title: 'Auth task', status: 'in_progress', subStatus: 'implementing' })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'complete-ok', taskId: task.id, status: 'active' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: {
            sessionId: 'complete-ok',
            exitCode: 0,
            success: true,
            completionSummary: 'Implemented auth',
          },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'complete-ok'))
          .get();
        expect(session!.status).toBe('completed');
        expect(session!.completionSummary).toBe('Implemented auth');

        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.subStatus).toBeNull();
      });
    });

    it('should set session to stopped and task subStatus to failed on failure', async () => {
      const task = ctx.db
        .insert(tasks)
        .values({ title: 'Failing task', status: 'in_progress', subStatus: 'implementing' })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'complete-fail', taskId: task.id, status: 'active' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: { sessionId: 'complete-fail', exitCode: 1, success: false },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'complete-fail'))
          .get();
        expect(session!.status).toBe('stopped');

        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.subStatus).toBe('failed');
      });
    });

    it('should handle completion without linked task', async () => {
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'no-task-complete', status: 'active' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: { sessionId: 'no-task-complete', exitCode: 0, success: true },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'no-task-complete'))
          .get();
        expect(session!.status).toBe('completed');
      });
    });

    it('should log warning for non-existent sessionId and not crash', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: { sessionId: 'ghost', exitCode: 1, success: false },
        }),
      );

      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost'));
      });

      warnSpy.mockRestore();
    });

    it('[FR-EXECUTION-170] should set subStatus to plan_review on planning mode success', async () => {
      const ws0 = ctx.db
        .insert(workspaces)
        .values({ name: 'PlanWs', slug: 'plan-ws' })
        .returning()
        .get();
      const proj = ctx.db
        .insert(projects)
        .values({ workspaceId: ws0.id, name: 'Plan Project', slug: 'plan-proj' })
        .returning()
        .get();
      const task = ctx.db
        .insert(tasks)
        .values({
          title: 'Planning task',
          projectId: proj.id,
          status: 'in_progress',
          subStatus: 'planning',
        })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'plan-complete',
          taskId: task.id,
          status: 'active',
          executionMode: 'planning',
        })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: {
            sessionId: 'plan-complete',
            exitCode: 0,
            success: true,
            completionSummary: 'Plan generated',
          },
        }),
      );

      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'plan-complete'))
          .get();
        expect(session!.status).toBe('completed');
        expect(session!.completionSummary).toBe('Plan generated');

        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.status).toBe('in_progress');
        expect(updatedTask!.subStatus).toBe('plan_review');
      });
    });

    it('[FR-EXECUTION-170] should dispatch REMOTE_FILE_PULL for coder workspace on planning success', async () => {
      const ws0 = ctx.db
        .insert(workspaces)
        .values({
          name: 'CoderWs',
          slug: 'coder-ws',
          executionBackend: 'coder',
          coderConfig: { workspace: 'my-coder-ws', repoBasePath: '/home/coder' },
        })
        .returning()
        .get();
      const proj = ctx.db
        .insert(projects)
        .values({
          workspaceId: ws0.id,
          name: 'Coder Project',
          slug: 'coder-proj',
          projectDir: '/tmp/coder-proj',
        })
        .returning()
        .get();
      const task = ctx.db
        .insert(tasks)
        .values({
          title: 'Coder planning task',
          projectId: proj.id,
          status: 'in_progress',
          subStatus: 'planning',
        })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'coder-plan',
          taskId: task.id,
          status: 'active',
          executionMode: 'planning',
        })
        .run();

      // Collect all messages sent to daemon
      const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const ws = await connectClient(port);
      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()));
      });

      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: {
            sessionId: 'coder-plan',
            exitCode: 0,
            success: true,
          },
        }),
      );

      await vi.waitFor(() => {
        const pullMsg = received.find((m) => m.type === 'REMOTE_FILE_PULL_REQUEST');
        expect(pullMsg).toBeDefined();
        expect(pullMsg!.payload.coderWorkspace).toBe('my-coder-ws');
        expect(pullMsg!.payload.filePath).toBe(`plans/coder-ws-T${task.id}.plan.md`);
      });
    });

    it('[FR-EXECUTION-160] should dispatch WORKTREE_MERGE_REQUEST on implementation success with merge setting', async () => {
      const ws0 = ctx.db
        .insert(workspaces)
        .values({
          name: 'MergeWs',
          slug: 'merge-ws',
          autoAgentCompletion: 'merge',
          repos: ['/tmp/main-repo'],
        })
        .returning()
        .get();
      const proj = ctx.db
        .insert(projects)
        .values({ workspaceId: ws0.id, name: 'Merge Project', slug: 'merge-proj' })
        .returning()
        .get();
      const task = ctx.db
        .insert(tasks)
        .values({
          title: 'Merge task',
          projectId: proj.id,
          status: 'in_progress',
          subStatus: 'implementing',
        })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'merge-complete',
          taskId: task.id,
          status: 'active',
          executionMode: 'task',
          worktreePath: '/tmp/worktree-branch',
        })
        .run();

      // Collect all messages sent to daemon
      const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const ws = await connectClient(port);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };
        received.push(msg);
        // Resolve the merge request so the pending promise completes cleanly
        // (avoids leaking a rejected pending into the next test via rejectAllPending)
        if (msg.type === 'WORKTREE_MERGE_REQUEST') {
          const requestId = msg.payload.requestId as string;
          const pending = ctx.state.pendingWorktreeMerge.get(requestId);
          if (pending) {
            ctx.state.pendingWorktreeMerge.delete(requestId);
            pending.resolve({ success: true, branch: 'feature' });
          }
        }
      });

      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: {
            sessionId: 'merge-complete',
            exitCode: 0,
            success: true,
          },
        }),
      );

      await vi.waitFor(() => {
        const mergeMsg = received.find((m) => m.type === 'WORKTREE_MERGE_REQUEST');
        expect(mergeMsg).toBeDefined();
        expect(mergeMsg!.payload.worktreePath).toBe('/tmp/worktree-branch');
        expect(mergeMsg!.payload.repoDir).toBe('/tmp/main-repo');
      });
    });

    it('[FR-EXECUTION-190] should ignore duplicate complete events for already-terminal sessions', async () => {
      const task = ctx.db
        .insert(tasks)
        .values({ title: 'Dup complete task', status: 'done', subStatus: null })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'dup-complete', taskId: task.id, status: 'completed' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: { sessionId: 'dup-complete', exitCode: 0, success: false },
        }),
      );

      // The session is already terminal so the handler returns early.
      // Poll until the session row is unchanged to confirm the guard fired.
      await vi.waitFor(() => {
        const session = ctx.db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, 'dup-complete'))
          .get();
        expect(session!.status).toBe('completed');
      });

      // Task must remain done (not be changed to failed by duplicate event)
      const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(updatedTask!.status).toBe('done');
      expect(updatedTask!.subStatus).toBeNull();
    });

    it('should not update subStatus for out-of-enum status values like running', async () => {
      const task = ctx.db
        .insert(tasks)
        .values({ title: 'Running status task', status: 'in_progress', subStatus: 'implementing' })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'running-status', taskId: task.id, status: 'active' })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_STATUS_EVENT',
          payload: { sessionId: 'running-status', status: 'running', taskId: task.id },
        }),
      );

      // Wait briefly then verify subStatus was NOT overwritten
      await new Promise((r) => setTimeout(r, 50));

      const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(updatedTask!.subStatus).toBe('implementing');
    });

    it('should set task subStatus to failed and broadcast when merge dispatch fails', async () => {
      const ws0 = ctx.db
        .insert(workspaces)
        .values({
          name: 'MergeFailWs',
          slug: 'merge-fail-ws',
          autoAgentCompletion: 'merge',
          repos: ['/tmp/main-repo'],
        })
        .returning()
        .get();
      const proj = ctx.db
        .insert(projects)
        .values({ workspaceId: ws0.id, name: 'Merge Fail Project', slug: 'merge-fail-proj' })
        .returning()
        .get();
      const task = ctx.db
        .insert(tasks)
        .values({
          title: 'Merge fail task',
          projectId: proj.id,
          status: 'in_progress',
          subStatus: 'implementing',
        })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'merge-fail-complete',
          taskId: task.id,
          status: 'active',
          executionMode: 'task',
          worktreePath: '/tmp/worktree-branch',
        })
        .run();

      const ws = await connectClient(port);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; payload: { requestId: string } };
        if (msg.type === 'WORKTREE_MERGE_REQUEST') {
          // Reject the pending merge request to simulate a failed merge
          const pending = ctx.state.pendingWorktreeMerge.get(msg.payload.requestId);
          if (pending) {
            ctx.state.pendingWorktreeMerge.delete(msg.payload.requestId);
            pending.reject(new Error('merge conflict'));
          }
        }
      });

      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: { sessionId: 'merge-fail-complete', exitCode: 0, success: true },
        }),
      );

      // Task first moves to done (pre-merge), then after merge fails it should be set to failed
      await vi.waitFor(() => {
        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.subStatus).toBe('failed');
      });
    });

    it('should not dispatch merge when autoAgentCompletion is pr', async () => {
      const ws0 = ctx.db
        .insert(workspaces)
        .values({
          name: 'PrWs',
          slug: 'pr-ws',
          autoAgentCompletion: 'pr',
        })
        .returning()
        .get();
      const proj = ctx.db
        .insert(projects)
        .values({ workspaceId: ws0.id, name: 'PR Project', slug: 'pr-proj' })
        .returning()
        .get();
      const task = ctx.db
        .insert(tasks)
        .values({
          title: 'PR task',
          projectId: proj.id,
          status: 'in_progress',
          subStatus: 'implementing',
        })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'pr-complete',
          taskId: task.id,
          status: 'active',
          executionMode: 'task',
          worktreePath: '/tmp/worktree-pr',
        })
        .run();

      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
      await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

      ws.send(
        JSON.stringify({
          type: 'EXECUTION_COMPLETE_EVENT',
          payload: {
            sessionId: 'pr-complete',
            exitCode: 0,
            success: true,
          },
        }),
      );

      // Task should be set to done (standard success path, no merge dispatch)
      await vi.waitFor(() => {
        const updatedTask = ctx.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
        expect(updatedTask!.status).toBe('done');
        expect(updatedTask!.subStatus).toBeNull();
      });

      // Give a small window to ensure no merge message was sent
      await new Promise((r) => setTimeout(r, 100));
      expect(ctx.state.pendingWorktreeMerge.size).toBe(0);
    });
  });
});

describe('CREATE_MEMORIES_EVENT', () => {
  let ctx: TestContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    ctx = setupTestDb();

    const result = await startServer(ctx.state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
    ctx.cleanup();
  });

  it('should insert fleeting memories scoped to the task workspace', async () => {
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'MemWs', slug: 'mem-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Mem Project', slug: 'mem-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Mem task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'mem-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'mem-session',
          memories: [
            { content: 'Always use transactions for batch inserts', type: 'capture' },
            { content: 'Watch out for migration order' },
          ],
        },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(2);
    });

    const inserted = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();

    expect(inserted[0].content).toBe('Always use transactions for batch inserts');
    expect(inserted[0].type).toBe('capture');
    expect(inserted[0].source).toBe('agent');
    expect(inserted[0].workspaceId).toBe(workspace.id);

    expect(inserted[1].content).toBe('Watch out for migration order');
    expect(inserted[1].type).toBe('capture');
    expect(inserted[1].source).toBe('agent');
  });

  it('should insert fleeting memories scoped via taskGroupId when no taskId', async () => {
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'TGWs', slug: 'tg-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'TG Project', slug: 'tg-proj' })
      .returning()
      .get();
    const [taskGroup] = ctx.db
      .insert(taskGroups)
      .values({ projectId: project.id, milestoneRef: 'm1', name: 'TG 1' })
      .returning()
      .all();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'tg-session', taskGroupId: taskGroup.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'tg-session',
          memories: [{ content: 'Task-group scoped memory', type: 'idea' }],
        },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(1);
    });

    const [m] = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();
    expect(m.content).toBe('Task-group scoped memory');
    expect(m.type).toBe('idea');
    expect(m.source).toBe('agent');
    expect(m.workspaceId).toBe(workspace.id);
  });

  it('should coerce an invalid memory type to capture', async () => {
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'BadTypeWs', slug: 'bad-type-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Bad Type Project', slug: 'bad-type-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Bad type task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'bad-type-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'bad-type-session',
          memories: [{ content: 'An agent emitted a bogus type', type: 'note' }],
        },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(1);
    });

    const inserted = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();
    expect(inserted[0].type).toBe('capture');
  });

  it('should default memory type to capture when not specified', async () => {
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'DefWs', slug: 'def-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Def Project', slug: 'def-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Def task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'def-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'def-session',
          memories: [{ content: 'A memory without type' }],
        },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(1);
    });

    const [m] = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();
    expect(m.type).toBe('capture');
  });

  it('should cap memories at 50 per event and warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'CapsWs', slug: 'caps-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Caps Project', slug: 'caps-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Caps task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'caps-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    const memories = Array.from({ length: 60 }, (_, i) => ({ content: `Memory ${i}` }));
    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: { sessionId: 'caps-session', memories },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(50);
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('capping to 50'));
    warnSpy.mockRestore();
  });

  it('should not let invalid entries crowd out valid entries past the cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'MixWs', slug: 'mix-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Mix Project', slug: 'mix-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Mix task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'mix-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    // 10 oversized (invalid) entries followed by 55 valid entries.
    // With cap-before-filter the invalid entries consume 10 slots leaving only 40
    // valid entries visible (capped at 50 total). With filter-before-cap all 55
    // valid entries are filtered first, then capped at 50, so exactly 50 get stored.
    const oversized = Array.from({ length: 10 }, () => ({ content: 'x'.repeat(10_001) }));
    const valid = Array.from({ length: 55 }, (_, i) => ({ content: `Valid memory ${i}` }));
    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: { sessionId: 'mix-session', memories: [...oversized, ...valid] },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(50);
    });

    warnSpy.mockRestore();
  });

  it('should drop memories whose content exceeds 10_000 chars and warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'LongWs', slug: 'long-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'Long Project', slug: 'long-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'Long task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'long-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'long-session',
          memories: [
            { content: 'x'.repeat(10_001) },
            { content: 'Short and valid' },
          ],
        },
      }),
    );

    await vi.waitFor(() => {
      const inserted = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.workspaceId, workspace.id))
        .all();
      expect(inserted).toHaveLength(1);
    });

    const [m] = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();
    expect(m.content).toBe('Short and valid');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('10000 chars'));
    warnSpy.mockRestore();
  });

  it('should not crash on a malformed payload', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(JSON.stringify({ type: 'CREATE_MEMORIES_EVENT' }));
    ws.send(JSON.stringify({ type: 'CREATE_MEMORIES_EVENT', payload: { sessionId: 123 } }));
    ws.send(JSON.stringify({ type: 'CREATE_MEMORIES_EVENT', payload: { sessionId: 's', memories: 'bad' } }));

    await new Promise((r) => setTimeout(r, 100));

    const all = ctx.db.select().from(fleetingMemories).all();
    expect(all).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should log warning and skip when sessionId is unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'ghost-session',
          memories: [{ content: 'Should not be inserted' }],
        },
      }),
    );

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost-session'));
    });

    const all = ctx.db.select().from(fleetingMemories).all();
    expect(all).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('should log warning and skip when session has no taskId or taskGroupId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ctx.db.insert(agentSessions).values({ sessionId: 'no-task-session', status: 'active' }).run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'no-task-session',
          memories: [{ content: 'Should not be inserted' }],
        },
      }),
    );

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-task-session'));
    });

    const all = ctx.db.select().from(fleetingMemories).all();
    expect(all).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('should persist memories sent immediately before EXECUTION_COMPLETE_EVENT', async () => {
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'RtWs', slug: 'rt-ws' })
      .returning()
      .get();
    const project = ctx.db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'RT Project', slug: 'rt-proj' })
      .returning()
      .get();
    const task = ctx.db
      .insert(tasks)
      .values({ title: 'RT task', projectId: project.id, status: 'in_progress' })
      .returning()
      .get();
    ctx.db
      .insert(agentSessions)
      .values({ sessionId: 'rt-session', taskId: task.id, status: 'active' })
      .run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_EVENT',
        payload: {
          sessionId: 'rt-session',
          memories: [{ content: 'Memory before completion', type: 'capture' }],
        },
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'EXECUTION_COMPLETE_EVENT',
        payload: { sessionId: 'rt-session', exitCode: 0, success: true },
      }),
    );

    await vi.waitFor(() => {
      const session = ctx.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.sessionId, 'rt-session'))
        .get();
      expect(session!.status).toBe('completed');
    });

    const inserted = ctx.db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.workspaceId, workspace.id))
      .all();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].content).toBe('Memory before completion');
    expect(inserted[0].source).toBe('agent');
  });
});

describe('FS_DELETE_RESPONSE', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('should resolve with success on FS_DELETE_RESPONSE', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const deletePromise = dispatchFsDelete('/tmp/repo', 'src/file.ts', state);

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; rootDir: string; relPath: string };
    };
    expect(request.type).toBe('FS_DELETE_REQUEST');
    expect(request.payload.rootDir).toBe('/tmp/repo');
    expect(request.payload.relPath).toBe('src/file.ts');

    ws.send(
      JSON.stringify({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId: request.payload.requestId, success: true },
      }),
    );

    const result = await deletePromise;
    expect(result.success).toBe(true);
  });

  it('should reject on FS_DELETE_RESPONSE error payload', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const deletePromise = dispatchFsDelete('/tmp/repo', 'missing.ts', state);

    const request = (await messagePromise) as { type: string; payload: { requestId: string } };

    ws.send(
      JSON.stringify({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId: request.payload.requestId, error: 'ENOENT: no such file' },
      }),
    );

    await expect(deletePromise).rejects.toThrow('ENOENT: no such file');
  });

  it('[FR-WS-060] should reject if no daemon is connected', async () => {
    await expect(dispatchFsDelete('/tmp/repo', 'x.ts', state)).rejects.toThrow(
      'No daemon connected',
    );
  });
});

describe('FS_RENAME_RESPONSE', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('should resolve with success on FS_RENAME_RESPONSE', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const renamePromise = dispatchFsRename('/tmp/repo', 'old.ts', 'new.ts', state);

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; rootDir: string; oldRelPath: string; newRelPath: string };
    };
    expect(request.type).toBe('FS_RENAME_REQUEST');
    expect(request.payload.rootDir).toBe('/tmp/repo');
    expect(request.payload.oldRelPath).toBe('old.ts');
    expect(request.payload.newRelPath).toBe('new.ts');

    ws.send(
      JSON.stringify({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId: request.payload.requestId, success: true },
      }),
    );

    const result = await renamePromise;
    expect(result.success).toBe(true);
  });

  it('should reject on FS_RENAME_RESPONSE error payload', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const renamePromise = dispatchFsRename('/tmp/repo', 'old.ts', 'new.ts', state);
    const request = (await messagePromise) as { type: string; payload: { requestId: string } };

    ws.send(
      JSON.stringify({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId: request.payload.requestId, error: 'already exists' },
      }),
    );

    await expect(renamePromise).rejects.toThrow('already exists');
  });

  it('[FR-WS-060] should reject if no daemon is connected', async () => {
    await expect(dispatchFsRename('/tmp/repo', 'old.ts', 'new.ts', state)).rejects.toThrow(
      'No daemon connected',
    );
  });
});

describe('[FR-WS-150] GH_PR_LIST_RESPONSE', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('should resolve with prs on success response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const prListPromise = dispatchGhPrList('/tmp/repo', state);

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; repoDir: string };
    };
    expect(request.type).toBe('GH_PR_LIST_REQUEST');
    expect(request.payload.repoDir).toBe('/tmp/repo');

    ws.send(
      JSON.stringify({
        type: 'GH_PR_LIST_RESPONSE',
        payload: {
          requestId: request.payload.requestId,
          prs: [
            {
              number: 42,
              title: 'Fix bug',
              url: 'https://github.com/owner/repo/pull/42',
              headBranch: 'fix-bug',
              author: 'alice',
              isDraft: false,
              state: 'OPEN',
              reviewDecision: null,
              ciStatus: 'passing',
              checks: [],
            },
          ],
        },
      }),
    );

    const result = await prListPromise;
    expect(result.prs).toHaveLength(1);
    expect(result.prs[0].number).toBe(42);
    expect(result.prs[0].ciStatus).toBe('passing');
  });

  it('should reject on error response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const prListPromise = dispatchGhPrList('/bad/repo', state);

    const request = (await messagePromise) as { type: string; payload: { requestId: string } };
    ws.send(
      JSON.stringify({
        type: 'GH_PR_LIST_RESPONSE',
        payload: { requestId: request.payload.requestId, error: 'not a git repo' },
      }),
    );

    await expect(prListPromise).rejects.toThrow('not a git repo');
    expect(state.pendingGhPrList.size).toBe(0);
  });

  it('[FR-WS-060] should reject if no daemon is connected', async () => {
    await expect(dispatchGhPrList('/tmp/repo', state)).rejects.toThrow('No daemon connected');
  });

  it('[FR-WS-030] should reject pending pr list ops when daemon disconnects', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const prListPromise = dispatchGhPrList('/tmp/repo', state);
    ws.close();

    await expect(prListPromise).rejects.toThrow('Daemon disconnected');
    expect(state.pendingGhPrList.size).toBe(0);
  });

  it('should forward coderWorkspace in the request payload', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    dispatchGhPrList('/remote/repo', state, 'my-coder-ws').catch(() => {});

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; repoDir: string; coderWorkspace?: string };
    };
    expect(request.payload.coderWorkspace).toBe('my-coder-ws');
  });
});

describe('[FR-WS-170] GH_PR_FAILED_LOGS_RESPONSE', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('should resolve with logs on success response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const logsPromise = dispatchGhPrFailedLogs('/tmp/repo', 1, state);

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; repoDir: string; prNumber: number };
    };
    expect(request.type).toBe('GH_PR_FAILED_LOGS_REQUEST');
    expect(request.payload.repoDir).toBe('/tmp/repo');
    expect(request.payload.prNumber).toBe(1);

    ws.send(
      JSON.stringify({
        type: 'GH_PR_FAILED_LOGS_RESPONSE',
        payload: {
          requestId: request.payload.requestId,
          logs: [{ checkName: 'Lint', excerpt: 'ESLint: 3 errors' }],
        },
      }),
    );

    const result = await logsPromise;
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].checkName).toBe('Lint');
    expect(result.logs[0].excerpt).toBe('ESLint: 3 errors');
  });

  it('should reject on error response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const logsPromise = dispatchGhPrFailedLogs('/bad/repo', 99, state);

    const request = (await messagePromise) as { type: string; payload: { requestId: string } };
    ws.send(
      JSON.stringify({
        type: 'GH_PR_FAILED_LOGS_RESPONSE',
        payload: { requestId: request.payload.requestId, error: 'pr not found' },
      }),
    );

    await expect(logsPromise).rejects.toThrow('pr not found');
    expect(state.pendingGhPrFailedLogs.size).toBe(0);
  });

  it('should reject if no daemon is connected', async () => {
    await expect(dispatchGhPrFailedLogs('/tmp/repo', 1, state)).rejects.toThrow(
      'No daemon connected',
    );
  });

  it('should reject pending log ops when daemon disconnects', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const logsPromise = dispatchGhPrFailedLogs('/tmp/repo', 1, state);
    ws.close();

    await expect(logsPromise).rejects.toThrow('Daemon disconnected');
    expect(state.pendingGhPrFailedLogs.size).toBe(0);
  });

  it('should forward coderWorkspace in the request payload', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    dispatchGhPrFailedLogs('/remote/repo', 7, state, 'my-coder-ws').catch(() => {});

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; coderWorkspace?: string };
    };
    expect(request.payload.coderWorkspace).toBe('my-coder-ws');
  });
});

describe('[FR-WS-180] GH_PR_REVIEW_COMMENTS_RESPONSE', () => {
  let state: AppState;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    openClients = [];
    state = createAppState();
    const result = await startServer(state);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients = [];
    await closeServer(server);
  });

  it('should resolve with comments on success response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const commentsPromise = dispatchGhPrReviewComments('/tmp/repo', 7, state);

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; repoDir: string; prNumber: number };
    };
    expect(request.type).toBe('GH_PR_REVIEW_COMMENTS_REQUEST');
    expect(request.payload.repoDir).toBe('/tmp/repo');
    expect(request.payload.prNumber).toBe(7);

    const fakeComment = {
      githubId: 123,
      path: 'src/foo.ts',
      line: 10,
      body: 'Nice change',
      author: 'reviewer',
      createdAt: '2024-01-01T00:00:00Z',
      inReplyToId: null,
      url: 'https://github.com/org/repo/pull/7#discussion_r123',
    };
    ws.send(
      JSON.stringify({
        type: 'GH_PR_REVIEW_COMMENTS_RESPONSE',
        payload: { requestId: request.payload.requestId, comments: [fakeComment] },
      }),
    );

    const result = await commentsPromise;
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].githubId).toBe(123);
    expect(result.comments[0].path).toBe('src/foo.ts');
  });

  it('should reject on error response', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    const commentsPromise = dispatchGhPrReviewComments('/bad/repo', 99, state);

    const request = (await messagePromise) as { type: string; payload: { requestId: string } };
    ws.send(
      JSON.stringify({
        type: 'GH_PR_REVIEW_COMMENTS_RESPONSE',
        payload: { requestId: request.payload.requestId, error: 'repo not found' },
      }),
    );

    await expect(commentsPromise).rejects.toThrow('repo not found');
    expect(state.pendingGhPrReviewComments.size).toBe(0);
  });

  it('should reject if no daemon is connected', async () => {
    await expect(dispatchGhPrReviewComments('/tmp/repo', 1, state)).rejects.toThrow(
      'No daemon connected',
    );
  });

  it('should reject pending ops when daemon disconnects', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const commentsPromise = dispatchGhPrReviewComments('/tmp/repo', 1, state);
    ws.close();

    await expect(commentsPromise).rejects.toThrow('Daemon disconnected');
    expect(state.pendingGhPrReviewComments.size).toBe(0);
  });

  it('should forward coderWorkspace in the request payload', async () => {
    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(state.daemon).not.toBeNull());

    const messagePromise = waitForMessage(ws);
    dispatchGhPrReviewComments('/remote/repo', 3, state, 'my-coder-ws').catch(() => {});

    const request = (await messagePromise) as {
      type: string;
      payload: { requestId: string; coderWorkspace?: string };
    };
    expect(request.payload.coderWorkspace).toBe('my-coder-ws');
  });
});
