import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { projects, tasks, workspaces } from '../db/schema';
import { getSupersededMemoryPaths } from '../search/memory-queries';
import { runQmdSearch } from '../search/qmd-search';
import { attachBlockedBy } from '../tasks/validation';
import type { TerminalSessionMeta } from '../trpc/context';
import type { HookPayload } from './types';

interface SessionStartHookResult {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

export const SESSION_CONTEXT_CHAR_BUDGET = 4000;
const TRUNCATION_NOTE = '\n\n_[context truncated to stay within budget]_';

const ACTIVE_TASK_STATUSES = ['todo', 'in_progress', 'review'] as const;
const TASK_STATUS_RANK: Record<string, number> = { in_progress: 0, review: 1, todo: 2 };

const MEMORY_SEARCH_LIMIT = 3;
const MEMORY_SEARCH_TIMEOUT_MS = 3000;

/**
 * SessionStart claude 2.1.251 drops `type: "http"` hooks, so this event's
 * transport is a `command` hook (see agent-types.ts) that curls this endpoint
 * and prints the response to stdout — verified by probe to require this exact
 * `hookSpecificOutput`-wrapped shape; the flat `{ additionalContext }` shape
 * the other handlers use is silently ignored by the CLI for SessionStart.
 */
export async function buildSessionStartContext(
  payload: HookPayload,
  meta: TerminalSessionMeta,
): Promise<SessionStartHookResult> {
  if (!meta.projectId) return {};

  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, meta.projectId)).get();
  const projectName = project?.name ?? meta.projectSlug ?? `project #${meta.projectId}`;

  const sections = [renderHeader(meta, projectName), renderTasks(meta.projectId)];

  const workspace = meta.workspaceSlug
    ? db.select().from(workspaces).where(eq(workspaces.slug, meta.workspaceSlug)).get()
    : undefined;
  if (workspace) {
    const memories = await renderMemories(workspace, projectName, payload.session_id);
    if (memories) sections.push(memories);
  }

  const block = boundToCharBudget(sections.join('\n\n'), SESSION_CONTEXT_CHAR_BUDGET);
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } };
}

function renderHeader(meta: TerminalSessionMeta, projectName: string): string {
  const lines = [`## Project: ${projectName}`];
  if (meta.workspaceSlug) lines.push(`Workspace: ${meta.workspaceSlug}`);
  if (meta.worktreeBranch) lines.push(`Branch: ${meta.worktreeBranch}`);
  return lines.join('\n');
}

function renderTasks(projectId: number): string {
  const db = getDb();
  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.status, ACTIVE_TASK_STATUSES)))
    .all();
  const withDeps = attachBlockedBy(rows);

  if (withDeps.length === 0) {
    return '### Tasks\nNone in progress or blocked.';
  }

  const sorted = [...withDeps].sort(
    (a, b) => (TASK_STATUS_RANK[a.status] ?? 9) - (TASK_STATUS_RANK[b.status] ?? 9) || a.id - b.id,
  );
  const lines = sorted.map((t) => {
    const blocked = t.blockedBy.length > 0 ? ` — blocked by #${t.blockedBy.join(', #')}` : '';
    return `- [${t.status}] ${t.title} (#${t.id})${blocked}`;
  });
  return ['### Tasks', ...lines].join('\n');
}

async function renderMemories(
  workspace: { id: number; slug: string; docsDir: string | null },
  query: string,
  sessionId: string | undefined,
): Promise<string | undefined> {
  // Mirrors the tRPC/MCP search router's convention: skipped in test/CI
  // environments without the qmd model, and only 'lex' is safe here — hybrid
  // runs local LLM inference that can take minutes on this hardware and
  // would stall session start behind it.
  if (process.env.QMD_SKIP === '1') return undefined;

  try {
    const hits = await withTimeout(
      runQmdSearch(workspace, query, 'memory', MEMORY_SEARCH_LIMIT, 'lex', undefined),
      MEMORY_SEARCH_TIMEOUT_MS,
    );
    const superseded = getSupersededMemoryPaths(workspace.id);
    const visible = hits.filter((h) => !superseded.has(h.displayPath));
    if (visible.length === 0) return undefined;

    const lines = visible.map((h) => {
      const snippet = h.snippet ? ` — ${h.snippet}` : '';
      return `- ${h.title || h.displayPath}${snippet}`;
    });
    return ['### Related memory', ...lines].join('\n');
  } catch (err) {
    console.warn(
      `[hooks] session-context memory search failed (session ${sessionId ?? 'unknown'}):`,
      err,
    );
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function boundToCharBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const maxContentLength = Math.max(0, budget - TRUNCATION_NOTE.length);
  return text.slice(0, maxContentLength) + TRUNCATION_NOTE;
}
