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
} from './server';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { agentSessions, tasks, projects, workspaces, fleetingMemories } from '../db/schema';

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

  describe('REGISTER', () => {
    it('should set daemon reference on REGISTER', async () => {
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

    it('should replace daemon when a second client registers', async () => {
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

    it('should clear daemon reference on close', async () => {
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

  describe('FILE_CHANGE', () => {
    it('should store file change events in the ring buffer', async () => {
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

    it('should cap events at 100 per workspace', async () => {
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

    it('should keep separate ring buffers per workspace', async () => {
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
    it('should resolve pending validation on response', async () => {
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

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchValidation(['/foo.ts'], state)).rejects.toThrow('No daemon connected');
    });

    it('should time out if no response arrives', async () => {
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
    it('should resolve pending file search on response', async () => {
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

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchFileSearch(['/tmp'], '', 20, state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should time out if no response arrives', async () => {
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
    it('should resolve with files on success response', async () => {
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

    it('should reject on error payload', async () => {
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

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchGlobFiles('/tmp/repo', ['*.test.ts'], state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should reject all pending glob ops when daemon disconnects', async () => {
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
    it('should resolve pending worktree list on response', async () => {
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

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchGitWorktreeList('/tmp/repo', state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should reject on error response', async () => {
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
    it('should resolve with results on success response', async () => {
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

    it('should reject if no daemon is connected', async () => {
      await expect(dispatchCreateDir(['/tmp/newdir'], state)).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should time out if no response arrives', async () => {
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

    it('should reject pending dirs when daemon disconnects and clear daemonHomeDir', async () => {
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

  describe('REGISTER homeDir', () => {
    it('should store homeDir from REGISTER payload', async () => {
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'REGISTER', payload: { homeDir: '/home/alice' } }));

      await vi.waitFor(
        () => {
          expect(state.daemonHomeDir).toBe('/home/alice');
        },
        { timeout: 5000 },
      );
    });

    it('should set daemonHomeDir to null when homeDir is absent from payload', async () => {
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

    it('should clear daemonHomeDir when daemon disconnects', async () => {
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
    it('should set session to completed and clear task subStatus on success', async () => {
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

    it('should set subStatus to plan_review on planning mode success', async () => {
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

    it('should dispatch REMOTE_FILE_PULL for coder workspace on planning success', async () => {
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

    it('should dispatch WORKTREE_MERGE_REQUEST on implementation success with merge setting', async () => {
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
        received.push(JSON.parse(data.toString()));
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

describe('CREATE_MEMORIES_REQUEST', () => {
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
        type: 'CREATE_MEMORIES_REQUEST',
        sessionId: 'mem-session',
        memories: [
          { content: 'Always use transactions for batch inserts', type: 'capture' },
          { content: 'Watch out for migration order' },
        ],
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
        type: 'CREATE_MEMORIES_REQUEST',
        sessionId: 'bad-type-session',
        memories: [{ content: 'An agent emitted a bogus type', type: 'note' }],
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
        type: 'CREATE_MEMORIES_REQUEST',
        sessionId: 'def-session',
        memories: [{ content: 'A memory without type' }],
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

  it('should log warning and skip when sessionId is unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_REQUEST',
        sessionId: 'ghost-session',
        memories: [{ content: 'Should not be inserted' }],
      }),
    );

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost-session'));
    });

    const all = ctx.db.select().from(fleetingMemories).all();
    expect(all).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('should log warning and skip when session has no taskId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ctx.db.insert(agentSessions).values({ sessionId: 'no-task-session', status: 'active' }).run();

    const ws = await connectClient(port);
    ws.send(JSON.stringify({ type: 'REGISTER', payload: {} }));
    await vi.waitFor(() => expect(ctx.state.daemon).not.toBeNull());

    ws.send(
      JSON.stringify({
        type: 'CREATE_MEMORIES_REQUEST',
        sessionId: 'no-task-session',
        memories: [{ content: 'Should not be inserted' }],
      }),
    );

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-task-session'));
    });

    const all = ctx.db.select().from(fleetingMemories).all();
    expect(all).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
