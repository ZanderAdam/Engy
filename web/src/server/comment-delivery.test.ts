import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { appRouter } from './trpc/root';
import { setupTestDb, type TestContext } from './trpc/test-helpers';
import type { AppState } from './trpc/context';
import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { threadComments } from './db/schema';
import { replyToThread } from './services/comment';
import { applyActivityState } from './hooks/activity';
import { createDispatch, destroyTerminalSession } from './terminal-dispatch';
import { diffDocPath, diffScopePrefix } from '@/lib/diff-doc-path';

vi.mock('./ws/broadcast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ws/broadcast')>()),
  broadcastCommentLiveChange: vi.fn(),
  broadcastCommentChange: vi.fn(),
}));
const { broadcastCommentLiveChange, broadcastCommentChange } = await import('./ws/broadcast');

const SESSION = 'sess-1';
const DOC = { workspaceSlug: 'test-ws', documentPath: 'specs/auth/spec.md' };
const PASTE_START = '\x1b[200~';

function fakeDaemon(): { sent: string[]; ws: WebSocket } {
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => sent.push(data),
  } as unknown as WebSocket;
  return { sent, ws };
}

function addSession(state: AppState, sessionId: string, activityState: 'idle' | 'active' = 'idle') {
  state.terminalSessionMeta.set(sessionId, {
    scopeType: 'project',
    scopeLabel: 'label',
    workingDir: '/tmp',
    cols: 80,
    rows: 24,
    activityState,
  });
}

function block(text: string) {
  return [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }];
}

describe('comment delivery', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let sent: string[];

  function pastes(): string[] {
    return sent
      .map((s) => JSON.parse(s) as { d: string })
      .map((frame) => frame.d)
      .filter((d) => d.startsWith(PASTE_START));
  }

  async function docThread(threadId: string, text: string, exact?: string) {
    await caller.comment.createThread({
      ...DOC,
      threadId,
      initialComment: { id: `${threadId}-c1`, body: block(text) },
      metadata: exact ? { anchor: { exact } } : undefined,
    });
  }

  function setAuthor(commentId: string, userId: string) {
    getDb().update(threadComments).set({ userId }).where(eq(threadComments.id, commentId)).run();
  }

  async function reply(threadId: string, commentId: string, text: string) {
    await caller.comment.addComment({ ...DOC, threadId, commentId, body: block(text) });
  }

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    await caller.workspace.create({ name: 'Test WS' });
    const daemon = fakeDaemon();
    sent = daemon.sent;
    ctx.state.terminalDaemon = daemon.ws;
    addSession(ctx.state, SESSION);
    vi.mocked(broadcastCommentLiveChange).mockClear();
    vi.mocked(broadcastCommentChange).mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    ctx.cleanup();
  });

  describe('sendPending', () => {
    it('[FR-EDITOR-200] should send only comments not sent before, so open threads need no resolving', async () => {
      await docThread('t1', 'First note');
      expect(await caller.comment.sendPending({ scope: DOC, sessionId: SESSION })).toEqual({
        sent: 1,
      });

      await docThread('t2', 'Second note');
      expect(await caller.comment.sendPending({ scope: DOC, sessionId: SESSION })).toEqual({
        sent: 1,
      });

      const [, second] = pastes();
      expect(second).toContain('Second note');
      expect(second).not.toContain('First note');
    });

    it('[FR-EDITOR-200] should leave out resolved threads and agent replies but keep agent findings', async () => {
      await docThread('t1', 'Resolved note');
      await caller.comment.resolveThread({ ...DOC, threadId: 't1' });
      await docThread('t2', 'Open note');
      replyToThread({ threadId: 't2', text: 'Agent answer' });
      await docThread('t3', 'Agent finding');
      setAuthor('t3-c1', 'agent');

      const { text } = await caller.comment.pendingFeedback({ scope: DOC });

      expect(text).not.toContain('Resolved note');
      expect(text).not.toContain('Agent answer');
      expect(text).toContain('Open note');
      expect(text).toContain('Agent finding');
    });

    it('[FR-EDITOR-210] should send a reply with the thread root as context and author labels', async () => {
      await docThread('t1', 'Why this name?', 'Second line');
      await caller.comment.sendPending({ scope: DOC, sessionId: SESSION });
      replyToThread({ threadId: 't1', text: 'It matches the API' });
      await reply('t1', 't1-c3', 'Then rename the API too');

      await caller.comment.sendPending({
        scope: DOC,
        sessionId: SESSION,
        markdown: 'First line\nSecond line',
        filePath: 'specs/auth/spec.md',
      });

      const text = pastes()[1];
      expect(text).toContain('# Comments on specs/auth/spec.md');
      expect(text).toContain('Line 2: "Second line"');
      expect(text).toContain('`thread: t1`');
      expect(text).toContain('Earlier in this thread (already sent):\n> **user:** Why this name?');
      expect(text).toContain('New:\n> **user:** Then rename the API too');
      expect(text).not.toContain('It matches the API');
    });

    it('[FR-EDITOR-220] should send nothing and report zero when no comment is new', async () => {
      await docThread('t1', 'Only note');
      await caller.comment.sendPending({ scope: DOC, sessionId: SESSION });

      expect(await caller.comment.sendPending({ scope: DOC, sessionId: SESSION })).toEqual({
        sent: 0,
      });
      expect(pastes()).toHaveLength(1);
    });

    it('[FR-EDITOR-200] should tell browsers which threads changed when it marks comments sent', async () => {
      await docThread('t1', 'Note');
      await caller.comment.sendPending({ scope: DOC, sessionId: SESSION });

      expect(broadcastCommentChange).toHaveBeenCalledWith(DOC.documentPath, 't1');
    });

    it('[FR-EDITOR-230] should paste the feedback as one bracketed paste and submit it', async () => {
      await docThread('t1', 'Line one\nLine two');
      await caller.comment.sendPending({ scope: DOC, sessionId: SESSION });
      vi.runAllTimers();

      const frames = sent.map((s) => JSON.parse(s) as { d: string });
      expect(frames[0].d.startsWith(PASTE_START)).toBe(true);
      expect(frames[0].d.endsWith('\x1b[201~')).toBe(true);
      expect(frames.at(-1)!.d).toBe('\r');
    });

    it('[FR-EDITOR-230] should reject a session that is not running', async () => {
      await docThread('t1', 'Note');
      await expect(
        caller.comment.sendPending({ scope: DOC, sessionId: 'gone' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('[FR-EDITOR-230] should keep comments unsent when no daemon is connected', async () => {
      await docThread('t1', 'Note');
      ctx.state.terminalDaemon = null;

      await expect(
        caller.comment.sendPending({ scope: DOC, sessionId: SESSION }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect((await caller.comment.pendingFeedback({ scope: DOC })).commentIds).toEqual(['t1-c1']);
    });
  });

  describe('diff scope', () => {
    const REPO = '/repo';
    const BRANCH = 'feature/x';
    const scope = { documentPath: diffScopePrefix(REPO, BRANCH), prefix: true };

    async function diffThread(threadId: string, filePath: string, text: string) {
      await caller.comment.createThread({
        documentPath: diffDocPath(REPO, BRANCH, filePath),
        threadId,
        initialComment: { id: `${threadId}-c1`, body: text },
        metadata: { type: 'diff', lineNumber: 4, codeLine: 'const a = 1' },
      });
    }

    it('[FR-GIT-550] should send only unsent comments of the given threads in the branch scope', async () => {
      await diffThread('d1', 'src/a.ts', 'Rename a');
      await diffThread('d2', 'src/b.ts', 'Fix b');
      await diffThread('d3', 'src/c.ts', 'Off screen');
      await diffThread('d4', 'src/a.ts', 'Resolved one');
      await caller.comment.resolveThread({ threadId: 'd4' });

      await caller.comment.sendPending({
        scope,
        sessionId: SESSION,
        threadIds: ['d1', 'd2', 'd4'],
      });

      const text = pastes()[0];
      expect(text).toContain('## Code Review Feedback');
      expect(text).toContain('2 comments across 2 files');
      expect(text).toContain('### src/a.ts');
      expect(text).toContain('### src/b.ts');
      expect(text).toContain('> **user:** Rename a');
      expect(text).not.toContain('Off screen');
      expect(text).not.toContain('Resolved one');
      expect((await caller.comment.pendingFeedback({ scope })).commentIds).toEqual(['d3-c1']);
    });

    it('[FR-GIT-550] should not reach threads of a branch whose name only matches as a LIKE pattern', async () => {
      await caller.comment.createThread({
        documentPath: diffDocPath(REPO, 'fix_a', 'src/a.ts'),
        threadId: 'mine',
        initialComment: { id: 'mine-c1', body: 'Mine' },
      });
      await caller.comment.createThread({
        documentPath: diffDocPath(REPO, 'fixXa', 'src/a.ts'),
        threadId: 'other',
        initialComment: { id: 'other-c1', body: 'Other branch' },
      });

      const { commentIds } = await caller.comment.pendingFeedback({
        scope: { documentPath: diffScopePrefix(REPO, 'fix_a'), prefix: true },
      });

      expect(commentIds).toEqual(['mine-c1']);
    });

    it('[FR-EDITOR-240] should hold agent findings and synced comments until the user writes in their thread', async () => {
      addSession(ctx.state, SESSION, 'active');
      await caller.comment.setLive({ scope, sessionId: SESSION });
      await diffThread('f1', 'src/a.ts', 'Agent finding');
      setAuthor('f1-c1', 'agent');
      await diffThread('g1', 'src/b.ts', 'Synced note');
      setAuthor('g1-c1', 'octocat');

      applyActivityState(ctx.state, SESSION, 'idle', 'hook');
      expect(pastes()).toHaveLength(0);

      await caller.comment.addComment({
        threadId: 'f1',
        commentId: 'f1-c2',
        body: 'Agree, fix it',
      });

      expect(pastes()).toHaveLength(1);
      expect(pastes()[0]).toContain('> **agent:** Agent finding');
      expect(pastes()[0]).toContain('> **user:** Agree, fix it');
      expect(pastes()[0]).not.toContain('Synced note');
    });
  });

  describe('pendingFeedback + markSent', () => {
    it('[FR-EDITOR-200] should mark only the comments a runner send delivered', async () => {
      await docThread('t1', 'Note');
      const { commentIds } = await caller.comment.pendingFeedback({ scope: DOC });
      await docThread('t2', 'Later note');

      await caller.comment.markSent({ commentIds });

      expect((await caller.comment.pendingFeedback({ scope: DOC })).commentIds).toEqual(['t2-c1']);
    });
  });

  describe('live mode', () => {
    it('[FR-EDITOR-240] should push a new comment to an idle pinned terminal at once', async () => {
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await docThread('t1', 'Live note');

      expect(pastes()).toHaveLength(1);
      expect(pastes()[0]).toContain('Live note');
    });

    it('[FR-EDITOR-240] should push a reply in an existing thread', async () => {
      await docThread('t1', 'Root');
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await reply('t1', 't1-c2', 'Follow-up');

      expect(pastes()[1]).toContain('New:\n> **user:** Follow-up');
    });

    it('[FR-EDITOR-240] should hold comments while the agent is busy and send them on idle', async () => {
      addSession(ctx.state, SESSION, 'active');
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await docThread('t1', 'One');
      await docThread('t2', 'Two');
      expect(pastes()).toHaveLength(0);

      applyActivityState(ctx.state, SESSION, 'idle', 'hook');

      expect(pastes()).toHaveLength(1);
      expect(pastes()[0]).toContain('One');
      expect(pastes()[0]).toContain('Two');
    });

    it('[FR-EDITOR-240] should let a queued dispatch go first on idle', async () => {
      addSession(ctx.state, SESSION, 'active');
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      createDispatch(ctx.state, SESSION, 'Dispatched work');
      await docThread('t1', 'Held note');

      applyActivityState(ctx.state, SESSION, 'idle', 'hook');
      expect(pastes()).toHaveLength(1);
      expect(pastes()[0]).toContain('Dispatched work');

      applyActivityState(ctx.state, SESSION, 'active', 'hook');
      applyActivityState(ctx.state, SESSION, 'idle', 'hook');
      expect(pastes()[1]).toContain('Held note');
    });

    it('[FR-EDITOR-240] should paste for only one live scope per idle transition', async () => {
      const other = { workspaceSlug: 'test-ws', documentPath: 'specs/other.md' };
      addSession(ctx.state, SESSION, 'active');
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await caller.comment.setLive({ scope: other, sessionId: SESSION });
      await docThread('t1', 'Doc note');
      await caller.comment.createThread({
        ...other,
        threadId: 'o1',
        initialComment: { id: 'o1-c1', body: block('Other note') },
      });

      applyActivityState(ctx.state, SESSION, 'idle', 'hook');
      expect(pastes()).toHaveLength(1);

      applyActivityState(ctx.state, SESSION, 'active', 'hook');
      applyActivityState(ctx.state, SESSION, 'idle', 'hook');
      expect(pastes()).toHaveLength(2);
    });

    it('[FR-EDITOR-240] should not push comments outside the live scope', async () => {
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await caller.comment.createThread({
        workspaceSlug: 'test-ws',
        documentPath: 'specs/other.md',
        threadId: 'o1',
        initialComment: { id: 'o1-c1', body: block('Elsewhere') },
      });

      expect(pastes()).toHaveLength(0);
    });

    it('[FR-EDITOR-260] should send waiting comments when turned on and report the pinned session', async () => {
      await docThread('t1', 'Before live');

      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });

      expect(pastes()[0]).toContain('Before live');
      expect(await caller.comment.liveTarget(DOC)).toEqual({ sessionId: SESSION });
      expect(broadcastCommentLiveChange).toHaveBeenCalledWith(expect.any(String), SESSION);
    });

    it('[FR-EDITOR-260] should stop pushing once turned off', async () => {
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });
      await caller.comment.setLive({ scope: DOC, sessionId: null });
      await docThread('t1', 'After off');

      expect(pastes()).toHaveLength(0);
      expect(await caller.comment.liveTarget(DOC)).toEqual({ sessionId: null });
    });

    it('[FR-EDITOR-260] should refuse to pin a session that is not running', async () => {
      await expect(caller.comment.setLive({ scope: DOC, sessionId: 'gone' })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });

    it('[FR-EDITOR-250] should turn live mode off when the pinned session ends', async () => {
      await caller.comment.setLive({ scope: DOC, sessionId: SESSION });

      destroyTerminalSession(ctx.state, SESSION);

      expect(await caller.comment.liveTarget(DOC)).toEqual({ sessionId: null });
      expect(broadcastCommentLiveChange).toHaveBeenCalledWith(
        expect.any(String),
        null,
        'session-ended',
      );
    });
  });
});
