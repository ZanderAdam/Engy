import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommentTools } from './comment-tools';
import { appRouter } from '../trpc/root';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';

// Mirrors index.test.ts's harness: invoke a registered tool handler directly,
// applying the tool's zod schema (defaults included) like the SDK would.
function callTool(mcp: McpServer, name: string) {
  const tools = (mcp as unknown as { _registeredTools: Record<string, { inputSchema?: { safeParse?: (p: unknown) => { success: boolean; data: unknown } }; handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> })._registeredTools;
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

const REPO = '/Users/me/repo';
const DIFF_PATH = `diff://${REPO}/src/app.ts`;

describe('comment MCP tools', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let mcp: McpServer;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    await caller.workspace.create({ name: 'Test WS' });
    mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerCommentTools(mcp);
    await caller.comment.createThread({
      workspaceSlug: 'test-ws',
      documentPath: DIFF_PATH,
      threadId: 'thread-1',
      initialComment: { id: 'c1', body: 'Add error handling' },
      metadata: { type: 'diff', source: 'local', lineNumber: 10, codeLine: 'const x = foo()' },
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('[FR-MCP-210] replyToComment', () => {
    it('[FR-MCP-210] should append an agent-attributed reply to the thread', async () => {
      const { data, isError } = await callTool(mcp, 'replyToComment')({
        threadId: 'thread-1',
        body: 'Added a guard clause.',
      });

      expect(isError).toBe(false);
      expect(data.threadId).toBe('thread-1');
      expect(data.kind).toBe('diff');
      expect(data.documentPath).toBe(DIFF_PATH);

      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: DIFF_PATH,
      });
      expect(threads[0].comments).toHaveLength(2);
      expect(threads[0].comments[1].body).toBe('Added a guard clause.');
      expect(threads[0].comments[1].userId).toBe('agent');
    });

    it('[FR-MCP-210] should resolve the thread when asked', async () => {
      const { data } = await callTool(mcp, 'replyToComment')({
        threadId: 'thread-1',
        body: 'Fixed.',
        resolve: true,
      });

      expect(data.resolved).toBe(true);
      const threads = await caller.comment.listThreads({
        workspaceSlug: 'test-ws',
        documentPath: DIFF_PATH,
      });
      expect(threads[0].resolved).toBe(true);
    });

    it('[FR-MCP-210] should return a tool error for an unknown thread id', async () => {
      const { data, isError } = await callTool(mcp, 'replyToComment')({
        threadId: 'no-such-thread',
        body: 'Hello?',
      });

      expect(isError).toBe(true);
      expect(data.error).toMatch(/not found/i);
    });
  });
});
