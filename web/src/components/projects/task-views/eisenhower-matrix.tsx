"use client";

import { TaskCard } from "@/components/projects/task-card";

type Task = {
  id: number;
  title: string;
  status: string;
  type: string;
  importance: string | null;
  urgency: string | null;
};

type Quadrant = {
  label: string;
  importance: string;
  urgency: string;
};

const quadrants: Quadrant[] = [
  { label: "Urgent + Important", importance: "important", urgency: "urgent" },
  { label: "Not Urgent + Important", importance: "important", urgency: "not_urgent" },
  { label: "Urgent + Not Important", importance: "not_important", urgency: "urgent" },
  {
    label: "Not Urgent + Not Important",
    importance: "not_important",
    urgency: "not_urgent",
  },
];

export function EisenhowerMatrix({
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
  function tasksForQuadrant(q: Quadrant) {
    return tasks.filter(
      (t) =>
        (t.importance ?? "not_important") === q.importance &&
        (t.urgency ?? "not_urgent") === q.urgency,
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-border">
      {quadrants.map((q) => {
        const items = tasksForQuadrant(q);
        return (
          <div
            key={q.label}
            className="flex min-h-0 flex-col gap-2 bg-background p-3"
          >
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{q.label}</span>
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
