'use client';

import { RiCheckboxLine, RiFileTextLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { useTabId } from '@/components/tabs/tab-context';
import { terminalTaskSlug, taskOpenDetail } from './terminal-task-actions.helpers';

interface Props {
  taskIds: number[];
  workspaceSlug: string;
}

export function TerminalTaskActions({ taskIds, workspaceSlug }: Props) {
  const tabId = useTabId();
  const [primaryTaskId, ...otherTaskIds] = taskIds;
  const { data: task } = trpc.task.get.useQuery({ id: primaryTaskId });

  const openTask = (taskId: number, tab?: 'plan') => {
    window.dispatchEvent(
      new CustomEvent('task:open', { detail: taskOpenDetail({ taskId, tabId, tab }) }),
    );
  };

  return (
    <>
      <TaskSlugButton
        taskId={primaryTaskId}
        workspaceSlug={workspaceSlug}
        onOpen={() => openTask(primaryTaskId)}
      />
      <button
        type="button"
        aria-label="View plan"
        onClick={() => openTask(primaryTaskId, 'plan')}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <RiFileTextLine className="size-3.5" />
        View plan
      </button>
      {task?.title && <span className="ml-2 truncate text-muted-foreground">{task.title}</span>}
      {otherTaskIds.length > 0 && (
        <span className="ml-2 flex shrink-0 items-center gap-1 text-muted-foreground">
          also
          {otherTaskIds.map((taskId) => (
            <TaskSlugButton
              key={taskId}
              taskId={taskId}
              workspaceSlug={workspaceSlug}
              onOpen={() => openTask(taskId)}
            />
          ))}
        </span>
      )}
    </>
  );
}

function TaskSlugButton({
  taskId,
  workspaceSlug,
  onOpen,
}: {
  taskId: number;
  workspaceSlug: string;
  onOpen: () => void;
}) {
  const slug = terminalTaskSlug(workspaceSlug, taskId);
  return (
    <button
      type="button"
      aria-label={`Open task ${slug}`}
      onClick={onOpen}
      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
    >
      <RiCheckboxLine className="size-3.5" />
      {slug}
    </button>
  );
}
