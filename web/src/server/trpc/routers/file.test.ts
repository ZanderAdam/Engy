import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';

describe('file router', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx?.cleanup();
  });

  describe('validatePaths', () => {
    it('should throw when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.file.validatePaths({ paths: ['/tmp/some-path'] })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should pass paths through to daemon and return results', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'VALIDATE_PATHS_REQUEST') {
            const pending = ctx.state.pendingValidations.get(msg.payload.requestId);
            if (pending) {
              pending.resolve([
                { path: '/tmp/exists', exists: true },
                { path: '/tmp/missing', exists: false },
              ]);
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      const result = await caller.file.validatePaths({
        paths: ['/tmp/exists', '/tmp/missing'],
      });

      expect(result.results).toEqual([
        { path: '/tmp/exists', exists: true },
        { path: '/tmp/missing', exists: false },
      ]);
    });
  });

  describe('home', () => {
    it('should throw PRECONDITION_FAILED when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.file.home()).rejects.toThrow('No daemon connected');
    });

    it('should throw PRECONDITION_FAILED when daemon reported no home directory', async () => {
      ctx.state.daemon = { readyState: WebSocket.OPEN, OPEN: WebSocket.OPEN } as WebSocket;
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.file.home()).rejects.toThrow('did not report a home directory');
    });

    it('should return daemonHomeDir when set', async () => {
      ctx.state.daemon = { readyState: WebSocket.OPEN, OPEN: WebSocket.OPEN } as WebSocket;
      ctx.state.daemonHomeDir = '/home/alice';
      const caller = appRouter.createCaller({ state: ctx.state });

      const result = await caller.file.home();
      expect(result).toEqual({ path: '/home/alice' });
    });
  });

  describe('listDir', () => {
    it('throws when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.file.listDir({ dirPath: '/tmp/repo' })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('returns NOT_FOUND when daemon reports ENOENT for missing path', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'DIR_LIST_REQUEST') {
            const pending = ctx.state.pendingDirList.get(msg.payload.requestId);
            if (pending) {
              pending.reject(new Error('ENOENT: no such file or directory'));
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      await expect(
        caller.file.listDir({ dirPath: '/nonexistent/path' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns NOT_FOUND when daemon reports "not found" for missing path', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'DIR_LIST_REQUEST') {
            const pending = ctx.state.pendingDirList.get(msg.payload.requestId);
            if (pending) {
              pending.reject(new Error('Directory not found'));
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      await expect(
        caller.file.listDir({ dirPath: '/nonexistent/path' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('read', () => {
    it('throws when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({ repoDir: '/tmp/repo', filePath: 'file.txt' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('uses worktreePath as effective dir when provided', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          worktreePath: '/tmp/worktree',
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('accepts coderWorkspace in input', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.read({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          coderWorkspace: 'my-coder-ws',
        }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('write', () => {
    it('throws when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({ repoDir: '/tmp/repo', filePath: 'file.txt', content: 'hello' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('uses worktreePath as effective dir when provided', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          content: 'hello',
          worktreePath: '/tmp/worktree',
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('accepts coderWorkspace in input', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.write({
          repoDir: '/tmp/repo',
          filePath: 'file.txt',
          content: 'hello',
          coderWorkspace: 'my-coder-ws',
        }),
      ).rejects.toThrow('No daemon connected');
    });
  });

  describe('createDir', () => {
    it('should throw when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(caller.file.createDir({ rootDir: '/tmp/repo', relPath: 'newdir' })).rejects.toThrow(
        'No daemon connected',
      );
    });

    it('should return success when daemon creates the directory', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'CREATE_DIR_REQUEST') {
            const pending = ctx.state.pendingCreateDirs.get(msg.payload.requestId);
            if (pending) {
              pending.resolve({
                results: [{ path: '/tmp/repo/newdir', success: true }],
              });
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      const result = await caller.file.createDir({ rootDir: '/tmp/repo', relPath: 'newdir' });
      expect(result).toEqual({ success: true });
    });

    it('should throw BAD_REQUEST when daemon reports failure for the path', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'CREATE_DIR_REQUEST') {
            const pending = ctx.state.pendingCreateDirs.get(msg.payload.requestId);
            if (pending) {
              pending.resolve({
                results: [{ path: '/tmp/repo/newdir', success: false, error: 'Permission denied' }],
              });
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      await expect(caller.file.createDir({ rootDir: '/tmp/repo', relPath: 'newdir' })).rejects.toThrow(
        'Permission denied',
      );
    });

    it('should reject traversal in relPath without contacting the daemon', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.createDir({ rootDir: '/tmp/repo', relPath: '../evil' }),
      ).rejects.toThrow(/traversal/i);
    });

    it('should reject absolute relPath without contacting the daemon', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.createDir({ rootDir: '/tmp/repo', relPath: '/etc/evil' }),
      ).rejects.toThrow(/absolute/i);
    });
  });

  describe('deleteEntry', () => {
    it('should throw when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.deleteEntry({ rootDir: '/tmp/repo', relPath: 'src/file.ts' }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should return success when daemon deletes the entry', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'FS_DELETE_REQUEST') {
            const pending = ctx.state.pendingFsDelete.get(msg.payload.requestId);
            if (pending) {
              pending.resolve({ success: true });
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      const result = await caller.file.deleteEntry({ rootDir: '/tmp/repo', relPath: 'file.ts' });
      expect(result.success).toBe(true);
    });

    it('should propagate daemon errors', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'FS_DELETE_REQUEST') {
            const pending = ctx.state.pendingFsDelete.get(msg.payload.requestId);
            if (pending) {
              pending.reject(new Error('Path traversal rejected'));
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      await expect(
        caller.file.deleteEntry({ rootDir: '/tmp/repo', relPath: '../evil' }),
      ).rejects.toThrow('Path traversal rejected');
    });
  });

  describe('renameEntry', () => {
    it('should throw when no daemon is connected', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      await expect(
        caller.file.renameEntry({
          rootDir: '/tmp/repo',
          oldRelPath: 'old.ts',
          newRelPath: 'new.ts',
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should return success when daemon renames the entry', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'FS_RENAME_REQUEST') {
            const pending = ctx.state.pendingFsRename.get(msg.payload.requestId);
            if (pending) {
              pending.resolve({ success: true });
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      const result = await caller.file.renameEntry({
        rootDir: '/tmp/repo',
        oldRelPath: 'old.ts',
        newRelPath: 'new.ts',
      });
      expect(result.success).toBe(true);
    });

    it('should propagate daemon errors', async () => {
      const caller = appRouter.createCaller({ state: ctx.state });

      const fakeSocket = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'FS_RENAME_REQUEST') {
            const pending = ctx.state.pendingFsRename.get(msg.payload.requestId);
            if (pending) {
              pending.reject(new Error('already exists'));
            }
          }
        },
      };
      ctx.state.daemon = fakeSocket as unknown as WebSocket;

      await expect(
        caller.file.renameEntry({
          rootDir: '/tmp/repo',
          oldRelPath: 'old.ts',
          newRelPath: 'existing.ts',
        }),
      ).rejects.toThrow('already exists');
    });
  });
});
