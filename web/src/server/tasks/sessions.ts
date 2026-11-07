import { desc, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { agentSessions, taskSessions, tasks, terminalSessionHistory } from '../db/schema';
import type { AppState, TerminalSessionMeta } from '../trpc/context';
import { terminalSessionKey } from '../ws/terminal-session-history';

type TaskSessionKind = 'terminal' | 'execution';
type TaskSessionSource = 'spawn' | 'mcp';

interface TaskSessionLink {
  taskId: number;
  sessionKey: string;
  kind: TaskSessionKind;
  source: TaskSessionSource;
}

export interface TaskTerminalSession {
  kind: 'terminal';
  key: string;
  state: 'live' | 'parked' | 'ended';
  terminalSessionId: string | null;
  label: string;
  agentType: string | null;
  workingDir: string;
  groupKey: string | null;
  workspaceSlug: string | null;
  projectSlug: string | null;
  worktreeBranch: string | null;
  containerMode: string | null;
  lastActiveAt: string;
}

export interface TaskExecutionSession {
  kind: 'execution';
  key: string;
  status: string;
  executionMode: string | null;
  branch: string | null;
  worktreePath: string | null;
  lastActiveAt: string;
}

export type TaskSession = TaskTerminalSession | TaskExecutionSession;

export function linkTaskSessions(
  taskIds: readonly number[],
  link: Omit<TaskSessionLink, 'taskId'>,
): void {
  if (taskIds.length === 0) return;
  const now = new Date().toISOString();
  try {
    const db = getDb();
    const existingTaskIds = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, [...new Set(taskIds)]))
      .all()
      .map((row) => row.id);
    if (existingTaskIds.length === 0) return;
    db.insert(taskSessions)
      .values(
        existingTaskIds.map((taskId) => ({ ...link, taskId, firstSeenAt: now, lastSeenAt: now })),
      )
      .onConflictDoUpdate({
        target: [taskSessions.taskId, taskSessions.sessionKey],
        set: { lastSeenAt: now },
      })
      .run();
  } catch (err) {
    console.warn(`[task-sessions] Failed to link session ${link.sessionKey} to tasks:`, err);
  }
}

export function linkSpawnedTerminal(
  terminalSessionId: string,
  meta: TerminalSessionMeta,
  extraTaskIds: readonly number[] = [],
): void {
  const taskIds = meta.taskId == null ? extraTaskIds : [meta.taskId, ...extraTaskIds];
  linkTaskSessions(taskIds, {
    sessionKey: terminalSessionKey(terminalSessionId, meta),
    kind: 'terminal',
    source: 'spawn',
  });
}

export function listSessionTaskIds(sessionKey: string): number[] {
  return getDb()
    .select({ taskId: taskSessions.taskId })
    .from(taskSessions)
    .where(eq(taskSessions.sessionKey, sessionKey))
    .orderBy(desc(taskSessions.lastSeenAt))
    .all()
    .map((row) => row.taskId);
}

function terminalLabel(
  meta: TerminalSessionMeta,
  history: { summary: string } | undefined,
): string {
  return history?.summary || meta.lastTitle || meta.scopeLabel;
}

export function listTaskSessions(state: AppState, taskId: number): TaskSession[] {
  const db = getDb();
  const links = db.select().from(taskSessions).where(eq(taskSessions.taskId, taskId)).all();
  const lastSeenByKey = new Map(links.map((link) => [link.sessionKey, link.lastSeenAt]));
  const terminalKeys = new Set(
    links.filter((link) => link.kind === 'terminal').map((link) => link.sessionKey),
  );
  const executionKeys = links
    .filter((link) => link.kind === 'execution')
    .map((link) => link.sessionKey);

  const live: Array<{ terminalSessionId: string; key: string; meta: TerminalSessionMeta }> = [];
  for (const [terminalSessionId, meta] of state.terminalSessionMeta) {
    const key = terminalSessionKey(terminalSessionId, meta);
    if (terminalKeys.has(key) || meta.taskId === taskId) {
      live.push({ terminalSessionId, key, meta });
      terminalKeys.add(key);
    }
  }

  const historyRows =
    terminalKeys.size === 0
      ? []
      : db
          .select()
          .from(terminalSessionHistory)
          .where(inArray(terminalSessionHistory.sessionId, [...terminalKeys]))
          .all();
  const historyByKey = new Map(historyRows.map((row) => [row.sessionId, row]));

  const sessions: TaskSession[] = live.map(({ terminalSessionId, key, meta }) => {
    const history = historyByKey.get(key);
    return {
      kind: 'terminal',
      key,
      state: meta.dormant ? 'parked' : 'live',
      terminalSessionId,
      label: terminalLabel(meta, history),
      agentType: meta.agentType ?? null,
      workingDir: meta.workingDir,
      groupKey: meta.groupKey ?? null,
      workspaceSlug: meta.workspaceSlug ?? null,
      projectSlug: meta.projectSlug ?? null,
      worktreeBranch: meta.worktreeBranch ?? null,
      containerMode: meta.containerMode ?? null,
      lastActiveAt: lastSeenByKey.get(key) ?? history?.startedAt ?? new Date().toISOString(),
    };
  });

  const liveKeys = new Set(live.map((entry) => entry.key));
  for (const row of historyRows) {
    if (liveKeys.has(row.sessionId)) continue;
    sessions.push({
      kind: 'terminal',
      key: row.sessionId,
      state: 'ended',
      terminalSessionId: null,
      label: row.summary || row.scopeLabel,
      agentType: row.agentType,
      workingDir: row.workingDir,
      groupKey: null,
      workspaceSlug: row.workspaceSlug,
      projectSlug: row.projectSlug,
      worktreeBranch: row.worktreeBranch,
      containerMode: row.containerMode,
      lastActiveAt: row.closedAt ?? lastSeenByKey.get(row.sessionId) ?? row.startedAt,
    });
  }

  const executionRows = db
    .select()
    .from(agentSessions)
    .where(
      or(
        eq(agentSessions.taskId, taskId),
        executionKeys.length > 0 ? inArray(agentSessions.sessionId, executionKeys) : undefined,
      ),
    )
    .all();
  for (const row of executionRows) {
    sessions.push({
      kind: 'execution',
      key: row.sessionId,
      status: row.status,
      executionMode: row.executionMode,
      branch: row.branch,
      worktreePath: row.worktreePath,
      lastActiveAt: row.updatedAt,
    });
  }

  return sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}
