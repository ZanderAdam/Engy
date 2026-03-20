"use client";

import { useMemo } from "react";
import { TaskCard } from "@/components/projects/task-card";
import { taskStatusOptions } from "@/components/projects/task-status-badge";
import { DEFAULT_DONE_LIMIT } from "@/components/projects/task-filter";
import type { Task } from "@/components/projects/types";

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
  onTaskClick,
  doneLimit = DEFAULT_DONE_LIMIT,
}: {
  tasks: Task[];
  onTaskClick?: (taskId: number) => void;
  doneLimit?: number;
}) {
  const sortedDoneTasks = useMemo(() => {
    const doneTasks = tasks.filter((t) => t.status === "done");
    return doneTasks.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [tasks]);

  return (
    <div
      className="grid min-h-0 flex-1 gap-px bg-border"
      style={{ gridTemplateColumns: `repeat(${taskStatusOptions.length}, minmax(0, 1fr))` }}
    >
      {taskStatusOptions.map((status) => {
        const isDone = status === "done";
        const allItems = isDone ? sortedDoneTasks : tasks.filter((t) => t.status === status);
        const totalCount = allItems.length;
        const items = isDone && doneLimit > 0 ? allItems.slice(0, doneLimit) : allItems;
        const hiddenCount = totalCount - items.length;

        return (
          <div key={status} className="flex min-h-0 flex-col gap-2 bg-background p-3">
            <div className="flex shrink-0 items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusDotColors[status]}`} />
              <span className="text-xs font-medium text-muted-foreground">
                {statusLabels[status]}
              </span>
              <span className="text-xs text-muted-foreground/60">{totalCount}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskClick?.(task.id)}
                  className="rounded-none border border-border"
                />
              ))}
              {hiddenCount > 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  +{hiddenCount} more
                </p>
              )}
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
