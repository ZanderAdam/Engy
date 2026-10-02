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
      replyToThread({ threadId: 'doc-thread', text: 'First line\n\nSecond line' });

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
  });

  describe('[FR-EDITOR-160] markdown doc bodies', () => {
    const docThread = { documentPath: 'docs/a.md', metadata: null };

    it('[FR-EDITOR-160] should split blank-line separated text into paragraphs and keep line breaks', () => {
      expect(textToBody(docThread, 'a\nb\n\nc')).toEqual([
        { type: 'paragraph', content: [{ type: 'text', text: 'a\nb', styles: {} }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'c', styles: {} }] },
      ]);
    });

    it('[FR-EDITOR-160] should turn inline markdown into styled text and links', () => {
      expect(textToBody(docThread, '**bold** *it* `code` ~~gone~~ [docs](https://x.dev)')).toEqual([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', styles: { bold: true } },
            { type: 'text', text: ' ', styles: {} },
            { type: 'text', text: 'it', styles: { italic: true } },
            { type: 'text', text: ' ', styles: {} },
            { type: 'text', text: 'code', styles: { code: true } },
            { type: 'text', text: ' ', styles: {} },
            { type: 'text', text: 'gone', styles: { strike: true } },
            { type: 'text', text: ' ', styles: {} },
            {
              type: 'link',
              href: 'https://x.dev',
              content: [{ type: 'text', text: 'docs', styles: {} }],
            },
          ],
        },
      ]);
    });

    it('[FR-EDITOR-160] should turn lists into nested list item blocks', () => {
      expect(textToBody(docThread, '- one\n  - inner\n1. first\n\n- [x] done')).toEqual([
        {
          type: 'bulletListItem',
          content: [{ type: 'text', text: 'one', styles: {} }],
          children: [
            {
              type: 'bulletListItem',
              content: [{ type: 'text', text: 'inner', styles: {} }],
              children: [],
            },
          ],
        },
        {
          type: 'numberedListItem',
          content: [{ type: 'text', text: 'first', styles: {} }],
          children: [],
        },
        {
          type: 'checkListItem',
          props: { checked: true },
          content: [{ type: 'text', text: 'done', styles: {} }],
          children: [],
        },
      ]);
    });

    it('[FR-EDITOR-160] should never return an empty block array', () => {
      expect(textToBody(docThread, '   ')).toEqual([{ type: 'paragraph', content: [] }]);
      expect(textToBody(docThread, '---')).toEqual([
        { type: 'paragraph', content: [{ type: 'text', text: '---', styles: {} }] },
      ]);
    });

    it('[FR-EDITOR-160] should keep separators when flattening tables and lists in quotes', () => {
      expect(textToBody(docThread, '| a | b |\n| - | - |\n| 1 | 2 |\n\n> - x\n> - y')).toEqual([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', styles: {} },
            { type: 'text', text: ' | ', styles: {} },
            { type: 'text', text: 'b', styles: {} },
            { type: 'text', text: '\n', styles: {} },
            { type: 'text', text: '1', styles: {} },
            { type: 'text', text: ' | ', styles: {} },
            { type: 'text', text: '2', styles: {} },
          ],
        },
        {
          type: 'quote',
          content: [
            { type: 'text', text: 'x', styles: {} },
            { type: 'text', text: '\n', styles: {} },
            { type: 'text', text: 'y', styles: {} },
          ],
        },
      ]);
    });

    it('[FR-EDITOR-160] should keep image alt text as a link', () => {
      expect(textToBody(docThread, '![shot](https://x.dev/a.png)')).toEqual([
        {
          type: 'paragraph',
          content: [
            {
              type: 'link',
              href: 'https://x.dev/a.png',
              content: [{ type: 'text', text: 'shot', styles: {} }],
            },
          ],
        },
      ]);
    });

    it('[FR-EDITOR-160] should turn headings, code fences and quotes into their blocks', () => {
      expect(
        textToBody(
          docThread,
          '#### Title\n\n```ts\nconst a = 1;\n```\n\n```\nplain\n```\n\n> quoted',
        ),
      ).toEqual([
        {
          type: 'heading',
          props: { level: 4 },
          content: [{ type: 'text', text: 'Title', styles: {} }],
        },
        {
          type: 'codeBlock',
          props: { language: 'ts' },
          content: [{ type: 'text', text: 'const a = 1;', styles: {} }],
        },
        { type: 'codeBlock', props: {}, content: [{ type: 'text', text: 'plain', styles: {} }] },
        { type: 'quote', content: [{ type: 'text', text: 'quoted', styles: {} }] },
      ]);
    });
  });
});
