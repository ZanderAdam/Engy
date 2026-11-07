'use client';

import { RiHistoryLine, RiTerminalLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getMcpUrl } from '@/lib/agent-types';
import { relativeTime, buildResumeScope } from '@/components/terminal/session-history-entries';
import { useOpenLiveSession } from '@/components/terminal/use-open-live-session';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import type { TaskSession, TaskTerminalSession } from '@/server/tasks/sessions';
import { taskSessionAction, taskSessionStateLabel, taskSessionTitle } from './task-sessions-model';

interface TaskSessionsTabProps {
  taskId: number;
  sessions: TaskSession[];
  fetchedAt: number;
  onLeave: () => void;
}

export function TaskSessionsTab({ taskId, sessions, fetchedAt, onLeave }: TaskSessionsTabProps) {
  const openLiveSession = useOpenLiveSession();
  const resumeSession = useResumeTaskSession(taskId);

  const runAction = (session: TaskTerminalSession) => {
    if (session.terminalSessionId) {
      openLiveSession({ ...session, sessionId: session.terminalSessionId });
    } else {
      resumeSession(session);
    }
    onLeave();
  };

  return (
    <ul className="flex flex-col divide-y divide-border border border-border">
      {sessions.map((session) => {
        const action = taskSessionAction(session);
        return (
          <li
            key={`${session.kind}:${session.key}`}
            className="flex items-center gap-3 p-2 text-xs"
          >
            <Badge variant="outline" className="w-16 shrink-0 justify-center capitalize">
              {taskSessionStateLabel(session)}
            </Badge>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{taskSessionTitle(session)}</span>
              <span className="truncate text-muted-foreground">
                {sessionDetail(session)} · {relativeTime(session.lastActiveAt, fetchedAt)}
              </span>
            </div>
            {action && session.kind === 'terminal' && (
              <Button size="sm" variant="outline" onClick={() => runAction(session)}>
                {action === 'open' ? (
                  <RiTerminalLine className="size-3.5" />
                ) : (
                  <RiHistoryLine className="size-3.5" />
                )}
                {action === 'open' ? 'Open' : 'Resume'}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function sessionDetail(session: TaskSession): string {
  if (session.kind === 'execution') return session.branch ?? session.worktreePath ?? 'no branch';
  const agent = session.agentType ?? 'shell';
  return session.worktreeBranch ? `${agent} · ${session.worktreeBranch}` : agent;
}

function useResumeTaskSession(taskId: number) {
  const { openNewTerminal } = useSendToTerminal();
  const utils = trpc.useUtils();

  return async (session: TaskTerminalSession) => {
    if (!session.workspaceSlug) return;
    const workspace = await utils.workspace.get.fetch({ slug: session.workspaceSlug });
    const projectDir =
      session.projectSlug && workspace.resolvedDir
        ? `${workspace.resolvedDir}/projects/${session.projectSlug}`
        : undefined;
    openNewTerminal(
      buildResumeScope(
        { ...session, sessionId: session.key, scopeLabel: session.label },
        {
          workspaceSlug: session.workspaceSlug,
          mcpUrl: getMcpUrl(),
          agentSettings: workspace.agentSettings,
          projectDir,
          taskId,
        },
      ),
    );
  };
}
