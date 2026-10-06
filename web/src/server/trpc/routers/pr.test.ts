import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { workspaces, prs, agentSessions, taskGroups, tasks, projects } from '../../db/schema';
import { upsertPrs, findCorrelatedSession } from './pr';
import { startStubGithub, type StubGithub } from '../../github/stub-server';
import {
  makePr,
  rawPr,
  searchReply,
  searchQuery,
  type RawPrFixture,
} from '../../github/pr-fixtures';
import { eq } from 'drizzle-orm';

// ── Fixtures ─────────────────────────────────────────────────────────

// ── GitHub stub ───────────────────────────────────────────────────────

function replyWithOpenPrs(stub: StubGithub, nodes: RawPrFixture[]): void {
  stub.reply((request) => searchReply(searchQuery(request).includes('author:@me') ? nodes : []));
}

function linkRepo(ctx: TestContext, repoPath: string, fullName: string | null): void {
  ctx.state.repoFullNames.set(repoPath, fullName);
}

// ── Helpers ───────────────────────────────────────────────────────────

function seedWorkspace(ctx: TestContext, repos: string[]) {
  ctx.db.insert(workspaces).values({ name: 'WS', slug: 'ws', repos }).run();
  return ctx.db.select().from(workspaces).where(eq(workspaces.slug, 'ws')).get()!;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('pr router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let stub: StubGithub;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    ctx.state.github.status = { available: true, login: 'me' };
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
    ctx?.cleanup();
  });

  describe('[FR-PRMON-030] upsertPrs', () => {
    it('should insert new PRs and report them as new changes', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      void ws;

      const pr1 = makePr({ number: 1, headBranch: 'feat/one' });
      const pr2 = makePr({ number: 2, headBranch: 'feat/two', ciStatus: 'pending' });

      const result = upsertPrs(ctx.db, '/repo-a', [pr1, pr2]);

      expect(result.inserted).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toMatchObject({ type: 'new', number: 1, current: 'open' });
      expect(result.changes[1]).toMatchObject({ type: 'new', number: 2, current: 'open' });

      const rows = ctx.db.select().from(prs).where(eq(prs.repo, '/repo-a')).all();
      expect(rows).toHaveLength(2);
    });

    it('[FR-PRMON-320] should store merge conflicts on insert and clear them on update', () => {
      seedWorkspace(ctx, ['/repo-a']);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 6, hasConflicts: true })]);
      expect(ctx.db.select().from(prs).where(eq(prs.number, 6)).get()?.hasConflicts).toBe(true);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 6, hasConflicts: false })]);
      expect(ctx.db.select().from(prs).where(eq(prs.number, 6)).get()?.hasConflicts).toBe(false);
    });

    it('[FR-PRMON-320] should store a cross-repository head on insert and on update', () => {
      seedWorkspace(ctx, ['/repo-a']);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 6, isCrossRepository: true })]);
      expect(ctx.db.select().from(prs).where(eq(prs.number, 6)).get()?.isCrossRepository).toBe(
        true,
      );

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 6, isCrossRepository: false })]);
      expect(ctx.db.select().from(prs).where(eq(prs.number, 6)).get()?.isCrossRepository).toBe(
        false,
      );
    });

    it('[FR-PRMON-230] should store when the PR last changed on GitHub on insert and on update', () => {
      seedWorkspace(ctx, ['/repo-a']);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 5, updatedAt: '2026-09-01T10:00:00Z' })]);
      const inserted = ctx.db.select().from(prs).where(eq(prs.number, 5)).get();
      expect(inserted?.githubUpdatedAt).toBe('2026-09-01T10:00:00Z');

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 5, updatedAt: '2026-09-03T12:00:00Z' })]);
      const updated = ctx.db.select().from(prs).where(eq(prs.number, 5)).get();
      expect(updated?.githubUpdatedAt).toBe('2026-09-03T12:00:00Z');
    });

    it('should update existing PR in-place when ciStatus changes and report material change', () => {
      seedWorkspace(ctx, ['/repo-a']);

      // Initial insert
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 10, ciStatus: 'pending' })]);

      // Second call with changed ciStatus
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 10, ciStatus: 'passing' })]);

      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'ciStatus',
        number: 10,
        previous: 'pending',
        current: 'passing',
      });
    });

    it('should report reviewDecision change', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 3, reviewDecision: null })]);
      const result = upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 3, reviewDecision: 'APPROVED' }),
      ]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'reviewDecision',
        number: 3,
        previous: null,
        current: 'APPROVED',
      });
    });

    it('should delete PRs not present in the fresh list', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 }), makePr({ number: 2 })]);

      // Second call only includes PR 1 — PR 2 is no longer open and is deleted
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      expect(result.removed).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({ type: 'removed', number: 2 });

      const gone = ctx.db.select().from(prs).where(eq(prs.number, 2)).get();
      expect(gone).toBeUndefined();
    });

    it('should report nothing for PRs that were already deleted', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 }), makePr({ number: 2 })]);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      expect(result.removed).toBe(0);
      expect(result.changes).toHaveLength(0);
    });

    it('should report no changes when nothing changed', () => {
      seedWorkspace(ctx, ['/repo-a']);

      const pr = makePr({ number: 42, ciStatus: 'passing', reviewDecision: null });
      upsertPrs(ctx.db, '/repo-a', [pr]);

      const result = upsertPrs(ctx.db, '/repo-a', [pr]);
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.changes).toHaveLength(0);
    });

    it('should roll back all writes atomically when a batch insert fails mid-way', () => {
      seedWorkspace(ctx, ['/repo-a']);

      // Two PRs with the same number violate the unique (repo, number) constraint.
      // The second insert throws, which must roll back the first — no partial rows.
      expect(() =>
        upsertPrs(ctx.db, '/repo-a', [
          makePr({ number: 1 }),
          makePr({ number: 1, title: 'duplicate' }),
        ]),
      ).toThrow();

      const rows = ctx.db.select().from(prs).where(eq(prs.repo, '/repo-a')).all();
      expect(rows).toHaveLength(0);
    });

    it('should drop attention state with the row when a PR vanishes from the list', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 }), makePr({ number: 2 })]);
      ctx.db
        .update(prs)
        .set({ attentionReason: 'uncorrelated', lastFailedHeadSha: 'sha1' })
        .where(eq(prs.number, 2))
        .run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      expect(ctx.db.select().from(prs).where(eq(prs.number, 2)).get()).toBeUndefined();
    });

    it('[FR-PRMON-180] should persist commentCount and report its change', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 7, commentCount: 2 })]);
      const result = upsertPrs(ctx.db, '/repo-a', [makePr({ number: 7, commentCount: 5 })]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        type: 'commentCount',
        number: 7,
        previous: '2',
        current: '5',
      });
      expect(ctx.db.select().from(prs).where(eq(prs.number, 7)).get()?.commentCount).toBe(5);
    });

    it('[FR-PRMON-190] should persist viewer authorship', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 1, authoredByViewer: true }),
        makePr({ number: 2, authoredByViewer: false }),
      ]);

      expect(ctx.db.select().from(prs).where(eq(prs.number, 1)).get()?.authoredByViewer).toBe(true);
      expect(ctx.db.select().from(prs).where(eq(prs.number, 2)).get()?.authoredByViewer).toBe(
        false,
      );
    });

    it('should not clear attentionReason for PRs that remain open', () => {
      seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);
      ctx.db.update(prs).set({ attentionReason: 'non-mechanical' }).where(eq(prs.number, 1)).run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      const row = ctx.db.select().from(prs).where(eq(prs.number, 1)).get();
      expect(row?.attentionReason).toBe('non-mechanical');
    });
  });

  describe('[FR-PRMON-040] findCorrelatedSession', () => {
    it('should find a group-mode session correlated by branch and repo', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db.insert(taskGroups).values({ projectId: proj.id, name: 'TG' }).run();
      const tg = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, proj.id)).get()!;
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-group',
          taskGroupId: tg.id,
          branch: 'feat/x',
          worktreePath: '/repo-a/.worktrees/wt',
        })
        .run();

      const result = findCorrelatedSession(ctx.db, {
        headBranch: 'feat/x',
        repo: '/repo-a',
        isCrossRepository: false,
      });
      expect(result?.sessionId).toBe('sess-group');
    });

    it('should find a task-mode session (taskGroupId null) correlated via task → project', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db
        .insert(tasks)
        .values({ projectId: proj.id, title: 'T', type: 'ai', needsPlan: false })
        .run();
      const task = ctx.db.select().from(tasks).where(eq(tasks.projectId, proj.id)).get()!;
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-task',
          taskGroupId: null,
          taskId: task.id,
          branch: 'feat/x',
          worktreePath: '/repo-a/.worktrees/wt',
        })
        .run();

      const result = findCorrelatedSession(ctx.db, {
        headBranch: 'feat/x',
        repo: '/repo-a',
        isCrossRepository: false,
      });
      expect(result?.sessionId).toBe('sess-task');
    });

    it('should return the most recent session when both group-mode and task-mode sessions exist', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db.insert(taskGroups).values({ projectId: proj.id, name: 'TG' }).run();
      const tg = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, proj.id)).get()!;
      ctx.db
        .insert(tasks)
        .values({ projectId: proj.id, title: 'T', type: 'ai', needsPlan: false })
        .run();
      const task = ctx.db.select().from(tasks).where(eq(tasks.projectId, proj.id)).get()!;

      ctx.db
        .insert(agentSessions)
        .values([
          {
            sessionId: 'sess-group-old',
            taskGroupId: tg.id,
            branch: 'feat/x',
            worktreePath: '/repo-a/.worktrees/wt-group',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            sessionId: 'sess-task-new',
            taskGroupId: null,
            taskId: task.id,
            branch: 'feat/x',
            worktreePath: '/repo-a/.worktrees/wt-task',
            createdAt: '2024-02-01T00:00:00.000Z',
            updatedAt: '2024-02-01T00:00:00.000Z',
          },
        ])
        .run();

      const result = findCorrelatedSession(ctx.db, {
        headBranch: 'feat/x',
        repo: '/repo-a',
        isCrossRepository: false,
      });
      expect(result?.sessionId).toBe('sess-task-new');
    });

    describe('coder workspace sessions', () => {
      function seedCoderSession(worktreePath: string, coderRepoBasePath = '~/dev/') {
        ctx.db
          .insert(workspaces)
          .values({
            name: 'WS',
            slug: 'ws',
            repos: ['/home/me/dev/repo-a'],
            executionBackend: 'coder',
            coderConfig: { workspace: 'my-ws', repoBasePath: coderRepoBasePath },
          })
          .run();
        const ws = ctx.db.select().from(workspaces).where(eq(workspaces.slug, 'ws')).get()!;
        ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
        const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
        ctx.db.insert(taskGroups).values({ projectId: proj.id, name: 'TG' }).run();
        const tg = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, proj.id)).get()!;
        ctx.db
          .insert(agentSessions)
          .values({
            sessionId: 'sess-coder',
            taskGroupId: tg.id,
            branch: 'feat/x',
            worktreePath,
          })
          .run();
      }

      const target = {
        headBranch: 'feat/x',
        repo: '/home/me/dev/repo-a',
        isCrossRepository: false,
      };

      it('should correlate a session whose remote worktree sits under the coder base path of the repo', () => {
        seedCoderSession('~/dev/repo-a/.claude/worktrees/engy-session-abc12345');

        const result = findCorrelatedSession(ctx.db, target);

        expect(result?.sessionId).toBe('sess-coder');
        expect(result?.projectSlug).toBe('p');
      });

      it('should not correlate a remote worktree of another repo', () => {
        seedCoderSession('~/dev/repo-b/.claude/worktrees/engy-session-abc12345');

        expect(findCorrelatedSession(ctx.db, target)).toBeNull();
      });

      it('should not correlate a remote worktree of a repo that only shares the name prefix', () => {
        seedCoderSession('~/dev/repo-a-other/.claude/worktrees/engy-session-abc12345');

        expect(findCorrelatedSession(ctx.db, target)).toBeNull();
      });

      it('should not correlate a remote worktree for a cross-repository PR', () => {
        seedCoderSession('~/dev/repo-a/.claude/worktrees/engy-session-abc12345');

        expect(findCorrelatedSession(ctx.db, { ...target, isCrossRepository: true })).toBeNull();
      });
    });

    it('[FR-PRMON-040] should not correlate a session whose worktree is outside the repo, even in a sibling path with the same prefix', () => {
      seedWorkspace(ctx, ['/repo-a']);
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-sibling',
          branch: 'feat/x',
          worktreePath: '/repo-a-other/.worktrees/wt',
        })
        .run();

      expect(
        findCorrelatedSession(ctx.db, {
          headBranch: 'feat/x',
          repo: '/repo-a',
          isCrossRepository: false,
        }),
      ).toBeNull();
    });

    it('[FR-PRMON-040] should return the project slug of the correlated session', () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      const proj = ctx.db
        .insert(projects)
        .values({ workspaceId: ws.id, name: 'P', slug: 'my-proj', projectDir: 'my-proj' })
        .returning()
        .get();
      const tg = ctx.db
        .insert(taskGroups)
        .values({ projectId: proj.id, name: 'TG' })
        .returning()
        .get();
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-slug',
          taskGroupId: tg.id,
          branch: 'feat/x',
          worktreePath: '/repo-a',
        })
        .run();

      expect(
        findCorrelatedSession(ctx.db, {
          headBranch: 'feat/x',
          repo: '/repo-a',
          isCrossRepository: false,
        })?.projectSlug,
      ).toBe('my-proj');
    });

    it('[FR-PRMON-040] should not correlate a session with a cross-repository PR on the same branch name', () => {
      seedWorkspace(ctx, ['/repo-a']);
      ctx.db
        .insert(agentSessions)
        .values({ sessionId: 'sess-own', branch: 'feat/x', worktreePath: '/repo-a/.worktrees/wt' })
        .run();

      expect(
        findCorrelatedSession(ctx.db, {
          headBranch: 'feat/x',
          repo: '/repo-a',
          isCrossRepository: true,
        }),
      ).toBeNull();
    });

    it('should return null when no session matches the branch and repo', () => {
      seedWorkspace(ctx, ['/repo-a']);
      const result = findCorrelatedSession(ctx.db, {
        headBranch: 'feat/no-match',
        repo: '/repo-a',
        isCrossRepository: false,
      });
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return open PRs for all workspace repos ordered by updatedAt desc', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/a' })]);
      upsertPrs(ctx.db, '/repo-b', [makePr({ number: 2, headBranch: 'feat/b' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });

      expect(result.prs).toHaveLength(2);
      const branches = result.prs.map((r) => r.headBranch);
      expect(branches).toContain('feat/a');
      expect(branches).toContain('feat/b');
    });

    it('[FR-INBOX-590] should say whether a review was requested from the viewer or a viewer team', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.state.github.viewer = { login: 'octocat', scopes: null };
      ctx.state.github.teams = { keys: new Set(['acme/web']), fetchedAt: Date.now() };
      upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 1, reviewRequests: ['octocat'] }),
        makePr({ number: 2, reviewRequests: ['acme/web', 'acme/other'] }),
      ]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      const byNumber = new Map(result.prs.map((pr) => [pr.number, pr.reviewRequestedFrom]));

      expect(byNumber.get(1)).toEqual({ viewer: true, teams: [] });
      expect(byNumber.get(2)).toEqual({ viewer: false, teams: ['acme/web'] });
    });

    it('should stop returning PRs that vanished from the open list', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 }), makePr({ number: 2 })]);
      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1 })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].number).toBe(1);
    });

    it('[FR-PRMON-130] should return per-repo gh errors from the in-memory map', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);
      ctx.state.prRepoErrors.set('/repo-a', 'Bad gateway');
      ctx.state.prRepoErrors.set('/unrelated-repo', 'ignored');

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.repoErrors).toEqual({ '/repo-a': 'Bad gateway' });
    });

    it('should correlate PRs with most recent agent session matching headBranch', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      // Insert project + task group for the session
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db.insert(taskGroups).values({ projectId: proj.id, name: 'TG', numInMilestone: 0 }).run();
      const tg = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, proj.id)).get()!;

      // Two sessions on the same branch — the later one should win
      ctx.db
        .insert(agentSessions)
        .values([
          {
            sessionId: 'sess-old',
            taskGroupId: tg.id,
            branch: 'feat/my-feature',
            worktreePath: '/repo-a/.worktrees/old-wt',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            sessionId: 'sess-new',
            taskGroupId: tg.id,
            branch: 'feat/my-feature',
            worktreePath: '/repo-a/.worktrees/new-wt',
            createdAt: '2024-02-01T00:00:00.000Z',
            updatedAt: '2024-02-01T00:00:00.000Z',
          },
        ])
        .run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/my-feature' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].sessionId).toBe('sess-new');
      expect(result.prs[0].taskGroupId).toBe(tg.id);
      expect(result.prs[0].worktreePath).toBe('/repo-a/.worktrees/new-wt');
      expect(result.prs[0].projectSlug).toBe('p');
    });

    it('[FR-PRMON-040] should not attach a local session to a cross-repository PR in pr.list', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-own',
          branch: 'fix-typo',
          worktreePath: '/repo-a/.worktrees/wt',
        })
        .run();
      upsertPrs(ctx.db, '/repo-a', [
        makePr({ number: 1, headBranch: 'fix-typo', isCrossRepository: true }),
        makePr({ number: 2, headBranch: 'fix-typo', isCrossRepository: false }),
      ]);

      const result = await caller.pr.list({ workspaceId: ws.id });

      const byNumber = new Map(result.prs.map((pr) => [pr.number, pr.sessionId]));
      expect(byNumber.get(1)).toBeNull();
      expect(byNumber.get(2)).toBe('sess-own');
    });

    it('should scope session correlation by repo so identically-named branches do not cross-correlate', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);

      // Project for repo-a
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'PA', slug: 'pa' }).run();
      const projA = ctx.db.select().from(projects).where(eq(projects.slug, 'pa')).get()!;
      ctx.db
        .insert(taskGroups)
        .values({ projectId: projA.id, name: 'TGA', numInMilestone: 0 })
        .run();
      const tgA = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, projA.id)).get()!;

      // Project for repo-b
      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'PB', slug: 'pb' }).run();
      const projB = ctx.db.select().from(projects).where(eq(projects.slug, 'pb')).get()!;
      ctx.db
        .insert(taskGroups)
        .values({ projectId: projB.id, name: 'TGB', numInMilestone: 0 })
        .run();
      const tgB = ctx.db.select().from(taskGroups).where(eq(taskGroups.projectId, projB.id)).get()!;

      // Same branch name in two separate repo sessions
      ctx.db
        .insert(agentSessions)
        .values([
          {
            sessionId: 'sess-a',
            taskGroupId: tgA.id,
            branch: 'feat/shared',
            worktreePath: '/repo-a/.worktrees/wt-a',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            sessionId: 'sess-b',
            taskGroupId: tgB.id,
            branch: 'feat/shared',
            worktreePath: '/repo-b/.worktrees/wt-b',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ])
        .run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/shared' })]);
      upsertPrs(ctx.db, '/repo-b', [makePr({ number: 2, headBranch: 'feat/shared' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.prs).toHaveLength(2);

      const prA = result.prs.find((r) => r.repo === '/repo-a');
      const prB = result.prs.find((r) => r.repo === '/repo-b');

      expect(prA?.sessionId).toBe('sess-a');
      expect(prB?.sessionId).toBe('sess-b');
      expect(prA?.projectSlug).toBe('pa');
      expect(prB?.projectSlug).toBe('pb');
    });

    it('should return null session fields when no matching agent session exists', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 1, headBranch: 'feat/no-session' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.prs[0].sessionId).toBeNull();
      expect(result.prs[0].taskGroupId).toBeNull();
      expect(result.prs[0].worktreePath).toBeNull();
      expect(result.prs[0].projectSlug).toBeNull();
    });

    it('should correlate PRs with task-mode sessions (taskGroupId null, correlated via task → project)', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);

      ctx.db.insert(projects).values({ workspaceId: ws.id, name: 'P', slug: 'p' }).run();
      const proj = ctx.db.select().from(projects).where(eq(projects.slug, 'p')).get()!;
      ctx.db
        .insert(tasks)
        .values({ projectId: proj.id, title: 'T', type: 'ai', needsPlan: false })
        .run();
      const task = ctx.db.select().from(tasks).where(eq(tasks.projectId, proj.id)).get()!;

      ctx.db
        .insert(agentSessions)
        .values({
          sessionId: 'sess-task-mode',
          taskGroupId: null,
          taskId: task.id,
          branch: 'feat/task-mode',
          worktreePath: '/repo-a/.worktrees/wt-task',
        })
        .run();

      upsertPrs(ctx.db, '/repo-a', [makePr({ number: 5, headBranch: 'feat/task-mode' })]);

      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].sessionId).toBe('sess-task-mode');
      expect(result.prs[0].worktreePath).toBe('/repo-a/.worktrees/wt-task');
      expect(result.prs[0].projectSlug).toBe('p');
    });

    it('should return empty results when workspace has no repos', async () => {
      const ws = seedWorkspace(ctx, []);
      const result = await caller.pr.list({ workspaceId: ws.id });
      expect(result).toEqual({ prs: [], repoErrors: {} });
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(caller.pr.list({ workspaceId: 999 })).rejects.toThrow('Workspace not found');
    });
  });

  describe('refresh', () => {
    it('should list PRs once and upsert them into each matching repo', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);
      linkRepo(ctx, '/repo-a', 'org/repo-a');
      linkRepo(ctx, '/repo-b', 'org/repo-b');
      replyWithOpenPrs(stub, [
        rawPr({ number: 1, repository: { nameWithOwner: 'org/repo-a' } }),
        rawPr({ number: 2, headRefName: 'feat/b', repository: { nameWithOwner: 'org/repo-b' } }),
        rawPr({ number: 3, repository: { nameWithOwner: 'org/other' } }),
      ]);

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(stub.requests).toHaveLength(2);
      const stored = ctx.db.select().from(prs).all();
      expect(stored.map((row) => [row.repo, row.number, row.repoFullName]).sort()).toEqual([
        ['/repo-a', 1, 'org/repo-a'],
        ['/repo-b', 2, 'org/repo-b'],
      ]);
    });

    it('[FR-PRMON-020] should isolate a repo without a GitHub remote while others succeed', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);
      linkRepo(ctx, '/repo-a', null);
      linkRepo(ctx, '/repo-b', 'org/repo-b');
      replyWithOpenPrs(stub, [
        rawPr({ number: 2, headRefName: 'feat/b', repository: { nameWithOwner: 'org/repo-b' } }),
      ]);

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      const failed = results.find((r) => r.repo === '/repo-a');
      const succeeded = results.find((r) => r.repo === '/repo-b');
      expect(failed).toMatchObject({
        success: false,
        error: 'No GitHub remote found for /repo-a',
      });
      expect(succeeded?.success).toBe(true);
      expect(ctx.state.prRepoErrors.get('/repo-a')).toBe('No GitHub remote found for /repo-a');
      expect(ctx.state.prRepoErrors.has('/repo-b')).toBe(false);
    });

    it('[FR-PRMON-020] should record the GitHub error on every repo when the search fails', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a', '/repo-b']);
      stub.reply(() => ({ status: 502, body: { message: 'Bad gateway' } }));

      const results = await caller.pr.refresh({ workspaceId: ws.id });

      expect(results).toEqual([
        { repo: '/repo-a', success: false, error: 'Bad gateway' },
        { repo: '/repo-b', success: false, error: 'Bad gateway' },
      ]);
      expect(ctx.state.prRepoErrors.get('/repo-b')).toBe('Bad gateway');
    });

    it('should reject with the setup message when GitHub is unavailable', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      ctx.state.github.status = {
        available: false,
        reason: 'missing_token',
        message: 'Set ENGY_GITHUB_TOKEN in .env',
      };

      await expect(caller.pr.refresh({ workspaceId: ws.id })).rejects.toThrow(
        'Set ENGY_GITHUB_TOKEN in .env',
      );
      expect(stub.requests).toHaveLength(0);
    });

    it('should clear a repo error on the next successful refresh', async () => {
      const ws = seedWorkspace(ctx, ['/repo-a']);
      linkRepo(ctx, '/repo-a', 'org/repo-a');
      ctx.state.prRepoErrors.set('/repo-a', 'Bad gateway');
      replyWithOpenPrs(stub, [rawPr({ repository: { nameWithOwner: 'org/repo-a' } })]);

      await caller.pr.refresh({ workspaceId: ws.id });

      expect(ctx.state.prRepoErrors.has('/repo-a')).toBe(false);
    });

    it('should return empty results when workspace has no repos', async () => {
      const ws = seedWorkspace(ctx, []);

      const results = await caller.pr.refresh({ workspaceId: ws.id });
      expect(results).toEqual([]);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(caller.pr.refresh({ workspaceId: 999 })).rejects.toThrow('Workspace not found');
    });
  });
});
