import type { TaskSession } from '@/server/tasks/sessions';

type TaskSessionAction = 'open' | 'resume';

export function taskSessionAction(session: TaskSession): TaskSessionAction | null {
  if (session.kind === 'execution') return null;
  if (!session.workspaceSlug) return null;
  if (session.state === 'ended') return session.agentType === 'claude' ? 'resume' : null;
  return 'open';
}

export function taskSessionStateLabel(session: TaskSession): string {
  if (session.kind === 'execution') return session.status;
  return session.state;
}

export function taskSessionTitle(session: TaskSession): string {
  if (session.kind === 'terminal') return session.label;
  const mode = session.executionMode ?? 'task';
  return `Background ${mode} run`;
}
