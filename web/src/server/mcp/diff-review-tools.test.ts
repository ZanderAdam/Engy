import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDiffReviewTools } from './diff-review-tools';
import { getAppState } from '../trpc/context';
import { getDb } from '../db/client';
import { commentThreads, threadComments } from '../db/schema';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { appRouter } from '../trpc/root';

// Mirrors terminal-tools.test.ts: invoke a registered tool handler directly,
// applying the tool's zod schema (defaults included) like the SDK would.
function callTool(mcp: McpServer, name: string) {
  const tools = (
    mcp as unknown as {
      _registeredTools: Record<
        string,
        {
          inputSchema?: { safeParse?: (p: unknown) => { success: boolean; data: unknown } };
          handler: (
            args: unknown,
            extra: unknown,
          ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
        }
      >;
    }
  )._registeredTools;
  return async (params: Record<string, unknown> = {}) => {
    const tool = tools[name];
    const parsed = tool.inputSchema?.safeParse?.(params);
    const args = parsed?.success ? parsed.data : params;
    const result = await tool.handler(args, {});
    return {
      data: JSON.parse(result.content[0].text) as Record<string, unknown>,
      isError: result.isError === true,
    };
  };
}

function makeMcp(callerTerminalSessionId?: string): McpServer {
  const mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerDiffReviewTools(mcp, callerTerminalSessionId);
  return mcp;
}

const REPO = '/home/dev/proj';

/** The exact query the Diffs tab runs — threads invisible to it do not exist. */
function readAsDiffsTabWould(repoDir: string) {
  return appRouter
    .createCaller({ state: getAppState() } as never)
    .comment.listThreadsByPrefix({ documentPathPrefix: `diff://${repoDir}/` });
}

describe('diff review MCP tools', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('diff_review_comment', () => {
    it('[FR-MCP-220] anchors a finding where the diff viewer reads it', async () => {
      const mcp = makeMcp();
      const res = await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/auth.ts',
        lineNumber: 42,
        codeLine: '  const token = req.query.t;',
        severity: 'critical',
        finding: 'Token read from the query string',
        failureScenario: 'A shared URL leaks the session token to referrer logs.',
        suggestedFix: 'Read the token from the Authorization header.',
      });

      expect(res.isError).toBe(false);

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads).toHaveLength(1);
      const thread = threads[0];
      expect(thread.documentPath).toBe(`diff://${REPO}/src/auth.ts`);
      expect(thread.metadata).toMatchObject({
        type: 'diff',
        source: 'agent',
        lineNumber: 42,
        codeLine: '  const token = req.query.t;',
        side: 'modified',
        severity: 'critical',
      });
      expect(res.data.threadId).toBe(thread.id);
    });

    it('[FR-MCP-220] writes workspace-less threads so the slug-less viewer query finds them', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
      });

      const row = getDb().select().from(commentThreads).all()[0];
      expect(row.workspaceId).toBeNull();
    });

    it('[FR-MCP-220] composes the finding, failure scenario and fix into the comment body', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 7,
        codeLine: 'x',
        severity: 'high',
        finding: 'Off-by-one on the last page',
        failureScenario: 'offset=100, total=100 returns an empty page instead of the last row.',
        suggestedFix: 'Use >= instead of >.',
      });

      const body = getDb().select().from(threadComments).all()[0].body as string;
      expect(body).toContain('Off-by-one on the last page');
      expect(body).toContain('offset=100, total=100');
      expect(body).toContain('Use >= instead of >.');
    });

    it('[FR-MCP-220] carries the evidence rung when the finding earned one', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'critical',
        finding: 'f',
        failureScenario: 's',
        evidence: 'rung 4: src/a.test.ts:12 reproduces it',
      });

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads[0].metadata).toMatchObject({
        evidence: 'rung 4: src/a.test.ts:12 reproduces it',
      });
    });

    it('[FR-MCP-220] omits evidence entirely for a finding that only asserts', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'medium',
        finding: 'f',
        failureScenario: 's',
      });

      const meta = (await readAsDiffsTabWould(REPO))[0].metadata as Record<string, unknown>;
      expect(meta.evidence).toBeUndefined();
    });

    it('[FR-MCP-220] records a deleted line against the original side', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 3,
        codeLine: 'removed()',
        side: 'original',
        severity: 'medium',
        finding: 'f',
        failureScenario: 's',
      });

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads[0].metadata).toMatchObject({ side: 'original' });
    });

    it('[FR-MCP-230] attributes the finding to the calling terminal session', async () => {
      getAppState().terminalSessionMeta.set('sess-1', {
        scopeType: 'project',
        scopeLabel: 'initial',
        workingDir: REPO,
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });

      const mcp = makeMcp('sess-1');
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
      });

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads[0].metadata).toMatchObject({
        source: 'agent',
        agentSessionId: 'sess-1',
        agentType: 'claude',
      });
    });

    it('[FR-MCP-230] still marks an anonymous caller as agent-authored', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
      });

      const threads = await readAsDiffsTabWould(REPO);
      const meta = threads[0].metadata as Record<string, unknown>;
      expect(meta.source).toBe('agent');
      expect(meta.agentSessionId).toBeUndefined();
    });

    it('[FR-MCP-230] ignores a caller-supplied source, keeping the discriminator trustworthy', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
        source: 'local',
      });

      const threads = await readAsDiffsTabWould(REPO);
      expect((threads[0].metadata as Record<string, unknown>).source).toBe('agent');
    });
  });

  describe('diff_review_resolve', () => {
    async function fileFinding(mcp: ReturnType<typeof makeMcp>) {
      const res = await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
      });
      return res.data.threadId as string;
    }

    it('[FR-MCP-260] resolves a finding the agent itself filed', async () => {
      const mcp = makeMcp();
      const threadId = await fileFinding(mcp);

      const res = await callTool(mcp, 'diff_review_resolve')({ threadId });
      expect(res.isError).toBe(false);

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads[0].resolved).toBe(true);
    });

    it("[FR-MCP-260] refuses to close a human's comment", async () => {
      await appRouter.createCaller({ state: getAppState() } as never).comment.createThread({
        documentPath: `diff://${REPO}/src/a.ts`,
        threadId: 'human-thread',
        initialComment: { id: 'c1', body: 'why this way?' },
        metadata: { type: 'diff', source: 'local', lineNumber: 5, codeLine: 'x', side: 'modified' },
      });

      const res = await callTool(makeMcp(), 'diff_review_resolve')({ threadId: 'human-thread' });
      expect(res.isError).toBe(true);

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads[0].resolved).toBe(false);
    });

    it('[FR-MCP-260] reports an unknown thread rather than failing silently', async () => {
      const res = await callTool(makeMcp(), 'diff_review_resolve')({ threadId: 'nope' });
      expect(res.isError).toBe(true);
      expect(String(res.data.error)).toContain('nope');
    });
  });

  describe('diff_review_summary', () => {
    it('[FR-MCP-240] writes one unanchored summary the prefix query returns', async () => {
      const mcp = makeMcp();
      const res = await callTool(mcp, 'diff_review_summary')({
        repoDir: REPO,
        summary: '## Reading order\n\n1. src/auth.ts',
      });

      expect(res.isError).toBe(false);

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads).toHaveLength(1);
      expect(threads[0].documentPath).toBe(`diff://${REPO}/`);
      expect(threads[0].metadata).toMatchObject({ type: 'review-summary', source: 'agent' });
    });

    it('[FR-MCP-240] replaces the previous summary instead of stacking them', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_summary')({ repoDir: REPO, summary: 'first' });
      await callTool(mcp, 'diff_review_summary')({ repoDir: REPO, summary: 'second' });

      const threads = await readAsDiffsTabWould(REPO);
      const summaries = threads.filter(
        (t) => (t.metadata as Record<string, unknown>).type === 'review-summary',
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0].comments[0].body).toBe('second');
    });

    it('[FR-MCP-240] leaves anchored findings untouched when the summary is rewritten', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 1,
        codeLine: 'x',
        severity: 'high',
        finding: 'f',
        failureScenario: 's',
      });
      await callTool(mcp, 'diff_review_summary')({ repoDir: REPO, summary: 'again' });

      const threads = await readAsDiffsTabWould(REPO);
      expect(threads).toHaveLength(2);
    });
  });

  describe('diff_review_list', () => {
    it('[FR-MCP-250] lists existing findings so a re-review does not re-file them', async () => {
      const mcp = makeMcp();
      await callTool(mcp, 'diff_review_comment')({
        repoDir: REPO,
        filePath: 'src/a.ts',
        lineNumber: 10,
        codeLine: 'x',
        severity: 'critical',
        finding: 'boom',
        failureScenario: 's',
      });
      await callTool(mcp, 'diff_review_summary')({ repoDir: REPO, summary: 'sum' });

      const res = await callTool(mcp, 'diff_review_list')({ repoDir: REPO });
      const threads = res.data.threads as Array<Record<string, unknown>>;

      expect(threads).toHaveLength(2);
      const finding = threads.find((t) => t.type === 'diff');
      expect(finding).toMatchObject({
        filePath: 'src/a.ts',
        lineNumber: 10,
        severity: 'critical',
        source: 'agent',
        resolved: false,
      });
      expect(res.data.summary).toBe('sum');
    });

    it('[FR-MCP-250] scopes to one file when filePath is given', async () => {
      const mcp = makeMcp();
      for (const filePath of ['src/a.ts', 'src/b.ts']) {
        await callTool(mcp, 'diff_review_comment')({
          repoDir: REPO,
          filePath,
          lineNumber: 1,
          codeLine: 'x',
          severity: 'high',
          finding: 'f',
          failureScenario: 's',
        });
      }

      const res = await callTool(mcp, 'diff_review_list')({ repoDir: REPO, filePath: 'src/b.ts' });
      const threads = res.data.threads as Array<Record<string, unknown>>;
      expect(threads).toHaveLength(1);
      expect(threads[0].filePath).toBe('src/b.ts');
    });

    it('[FR-MCP-250] does not pair a file with one whose name extends it', async () => {
      const mcp = makeMcp();
      for (const file of ['Foo.ts', 'Foo.tsx']) {
        await callTool(mcp, 'diff_review_comment')({
          repoDir: REPO,
          filePath: file,
          lineNumber: 1,
          codeLine: 'x',
          severity: 'high',
          finding: 'f',
          failureScenario: 's',
        });
      }

      const res = await callTool(mcp, 'diff_review_list')({ repoDir: REPO, filePath: 'Foo.ts' });
      const threads = res.data.threads as Array<Record<string, unknown>>;
      expect(threads).toHaveLength(1);
      expect(threads[0].filePath).toBe('Foo.ts');
    });

    it("[FR-MCP-250] reports the user's own threads so the agent can answer them", async () => {
      await appRouter
        .createCaller({ state: getAppState() } as never)
        .comment.createThread({
          documentPath: `diff://${REPO}/src/a.ts`,
          threadId: 'user-thread',
          initialComment: { id: 'c1', body: 'why this way?' },
          metadata: { type: 'diff', source: 'local', lineNumber: 5, codeLine: 'x', side: 'modified' },
        });

      const res = await callTool(makeMcp(), 'diff_review_list')({ repoDir: REPO });
      const threads = res.data.threads as Array<Record<string, unknown>>;
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({ source: 'local', threadId: 'user-thread' });
    });

    it('[FR-MCP-250] returns an empty list for a repo with no review', async () => {
      const res = await callTool(makeMcp(), 'diff_review_list')({ repoDir: '/other/repo' });
      expect(res.data.threads).toEqual([]);
      expect(res.data.summary).toBeNull();
    });
  });
});
