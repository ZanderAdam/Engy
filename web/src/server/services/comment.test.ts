import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../trpc/root';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { replyToThread, addComment, textToBody, isDiffThread } from './comment';

const REPO = '/Users/me/repo';

describe('comment service', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    await caller.workspace.create({ name: 'Test WS' });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  async function makeDiffThread(threadId = 'diff-thread') {
    return caller.comment.createThread({
      workspaceSlug: 'test-ws',
      documentPath: `diff://${REPO}/src/app.ts`,
      threadId,
      initialComment: { id: `${threadId}-c1`, body: 'Add error handling' },
      metadata: { type: 'diff', source: 'local', lineNumber: 10, codeLine: 'const x = foo()' },
    });
  }

  async function makeDocThread(threadId = 'doc-thread') {
    return caller.comment.createThread({
      workspaceSlug: 'test-ws',
      documentPath: 'specs/auth/spec.md',
      threadId,
      initialComment: {
        id: `${threadId}-c1`,
        body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Needs detail' }] }],
      },
    });
  }

  describe('[FR-EDITOR-160] replyToThread', () => {
    it('[FR-EDITOR-160] should reject an unknown thread id', async () => {
      await makeDiffThread();
      expect(() => replyToThread({ threadId: 'no-such-thread', text: 'hi' })).toThrow(
        /not found/i,
      );
    });

    it('[FR-EDITOR-160] should attribute the reply to the agent, not the user', async () => {
      await makeDiffThread();
      replyToThread({ threadId: 'diff-thread', text: 'Done — added a guard.' });

      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: `diff://${REPO}/src/app.ts`,
      });
      const reply = threads[0].comments[1];
      expect(reply.userId).toBe('agent');
      expect(threads[0].comments[0].userId).toBe('local-user');
    });

    it('[FR-EDITOR-160] should store a plain string body on a diff thread', async () => {
      await makeDiffThread();
      replyToThread({ threadId: 'diff-thread', text: 'Fixed.' });

      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: `diff://${REPO}/src/app.ts`,
      });
      expect(threads[0].comments[1].body).toBe('Fixed.');
    });

    it('[FR-EDITOR-160] should store a BlockNote block array on a doc thread', async () => {
      await makeDocThread();
      replyToThread({ threadId: 'doc-thread', text: 'First line\nSecond line' });

      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: 'specs/auth/spec.md',
      });
      expect(threads[0].comments[1].body).toEqual([
        { type: 'paragraph', content: [{ type: 'text', text: 'First line', styles: {} }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line', styles: {} }] },
      ]);
    });

    it('[FR-EDITOR-160] should leave the thread open by default', async () => {
      await makeDiffThread();
      const result = replyToThread({ threadId: 'diff-thread', text: 'Looking into it.' });

      expect(result.resolved).toBe(false);
      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: `diff://${REPO}/src/app.ts`,
      });
      expect(threads[0].resolved).toBe(false);
    });

    it('[FR-EDITOR-160] should resolve the thread when asked, crediting the agent', async () => {
      await makeDiffThread();
      replyToThread({ threadId: 'diff-thread', text: 'Fixed.', resolve: true });

      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: `diff://${REPO}/src/app.ts`,
      });
      expect(threads[0].resolved).toBe(true);
      expect(threads[0].resolvedBy).toBe('agent');
    });

    it('[FR-EDITOR-160] should report the thread kind and document it answered', async () => {
      await makeDocThread();
      const result = replyToThread({ threadId: 'doc-thread', text: 'ok' });

      expect(result.kind).toBe('doc');
      expect(result.documentPath).toBe('specs/auth/spec.md');
      expect(result.threadId).toBe('doc-thread');
    });
  });

  describe('[FR-EDITOR-160] addComment', () => {
    it('[FR-EDITOR-160] should reject an unknown thread id', () => {
      expect(() =>
        addComment({ threadId: 'ghost', commentId: 'c9', body: 'orphan' }),
      ).toThrow(/not found/i);
    });

    it('[FR-EDITOR-160] should default attribution to the local user', async () => {
      await makeDiffThread();
      const comment = addComment({ threadId: 'diff-thread', commentId: 'c2', body: 'mine' });
      expect(comment.userId).toBe('local-user');
    });
  });

  describe('[FR-EDITOR-160] thread kind detection', () => {
    it('[FR-EDITOR-160] should treat a diff:// path as a diff thread without metadata', () => {
      expect(isDiffThread({ documentPath: `diff://${REPO}/a.ts`, metadata: null })).toBe(true);
      expect(isDiffThread({ documentPath: 'docs/a.md', metadata: null })).toBe(false);
    });

    it('[FR-EDITOR-160] should treat metadata.type "diff" as a diff thread', () => {
      expect(isDiffThread({ documentPath: 'docs/a.md', metadata: { type: 'diff' } })).toBe(true);
    });

    it('[FR-EDITOR-160] should keep blank lines as empty paragraphs in a doc body', () => {
      const body = textToBody({ documentPath: 'docs/a.md', metadata: null }, 'a\n\nb');
      expect(body).toEqual([
        { type: 'paragraph', content: [{ type: 'text', text: 'a', styles: {} }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b', styles: {} }] },
      ]);
    });
  });
});
