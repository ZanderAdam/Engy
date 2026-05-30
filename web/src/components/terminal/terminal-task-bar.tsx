'use client';

import { RiCheckboxLine, RiFileTextLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { useTabId } from '@/components/tabs/tab-context';
import { terminalTaskSlug, taskOpenDetail } from './terminal-task-bar.helpers';

interface Props {
  taskId: number;
  workspaceSlug: string;
}

export function TerminalTaskBar({ taskId, workspaceSlug }: Props) {
  const tabId = useTabId();
  const { data: task } = trpc.task.get.useQuery({ id: taskId });
  const slug = terminalTaskSlug(workspaceSlug, taskId);

  const openTask = (tab?: 'plan') => {
    window.dispatchEvent(
      new CustomEvent('task:open', { detail: taskOpenDetail({ taskId, tabId, tab }) }),
    );
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-xs">
      <button
        type="button"
        aria-label={`Open task ${slug}`}
        onClick={() => openTask()}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <RiCheckboxLine className="size-3.5" />
        {slug}
      </button>
      <button
        type="button"
        aria-label="View plan"
        onClick={() => openTask('plan')}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <RiFileTextLine className="size-3.5" />
        View plan
      </button>
      {task?.title && (
        <span className="ml-2 truncate text-muted-foreground">{task.title}</span>
      )}
    </div>
  );
}
