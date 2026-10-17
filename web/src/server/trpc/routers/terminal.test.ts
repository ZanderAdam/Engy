import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { FileWriteRequestMessage } from '@engy/common';
import { appRouter } from '../root';
import { type AppState } from '../context';
import { setupTestDb, type TestContext } from '../test-helpers';
import { terminalSessionHistory, workspaces } from '../../db/schema';
import { recordSessionStart } from '../../ws/terminal-session-history';
import { TERMINAL_IMAGE_MAX_BYTES } from '@/lib/terminal-image';

function addSession(state: AppState, sessionId: string, resumedFrom?: string): void {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: `label-${sessionId}`,
    workingDir: '/tmp',
    agentType: 'claude',
    activityState: 'idle',
    resumedFrom,
    cols: 80,
    rows: 24,
  });
}

describe('terminal router', () => {
  let ctx: TestContext;
  let state: AppState;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    state = ctx.state;
    caller = appRouter.createCaller({ state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('connectWorker', () => {
    it('should connect a live session as a dispatch worker', async () => {
      addSession(state, 'sess-1');
      await caller.terminal.connectWorker({ sessionId: 'sess-1', description: 'claude on auth' });

      const workers = await caller.terminal.listWorkers();
      expect(workers).toHaveLength(1);
      expect(workers[0]).toMatchObject({
        sessionId: 'sess-1',
        description: 'claude on auth',
        agentType: 'claude',
        alive: true,
      });
    });

    it('should reject unknown sessions', async () => {
      await expect(
        caller.terminal.connectWorker({ sessionId: 'ghost', description: 'x' }),
      ).rejects.toThrow('Terminal session not found');
    });

    it('should reject empty descriptions', async () => {
      addSession(state, 'sess-1');
      await expect(
        caller.terminal.connectWorker({ sessionId: 'sess-1', description: '   ' }),
      ).rejects.toThrow();
    });
  });

  describe('disconnectWorker', () => {
    it('should remove the worker from the connected set', async () => {
      addSession(state, 'sess-1');
      await caller.terminal.connectWorker({ sessionId: 'sess-1', description: 'worker' });
      await caller.terminal.disconnectWorker({ sessionId: 'sess-1' });
      expect(await caller.terminal.listWorkers()).toEqual([]);
    });
  });

  describe('discardDormantSession', () => {
    it('[FR-TERMINAL-530] should drop a dormant session and stamp its history row closed', async () => {
      addSession(state, 'dormant-sess');
      state.terminalSessionMeta.get('dormant-sess')!.dormant = true;
      state.terminalSessionMeta.get('dormant-sess')!.workspaceSlug = 'ws1';
      recordSessionStart('dormant-sess', state.terminalSessionMeta.get('dormant-sess')!);

      await caller.terminal.discardDormantSession({ sessionId: 'dormant-sess' });

      expect(state.terminalSessionMeta.has('dormant-sess')).toBe(false);
      const rows = ctx.db.select().from(terminalSessionHistory).all();
      expect(rows[0].closedAt).not.toBeNull();
    });

    it('[FR-TERMINAL-530] should refuse to discard a live session', async () => {
      addSession(state, 'live-sess');

      await expect(
        caller.terminal.discardDormantSession({ sessionId: 'live-sess' }),
      ).rejects.toThrow(/live/);
      expect(state.terminalSessionMeta.has('live-sess')).toBe(true);
    });

    it('[FR-TERMINAL-530] should succeed for a session that is already gone', async () => {
      await expect(
        caller.terminal.discardDormantSession({ sessionId: 'never-existed' }),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe('listSessionHistory', () => {
    function seedRow(
      sessionId: string,
      startedAt: string,
      workspaceSlug = 'ws1',
      projectSlug?: string,
    ): void {
      ctx.db
        .insert(terminalSessionHistory)
        .values({
          sessionId,
          agentType: 'claude',
          workingDir: '/tmp/proj',
          scopeLabel: `label-${sessionId}`,
          summary: `summary-${sessionId}`,
          workspaceSlug,
          projectSlug,
          startedAt,
        })
        .run();
    }

    it('[FR-TERMINAL-350] should return rows newest-first scoped to the workspace', async () => {
      seedRow('old-sess', '2026-07-22T10:00:00.000Z');
      seedRow('new-sess', '2026-07-22T12:00:00.000Z');
      seedRow('other-ws', '2026-07-22T13:00:00.000Z', 'ws2');

      const rows = await caller.terminal.listSessionHistory({ workspaceSlug: 'ws1' });

      expect(rows.map((r) => r.sessionId)).toEqual(['new-sess', 'old-sess']);
    });

    it('[FR-TERMINAL-350] should exclude sessions that are currently live', async () => {
      seedRow('live-sess', '2026-07-22T10:00:00.000Z');
      seedRow('closed-sess', '2026-07-22T11:00:00.000Z');
      addSession(state, 'live-sess');

      const rows = await caller.terminal.listSessionHistory({ workspaceSlug: 'ws1' });

      expect(rows.map((r) => r.sessionId)).toEqual(['closed-sess']);
    });

    it('[FR-TERMINAL-350] should return only the viewed project rows when a project is given', async () => {
      seedRow('alpha-sess', '2026-07-22T10:00:00.000Z', 'ws1', 'alpha');
      seedRow('beta-sess', '2026-07-22T11:00:00.000Z', 'ws1', 'beta');

      const rows = await caller.terminal.listSessionHistory({
        workspaceSlug: 'ws1',
        projectSlug: 'alpha',
      });

      expect(rows.map((r) => r.sessionId)).toEqual(['alpha-sess']);
    });

    it('[FR-TERMINAL-350] should exclude rows matching a live session resumedFrom', async () => {
      seedRow('orig-claude-id', '2026-07-22T10:00:00.000Z');
      addSession(state, 'new-terminal-id', 'orig-claude-id');

      const rows = await caller.terminal.listSessionHistory({ workspaceSlug: 'ws1' });

      expect(rows).toEqual([]);
    });
  });

  describe('[FR-TERMINAL-990] uploadImage', () => {
    const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let writes: FileWriteRequestMessage['payload'][];

    function connectFakeDaemon(): void {
      writes = [];
      state.daemon = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type !== 'FILE_WRITE_REQUEST') return;
          writes.push(msg.payload);
          state.pendingFileWrite.get(msg.payload.requestId)?.resolve({ success: true });
        },
      } as unknown as WebSocket;
    }

    function addUploadSession(containerMode?: string): void {
      state.terminalSessionMeta.set('sess-up', {
        scopeType: 'project',
        scopeLabel: 'label',
        workingDir: '/home/me/repo',
        workspaceSlug: 'ws',
        containerMode,
        cols: 80,
        rows: 24,
      });
    }

    function insertCoderWorkspace(): void {
      ctx.db
        .insert(workspaces)
        .values({
          name: 'WS',
          slug: 'ws',
          docsDir: '/home/me/docs',
          containerEnabled: true,
          executionBackend: 'coder',
          coderConfig: { workspace: 'my-coder-ws', repoBasePath: '/home/me' },
        })
        .run();
    }

    beforeEach(() => {
      connectFakeDaemon();
    });

    it('should write the image and a catch-all .gitignore into the paste dir and return its absolute path', async () => {
      addUploadSession();

      const { path } = await caller.terminal.uploadImage({
        sessionId: 'sess-up',
        mimeType: 'image/png',
        base64: PNG_BYTES.toString('base64'),
      });

      expect(path).toMatch(/^\/home\/me\/repo\/\.engy\/paste\/[\w-]+\.png$/);
      expect(writes).toEqual([
        expect.objectContaining({
          repoDir: '/home/me/repo',
          filePath: '.engy/paste/.gitignore',
          content: '*\n',
        }),
        expect.objectContaining({
          repoDir: '/home/me/repo',
          filePath: path.slice('/home/me/repo/'.length),
          content: PNG_BYTES.toString('base64'),
          encoding: 'base64',
        }),
      ]);
      expect(writes.every((w) => w.coderWorkspace === undefined)).toBe(true);
    });

    it('should give two uploads different file names', async () => {
      addUploadSession();
      const input = {
        sessionId: 'sess-up',
        mimeType: 'image/png',
        base64: PNG_BYTES.toString('base64'),
      };

      const first = await caller.terminal.uploadImage(input);
      const second = await caller.terminal.uploadImage(input);

      expect(first.path).not.toBe(second.path);
    });

    it('should write inside the coder workspace for an isolated coder session', async () => {
      insertCoderWorkspace();
      addUploadSession('container');

      await caller.terminal.uploadImage({
        sessionId: 'sess-up',
        mimeType: 'image/jpeg',
        base64: PNG_BYTES.toString('base64'),
      });

      expect(writes.map((w) => w.coderWorkspace)).toEqual(['my-coder-ws', 'my-coder-ws']);
    });

    it('should write on the host for a host-mode session in a coder workspace', async () => {
      insertCoderWorkspace();
      addUploadSession('host');

      await caller.terminal.uploadImage({
        sessionId: 'sess-up',
        mimeType: 'image/png',
        base64: PNG_BYTES.toString('base64'),
      });

      expect(writes.map((w) => w.coderWorkspace)).toEqual([undefined, undefined]);
    });

    it('should reject an unknown session', async () => {
      await expect(
        caller.terminal.uploadImage({
          sessionId: 'ghost',
          mimeType: 'image/png',
          base64: PNG_BYTES.toString('base64'),
        }),
      ).rejects.toThrow('Terminal session not found');
      expect(writes).toEqual([]);
    });

    it('should reject an unsupported type without writing anything', async () => {
      addUploadSession();

      await expect(
        caller.terminal.uploadImage({
          sessionId: 'sess-up',
          mimeType: 'image/heic',
          base64: PNG_BYTES.toString('base64'),
        }),
      ).rejects.toThrow(/PNG, JPEG, GIF or WebP/);
      expect(writes).toEqual([]);
    });

    it('should reject an image over the size limit without writing anything', async () => {
      addUploadSession();

      await expect(
        caller.terminal.uploadImage({
          sessionId: 'sess-up',
          mimeType: 'image/png',
          base64: Buffer.alloc(TERMINAL_IMAGE_MAX_BYTES + 1).toString('base64'),
        }),
      ).rejects.toThrow(/5 MB/);
      expect(writes).toEqual([]);
    });
  });
});
