import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { FileWriteRequestMessage } from '@engy/common';
import { appRouter } from '../root';
import { type AppState } from '../context';
import { setupTestDb, type TestContext } from '../test-helpers';
import { projects, terminalSessionHistory, terminalSessions, workspaces } from '../../db/schema';
import { recordSessionStart } from '../../ws/terminal-session-history';
import { TERMINAL_IMAGE_MAX_BYTES } from '@/lib/terminal-image';
import { createDispatch } from '../../terminal-dispatch';
import { getDispatch } from '../../terminal-dispatch-store';

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

  describe('resolveLink', () => {
    it('[FR-TERMINAL-1150] should resolve a live session to its workspace and project', async () => {
      state.terminalSessionMeta.set('s1', {
        scopeType: 'project',
        scopeLabel: 'project: alpha',
        workingDir: '/tmp',
        workspaceSlug: 'ws',
        projectSlug: 'alpha',
        cols: 80,
        rows: 24,
      });
      expect(await caller.terminal.resolveLink({ sessionId: 's1' })).toEqual({
        status: 'live',
        workspaceSlug: 'ws',
        projectSlug: 'alpha',
      });
    });

    it('[FR-TERMINAL-1160] should return null for an unknown session', async () => {
      expect(await caller.terminal.resolveLink({ sessionId: 'nope' })).toBeNull();
    });
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
        connected: true,
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
      expect((await caller.terminal.listWorkers()).map((w) => w.connected)).toEqual([false]);
    });

    it('[FR-TERMINAL-280] should fail the queued dispatches of the disconnected worker', async () => {
      addSession(state, 'sess-1');
      state.terminalSessionMeta.get('sess-1')!.activityState = 'active';
      await caller.terminal.connectWorker({ sessionId: 'sess-1', description: 'worker' });
      const queued = createDispatch(state, 'sess-1', 'task');

      await caller.terminal.disconnectWorker({ sessionId: 'sess-1' });

      expect(getDispatch(queued.correlationId)?.status).toBe('failed');
    });
  });

  describe('setOrchestrator', () => {
    it('[FR-TERMINAL-1180] should give the role to one terminal and take it from the previous holder', async () => {
      addSession(state, 'a');
      addSession(state, 'b');

      await caller.terminal.setOrchestrator({ sessionId: 'a', enabled: true });
      await caller.terminal.setOrchestrator({ sessionId: 'b', enabled: true });

      expect(state.terminalSessionMeta.get('a')!.orchestrator).toBeUndefined();
      expect(state.terminalSessionMeta.get('b')!.orchestrator).toBe(true);
      const flags = await caller.terminal.listWorkers();
      expect(flags.filter((w) => w.orchestrator).map((w) => w.sessionId)).toEqual(['b']);
    });

    it('[FR-TERMINAL-1180] should persist the role with the session', async () => {
      addSession(state, 'a');
      await caller.terminal.setOrchestrator({ sessionId: 'a', enabled: true });
      const row = ctx.db.select().from(terminalSessions).get();
      expect((row?.meta as { orchestrator?: boolean }).orchestrator).toBe(true);
    });

    it('[FR-TERMINAL-1180] should clear the role', async () => {
      addSession(state, 'a');
      await caller.terminal.setOrchestrator({ sessionId: 'a', enabled: true });
      await caller.terminal.setOrchestrator({ sessionId: 'a', enabled: false });
      expect(state.terminalSessionMeta.get('a')!.orchestrator).toBeUndefined();
    });

    it('[FR-TERMINAL-1180] should refuse unknown, dormant and plain-shell sessions', async () => {
      await expect(caller.terminal.setOrchestrator({ sessionId: 'ghost', enabled: true })).rejects.toThrow(
        'not found',
      );
      addSession(state, 'sleeping');
      state.terminalSessionMeta.get('sleeping')!.dormant = true;
      await expect(
        caller.terminal.setOrchestrator({ sessionId: 'sleeping', enabled: true }),
      ).rejects.toThrow('not found');
      addSession(state, 'shell');
      state.terminalSessionMeta.get('shell')!.agentType = undefined;
      await expect(caller.terminal.setOrchestrator({ sessionId: 'shell', enabled: true })).rejects.toThrow(
        'Only agent terminals',
      );
    });
  });

  describe('setDispatchOptOut', () => {
    it('[FR-TERMINAL-1190] should flag and unflag a terminal, visible in listWorkers', async () => {
      addSession(state, 'a');
      await caller.terminal.setDispatchOptOut({ sessionId: 'a', optOut: true });
      expect((await caller.terminal.listWorkers())[0].dispatchOptOut).toBe(true);
      await caller.terminal.setDispatchOptOut({ sessionId: 'a', optOut: false });
      expect((await caller.terminal.listWorkers())[0].dispatchOptOut).toBe(false);
    });
  });

  describe('startOrchestrator', () => {
    function fakeDaemon(sent: string[]) {
      return { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d) } as unknown as WebSocket;
    }

    beforeEach(() => {
      ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos: ['/repo'] }).run();
    });

    it('[FR-TERMINAL-1200] should spawn a workspace-scope agent terminal and mark it orchestrator', async () => {
      const sent: string[] = [];
      state.terminalDaemon = fakeDaemon(sent);

      const { sessionId } = await caller.terminal.startOrchestrator({ workspaceSlug: 'ws' });

      const spawn = JSON.parse(sent[0]) as { t: string; workingDir: string; command: string };
      expect(spawn).toMatchObject({ t: 'spawn', workingDir: '/repo' });
      expect(spawn.command).toContain(`/mcp/${sessionId}`);
      expect(spawn.command).toContain('terminal_list_workers');
      expect(state.terminalSessionMeta.get(sessionId)).toMatchObject({
        orchestrator: true,
        scopeType: 'workspace',
        groupKey: 'workspace:ws',
        workspaceSlug: 'ws',
        agentType: 'claude',
        containerMode: 'host',
      });
      expect(state.terminalSessionMeta.get(sessionId)!.spawnedBy).toBeUndefined();
      expect(state.dispatchWorkers.has(sessionId)).toBe(false);
    });

    it('[FR-TERMINAL-1200] should spawn in the project of the current dock', async () => {
      const sent: string[] = [];
      state.terminalDaemon = fakeDaemon(sent);
      const workspace = ctx.db.select().from(workspaces).get()!;
      ctx.db.insert(projects).values({ workspaceId: workspace.id, name: 'P', slug: 'proj' }).run();

      const { sessionId } = await caller.terminal.startOrchestrator({
        workspaceSlug: 'ws',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
        workingDir: '/repo/wt',
      });

      expect(JSON.parse(sent[0])).toMatchObject({ workingDir: '/repo/wt' });
      expect(state.terminalSessionMeta.get(sessionId)).toMatchObject({
        orchestrator: true,
        scopeType: 'project',
        groupKey: 'project:ws:proj:wt:feat/x',
        projectSlug: 'proj',
        worktreeBranch: 'feat/x',
      });
    });

    it('[FR-TERMINAL-1200] should refuse an unknown project', async () => {
      state.terminalDaemon = fakeDaemon([]);
      await expect(
        caller.terminal.startOrchestrator({ workspaceSlug: 'ws', projectSlug: 'nope' }),
      ).rejects.toThrow('Project not found');
    });

    it('[FR-TERMINAL-1180] should keep the orchestrator of another project', async () => {
      addSession(state, 'alpha');
      addSession(state, 'beta');
      state.terminalSessionMeta.get('alpha')!.projectSlug = 'alpha';
      state.terminalSessionMeta.get('beta')!.projectSlug = 'beta';

      await caller.terminal.setOrchestrator({ sessionId: 'alpha', enabled: true });
      await caller.terminal.setOrchestrator({ sessionId: 'beta', enabled: true });

      expect(state.terminalSessionMeta.get('alpha')!.orchestrator).toBe(true);
      expect(state.terminalSessionMeta.get('beta')!.orchestrator).toBe(true);
    });

    it('[FR-TERMINAL-1200] should move the role from a previous orchestrator', async () => {
      state.terminalDaemon = fakeDaemon([]);
      addSession(state, 'old');
      state.terminalSessionMeta.get('old')!.workspaceSlug = 'ws';
      await caller.terminal.setOrchestrator({ sessionId: 'old', enabled: true });

      const { sessionId } = await caller.terminal.startOrchestrator({ workspaceSlug: 'ws' });

      expect(state.terminalSessionMeta.get('old')!.orchestrator).toBeUndefined();
      expect(state.terminalSessionMeta.get(sessionId)!.orchestrator).toBe(true);
    });

    it('[FR-TERMINAL-1200] should refuse an unknown workspace, a deactivated agent, and a missing daemon', async () => {
      await expect(caller.terminal.startOrchestrator({ workspaceSlug: 'nope' })).rejects.toThrow(
        'Workspace not found',
      );
      await expect(caller.terminal.startOrchestrator({ workspaceSlug: 'ws' })).rejects.toThrow(
        'No terminal daemon',
      );
      ctx.db.update(workspaces).set({ agentSettings: { claude: { active: false } } }).run();
      await expect(caller.terminal.startOrchestrator({ workspaceSlug: 'ws' })).rejects.toThrow(
        'deactivated',
      );
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

  describe('parkSession', () => {
    let sent: Array<{ t?: string; sessionId?: string; type?: string }>;
    let transcript: string | Error;

    function connectFakeDaemon(): void {
      sent = [];
      transcript = '';
      const daemon = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          sent.push(msg);
          if (msg.type !== 'FILE_READ_REQUEST') return;
          const pending = state.pendingFileRead.get(msg.payload.requestId);
          if (transcript instanceof Error) pending?.reject(transcript);
          else pending?.resolve({ content: transcript });
        },
      } as unknown as WebSocket;
      state.daemon = daemon;
      state.terminalDaemon = daemon;
    }

    function addBrowser(sessionId: string): { frames: string[]; closed: () => boolean } {
      const frames: string[] = [];
      let closed = false;
      const ws = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => frames.push(data),
        close: () => {
          closed = true;
        },
      } as unknown as WebSocket;
      state.terminalSessions.set(sessionId, new Set([ws]));
      return { frames, closed: () => closed };
    }

    it('[FR-TERMINAL-1070] should kill the PTY and keep the session dormant', async () => {
      connectFakeDaemon();
      addSession(state, 's1');
      const meta = state.terminalSessionMeta.get('s1')!;
      meta.transcriptPath = '/home/me/.claude/projects/repo/conv.jsonl';
      meta.lastReply = 'Last reply';
      const browser = addBrowser('s1');

      await caller.terminal.parkSession({ sessionId: 's1' });

      expect(sent).toContainEqual({ t: 'kill', sessionId: 's1' });
      expect(meta.dormant).toBe(true);
      expect(meta.brief).toBe('Last reply');
      expect(meta.activityState).toBe('idle');
      expect(JSON.parse(browser.frames[0])).toMatchObject({ t: 'exit', parked: true });
      expect(browser.closed()).toBe(true);
      expect(state.terminalSessions.has('s1')).toBe(false);
      expect(ctx.db.select().from(terminalSessionHistory).all()).toEqual([]);
    });

    it('[FR-TERMINAL-1085] should prefer a current recap over the last reply', async () => {
      connectFakeDaemon();
      transcript = JSON.stringify({
        subtype: 'away_summary',
        content: 'Recap of the work.',
        timestamp: new Date(1000).toISOString(),
      });
      addSession(state, 's1');
      const meta = state.terminalSessionMeta.get('s1')!;
      meta.transcriptPath = '/home/me/.claude/projects/repo/conv.jsonl';
      meta.lastReply = 'Last reply';
      meta.lastStopAt = 500;

      await caller.terminal.parkSession({ sessionId: 's1' });

      expect(meta.brief).toBe('Recap of the work.');
    });

    it('[FR-TERMINAL-1085] should fall back to the last reply when the read fails', async () => {
      connectFakeDaemon();
      transcript = new Error('ENOENT');
      addSession(state, 's1');
      const meta = state.terminalSessionMeta.get('s1')!;
      meta.transcriptPath = '/gone/conv.jsonl';
      meta.lastReply = 'Last reply';

      await caller.terminal.parkSession({ sessionId: 's1' });

      expect(meta.brief).toBe('Last reply');
      expect(meta.dormant).toBe(true);
    });

    it('[FR-TERMINAL-1075] should refuse a terminal that cannot resume', async () => {
      connectFakeDaemon();
      addSession(state, 's1');
      state.terminalSessionMeta.get('s1')!.agentType = 'codex';

      await expect(caller.terminal.parkSession({ sessionId: 's1' })).rejects.toThrow(
        'Only a Claude terminal',
      );
      expect(state.terminalSessionMeta.get('s1')?.dormant).toBeUndefined();
    });

    it('[FR-TERMINAL-1075] should refuse a session with no agent reply yet', async () => {
      connectFakeDaemon();
      addSession(state, 's1');

      await expect(caller.terminal.parkSession({ sessionId: 's1' })).rejects.toThrow(
        'Nothing to park yet',
      );
    });

    it('[FR-TERMINAL-1070] should not kill a session restored during the transcript read', async () => {
      connectFakeDaemon();
      addSession(state, 's1');
      const meta = state.terminalSessionMeta.get('s1')!;
      meta.transcriptPath = '/home/me/.claude/projects/repo/conv.jsonl';
      const parks = [
        caller.terminal.parkSession({ sessionId: 's1' }),
        caller.terminal.parkSession({ sessionId: 's1' }),
      ];

      await Promise.all(parks);

      expect(sent.filter((msg) => msg.t === 'kill')).toHaveLength(1);
    });

    it('[FR-TERMINAL-1075] should refuse to park with no daemon connected', async () => {
      addSession(state, 's1');
      state.terminalSessionMeta.get('s1')!.transcriptPath = '/home/me/conv.jsonl';

      await expect(caller.terminal.parkSession({ sessionId: 's1' })).rejects.toThrow(
        'No daemon connected',
      );
      expect(state.terminalSessionMeta.get('s1')?.dormant).toBeUndefined();
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
