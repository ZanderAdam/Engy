import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appRouter } from '../trpc/root';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import type { TerminalSessionMeta } from '../trpc/context';
import { buildSessionStartContext, SESSION_CONTEXT_CHAR_BUDGET } from './session-context';
import * as qmdSearch from '../search/qmd-search';

function baseMeta(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    scopeType: 'project',
    scopeLabel: 'Test Session',
    workingDir: '/tmp/engy-test',
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('session-context', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('[FR-TERMINAL-640] no project binding', () => {
    it('returns {} when meta.projectId is unset', async () => {
      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta(),
      );
      expect(result).toEqual({});
    });
  });

  describe('[FR-TERMINAL-640] project-bound session', () => {
    it('describes the workspace, project, and its in-progress/blocked tasks', async () => {
      const ws = await caller.workspace.create({ name: 'Context WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Context Project',
      });

      const blocker = await caller.task.create({ projectId: project.id, title: 'Blocker task' });
      const inProgress = await caller.task.create({
        projectId: project.id,
        title: 'In progress task',
        blockedBy: [blocker.id],
      });
      await caller.task.update({ id: inProgress.id, status: 'in_progress' });
      await caller.task.update({ id: blocker.id, status: 'todo' });

      // Excluded statuses.
      const backlogTask = await caller.task.create({
        projectId: project.id,
        title: 'Backlog task',
      });
      await caller.task.update({ id: backlogTask.id, status: 'backlog' });
      const doneTask = await caller.task.create({ projectId: project.id, title: 'Done task' });
      await caller.task.update({ id: doneTask.id, status: 'done' });

      const meta = baseMeta({
        workspaceSlug: ws.slug,
        projectId: project.id,
        projectSlug: project.slug,
        worktreeBranch: 'aadamovic/context-test',
      });

      const result = await buildSessionStartContext({ hook_event_name: 'SessionStart' }, meta);

      expect(result.hookSpecificOutput?.hookEventName).toBe('SessionStart');
      const context = result.hookSpecificOutput?.additionalContext ?? '';
      expect(context).toContain('Context Project');
      expect(context).toContain(ws.slug);
      expect(context).toContain('aadamovic/context-test');
      expect(context).toContain('In progress task');
      expect(context).toContain(`blocked by #${blocker.id}`);
      expect(context).toContain('Blocker task');
      expect(context).not.toContain('Backlog task');
      expect(context).not.toContain('Done task');
    });

    it('says so when there are no in-progress or blocked tasks', async () => {
      const ws = await caller.workspace.create({ name: 'Empty WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Empty Project',
      });

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );

      expect(result.hookSpecificOutput?.additionalContext).toContain('None in progress or blocked');
    });
  });

  describe('[FR-TERMINAL-640] matcher independence', () => {
    it('returns identical context for startup, resume, compact, fork and clear', async () => {
      const ws = await caller.workspace.create({ name: 'Matcher WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Matcher Project',
      });
      await caller.task.create({ projectId: project.id, title: 'Some task' });
      const meta = baseMeta({
        workspaceSlug: ws.slug,
        projectId: project.id,
        projectSlug: project.slug,
      });

      const matchers = ['startup', 'resume', 'compact', 'fork', 'clear'];
      const results = await Promise.all(
        matchers.map((source) =>
          buildSessionStartContext({ hook_event_name: 'SessionStart', source }, meta),
        ),
      );

      const contexts = results.map((r) => r.hookSpecificOutput?.additionalContext);
      for (const context of contexts) {
        expect(context).toBe(contexts[0]);
      }
    });
  });

  describe('[FR-TERMINAL-650] char budget', () => {
    it('truncates with a visible marker past the budget', async () => {
      const ws = await caller.workspace.create({ name: 'Big WS' });
      const project = await caller.project.create({ workspaceSlug: ws.slug, name: 'Big Project' });

      for (let i = 0; i < 150; i++) {
        await caller.task.create({
          projectId: project.id,
          title: `Task number ${i} with a moderately long descriptive title to pad length`,
        });
      }

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );
      const context = result.hookSpecificOutput?.additionalContext ?? '';

      expect(context.length).toBeLessThanOrEqual(SESSION_CONTEXT_CHAR_BUDGET);
      expect(context).toContain('truncated');
    });

    it('does not truncate a small task list', async () => {
      const ws = await caller.workspace.create({ name: 'Small WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Small Project',
      });
      await caller.task.create({ projectId: project.id, title: 'One small task' });

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );
      expect(result.hookSpecificOutput?.additionalContext).not.toContain('truncated');
    });
  });

  describe('[FR-TERMINAL-650] relevant memory inclusion', () => {
    const originalQmdSkip = process.env.QMD_SKIP;

    beforeEach(() => {
      delete process.env.QMD_SKIP;
    });

    afterEach(() => {
      process.env.QMD_SKIP = originalQmdSkip;
      vi.restoreAllMocks();
    });

    it('appends the top few relevant memories via runQmdSearch (mode: lex)', async () => {
      const ws = await caller.workspace.create({ name: 'Memory WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Memory Project',
      });

      const searchSpy = vi.spyOn(qmdSearch, 'runQmdSearch').mockResolvedValue([
        {
          file: 'memory/pattern/foo.md',
          displayPath: 'memory/pattern/foo.md',
          title: 'Foo pattern',
          score: 1,
          snippet: 'Do foo the right way.',
        },
      ]);

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );
      const context = result.hookSpecificOutput?.additionalContext ?? '';

      expect(searchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ slug: ws.slug }),
        'Memory Project',
        'memory',
        3,
        'lex',
        undefined,
      );
      expect(context).toContain('Related memory');
      expect(context).toContain('Foo pattern');
      expect(context).toContain('Do foo the right way.');
    });

    it('degrades to task-only context when the memory search fails', async () => {
      const ws = await caller.workspace.create({ name: 'Failing Memory WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Failing Memory Project',
      });
      await caller.task.create({ projectId: project.id, title: 'Still shown task' });

      vi.spyOn(qmdSearch, 'runQmdSearch').mockRejectedValue(new Error('search backend down'));

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );
      const context = result.hookSpecificOutput?.additionalContext ?? '';

      expect(context).toContain('Still shown task');
      expect(context).not.toContain('Related memory');
    });

    it('keeps the combined tasks + memories block within the FR-TERMINAL-650 budget', async () => {
      const ws = await caller.workspace.create({ name: 'Combined WS' });
      const project = await caller.project.create({
        workspaceSlug: ws.slug,
        name: 'Combined Project',
      });

      for (let i = 0; i < 100; i++) {
        await caller.task.create({
          projectId: project.id,
          title: `Combined budget task ${i} with padding text to increase length`,
        });
      }
      vi.spyOn(qmdSearch, 'runQmdSearch').mockResolvedValue([
        {
          file: 'memory/pattern/bar.md',
          displayPath: 'memory/pattern/bar.md',
          title: 'Bar pattern',
          score: 1,
          snippet: 'A relevant memory snippet.',
        },
      ]);

      const result = await buildSessionStartContext(
        { hook_event_name: 'SessionStart' },
        baseMeta({ workspaceSlug: ws.slug, projectId: project.id, projectSlug: project.slug }),
      );
      const context = result.hookSpecificOutput?.additionalContext ?? '';

      expect(context.length).toBeLessThanOrEqual(SESSION_CONTEXT_CHAR_BUDGET);
    });
  });
});
