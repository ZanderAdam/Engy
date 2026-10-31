import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, type TestContext } from './trpc/test-helpers';
import { projects, workspaces } from './db/schema';
import { dispatchGitBranch } from './ws/server';
import { resolveSpawnTarget } from './terminal-spawn-scope';

vi.mock('./ws/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ws/server')>()),
  dispatchGitBranch: vi.fn(),
}));

describe('resolveSpawnTarget', () => {
  let ctx: TestContext;
  let worktreesRoot: string;

  beforeEach(() => {
    ctx = setupTestDb();
    const workspace = ctx.db
      .insert(workspaces)
      .values({ name: 'WS', slug: 'ws', repos: ['/repos/app'] })
      .returning()
      .get();
    ctx.db.insert(projects).values({ workspaceId: workspace.id, name: 'P', slug: 'proj' }).run();
    worktreesRoot = path.join(ctx.tmpDir, 'ws', 'worktrees');
    vi.mocked(dispatchGitBranch).mockReset();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('[FR-MCP-170] should give a workspace repo cwd the workspace scope', async () => {
    const target = await resolveSpawnTarget('/repos/app/.claude/worktrees/x', ctx.state);

    expect(target?.workspace.slug).toBe('ws');
    expect(target?.scope).toEqual({
      scopeType: 'workspace',
      groupKey: 'workspace:ws',
      workspaceSlug: 'ws',
    });
    expect(dispatchGitBranch).not.toHaveBeenCalled();
  });

  it('[FR-MCP-170] should give a project worktree cwd the project scope with the branch from the daemon', async () => {
    vi.mocked(dispatchGitBranch).mockResolvedValue({ branch: 'feat/x', repoRoot: null });
    const cwd = path.join(worktreesRoot, 'proj', 'feat-x', 'app');

    const target = await resolveSpawnTarget(cwd, ctx.state);

    expect(target?.scope).toMatchObject({
      scopeType: 'project',
      groupKey: 'project:ws:proj:wt:feat/x',
      workspaceSlug: 'ws',
      projectSlug: 'proj',
      worktreeBranch: 'feat/x',
    });
  });

  it('[FR-MCP-170] should fall back to the project group when the daemon cannot name the branch', async () => {
    vi.mocked(dispatchGitBranch).mockRejectedValue(new Error('No daemon connected'));

    const target = await resolveSpawnTarget(path.join(worktreesRoot, 'proj', 'x', 'app'), ctx.state);

    expect(target?.scope).toMatchObject({ groupKey: 'project:ws:proj', worktreeBranch: undefined });
  });

  it('[FR-MCP-160] should resolve nothing for a directory no workspace owns, review worktrees included', async () => {
    expect(await resolveSpawnTarget('/elsewhere', ctx.state)).toBeNull();
    expect(
      await resolveSpawnTarget(path.join(worktreesRoot, '_review', 'app', 'pr-1'), ctx.state),
    ).toBeNull();
  });
});
