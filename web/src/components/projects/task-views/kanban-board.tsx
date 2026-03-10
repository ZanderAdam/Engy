"use client";

import { TaskCard } from "@/components/projects/task-card";
import { taskStatusOptions } from "@/components/projects/task-status-badge";

type Task = {
  id: number;
  title: string;
  status: string;
  type: string;
};

const statusLabels: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const statusDotColors: Record<string, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-blue-500",
  review: "bg-yellow-500",
  done: "bg-green-500",
};

export function KanbanBoard({
  tasks,
  workspaceSlug,
  projectDir,
  planSlugs,
  onTaskClick,
}: {
  tasks: Task[];
  workspaceSlug: string;
  projectDir?: string | null;
  planSlugs?: string[];
  onTaskClick?: (taskId: number) => void;
}) {
  return (
    <div
      className="grid min-h-0 flex-1 gap-px bg-border"
      style={{ gridTemplateColumns: `repeat(${taskStatusOptions.length}, minmax(0, 1fr))` }}
    >
      {taskStatusOptions.map((status) => {
        const items = tasks.filter((t) => t.status === status);
        return (
          <div key={status} className="flex min-h-0 flex-col gap-2 bg-background p-3">
            <div className="flex shrink-0 items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusDotColors[status]}`} />
              <span className="text-xs font-medium text-muted-foreground">
                {statusLabels[status]}
              </span>
              <span className="text-xs text-muted-foreground/60">{items.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  workspaceSlug={workspaceSlug}
                  projectDir={projectDir}
                  planSlugs={planSlugs}
                  onClick={() => onTaskClick?.(task.id)}
                  className="rounded-none border border-border"
                />
              ))}
              {items.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">No tasks</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
