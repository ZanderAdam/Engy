'use client';

import { trpc } from '@/lib/trpc';
import { RiQuestionLine } from '@remixicon/react';

interface QuestionListProps {
  onSelectTask?: (taskId: number) => void;
}

export function QuestionList({ onSelectTask }: QuestionListProps) {
  const { data: unansweredByTask } = trpc.question.unansweredByTask.useQuery({});

  const entries = Object.entries(unansweredByTask ?? {}).map(([taskId, count]) => ({
    taskId: Number(taskId),
    count: count as number,
  }));

  if (entries.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">No unanswered questions.</p>;
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry) => (
        <TaskQuestionEntry
          key={entry.taskId}
          taskId={entry.taskId}
          count={entry.count}
          onClick={() => onSelectTask?.(entry.taskId)}
        />
      ))}
    </div>
  );
}

function TaskQuestionEntry({
  taskId,
  count,
  onClick,
}: {
  taskId: number;
  count: number;
  onClick?: () => void;
}) {
  const { data: task } = trpc.task.get.useQuery({ id: taskId });
  const { data: project } = trpc.project.get.useQuery(
    { id: task?.projectId ?? 0 },
    { enabled: !!task?.projectId },
  );
  const { data: workspaces } = trpc.workspace.list.useQuery();
  const workspace = workspaces?.find((w) => w.id === project?.workspaceId);
  const slug = workspace ? `${workspace.slug}-T${taskId}` : `T-${taskId}`;

  return (
    <button
      type="button"
      className="flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
      onClick={onClick}
    >
      <RiQuestionLine className="size-3.5 shrink-0 text-amber-400" />
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{slug}</span>
      <span className="min-w-0 flex-1 truncate">{task?.title ?? `Task #${taskId}`}</span>
      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        {count}
      </span>
    </button>
  );
}
