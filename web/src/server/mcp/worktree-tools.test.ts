import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWorktreeTools } from './worktree-tools';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { workspaces } from '../db/schema';
import { dispatchGitWorktreeList } from '../ws/server';

vi.mock('../ws/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ws/server')>()),
  dispatchGitWorktreeList: vi.fn(),
}));

async function callWorktreeList(params: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerWorktreeTools(mcp);
  const tools = (mcp as unknown as {
    _registeredTools: Record<
      string,
      { handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }
    >;
  })._registeredTools;
  const result = await tools.worktree_list.handler(params, {});
  return {
    data: JSON.parse(result.content[0].text) as Record<string, unknown>,
    isError: result.isError === true,
  };
}

describe('MCP worktree tools', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
    ctx.db.insert(workspaces).values({ name: 'A', slug: 'a', repos: ['/repos/app'] }).run();
    ctx.db.insert(workspaces).values({ name: 'B', slug: 'b', repos: ['/repos/lib'] }).run();
    vi.mocked(dispatchGitWorktreeList).mockReset();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('worktree_list', () => {
    it('[FR-MCP-330] should list worktrees of every workspace repo with the live agent terminals inside them', async () => {
      vi.mocked(dispatchGitWorktreeList).mockImplementation(async (repoDir: string) => ({
        worktrees:
          repoDir === '/repos/app'
            ? [
                { path: '/repos/app', branch: 'main', isMain: true, isLocked: false },
                { path: '/repos/app-wt/feat', branch: 'feat/x', isMain: false, isLocked: false },
              ]
            : [{ path: '/repos/lib', branch: 'main', isMain: true, isLocked: false }],
      }));
      ctx.state.terminalSessionMeta.set('t1', {
        scopeType: 'project',
        scopeLabel: 'x',
        workingDir: '/repos/app-wt/feat/src',
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });
      ctx.state.terminalSessionMeta.set('shell', {
        scopeType: 'project',
        scopeLabel: 'sh',
        workingDir: '/repos/app-wt/feat',
        cols: 80,
        rows: 24,
      });

      const { data, isError } = await callWorktreeList();

      expect(isError).toBe(false);
      const rows = data.worktrees as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.branch === 'feat/x')).toMatchObject({
        workspaceSlug: 'a',
        repoPath: '/repos/app',
        path: '/repos/app-wt/feat',
        isMain: false,
        terminals: ['t1'],
      });
      expect(rows.find((r) => r.path === '/repos/app')?.terminals).toEqual([]);
    });

    it('[FR-MCP-330] should list a terminal only under the deepest worktree that contains it', async () => {
      vi.mocked(dispatchGitWorktreeList).mockResolvedValue({
        worktrees: [
          { path: '/repos/app', branch: 'main', isMain: true, isLocked: false },
          { path: '/repos/app/.claude/worktrees/feat', branch: 'feat', isMain: false, isLocked: false },
        ],
      });
      ctx.state.terminalSessionMeta.set('t1', {
        scopeType: 'project',
        scopeLabel: 'x',
        workingDir: '/repos/app/.claude/worktrees/feat/src',
        agentType: 'claude',
        cols: 80,
        rows: 24,
      });

      const { data } = await callWorktreeList({ workspaceSlug: 'a' });

      const rows = data.worktrees as Array<{ path: string; terminals: string[] }>;
      expect(rows.find((row) => row.path === '/repos/app')?.terminals).toEqual([]);
      expect(rows.find((row) => row.path.endsWith('/feat'))?.terminals).toEqual(['t1']);
    });

    it('[FR-MCP-330] should limit the list to one workspace and refuse an unknown one', async () => {
      vi.mocked(dispatchGitWorktreeList).mockResolvedValue({ worktrees: [] });
      await callWorktreeList({ workspaceSlug: 'b' });
      expect(dispatchGitWorktreeList).toHaveBeenCalledTimes(1);
      expect(vi.mocked(dispatchGitWorktreeList).mock.calls[0][0]).toBe('/repos/lib');

      const unknown = await callWorktreeList({ workspaceSlug: 'nope' });
      expect(unknown.isError).toBe(true);
    });

    it('[FR-MCP-330] should report a repo the daemon cannot read in errors and keep the rest', async () => {
      vi.mocked(dispatchGitWorktreeList).mockImplementation(async (repoDir: string) => {
        if (repoDir === '/repos/app') throw new Error('No daemon connected');
        return { worktrees: [{ path: '/repos/lib', branch: 'main', isMain: true, isLocked: false }] };
      });

      const { data } = await callWorktreeList();

      expect(data.worktrees).toHaveLength(1);
      expect(data.errors).toEqual([{ repoPath: '/repos/app', message: 'No daemon connected' }]);
    });
  });
});
