"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RiAddLine } from "@remixicon/react";
import { TaskDialog } from "@/components/projects/task-dialog";
import { TaskCard } from "@/components/projects/task-card";

interface SpecTasksProps {
  specSlug: string;
  workspaceSlug: string;
  projectDir?: string | null;
  planSlugs?: string[];
}

export function SpecTasks({ specSlug: specId, workspaceSlug, projectDir, planSlugs }: SpecTasksProps) {
  const utils = trpc.useUtils();
  const [showNewTask, setShowNewTask] = useState(false);

  const { data: tasks, isLoading } = trpc.task.listBySpecId.useQuery({
    specId,
  });

  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      utils.task.listBySpecId.invalidate({ specId });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-xs text-muted-foreground">Loading tasks...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tasks ({tasks?.length ?? 0})
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowNewTask(true)}>
          <RiAddLine data-icon="inline-start" />
          New Task
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {tasks?.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No tasks yet. Add tasks to track work for this spec.
            </p>
          )}
          {tasks?.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              workspaceSlug={workspaceSlug}
              projectDir={projectDir}
              planSlugs={planSlugs}
              showCheckbox
              onCheckboxChange={(done) =>
                updateMutation.mutate({
                  id: task.id,
                  status: done ? "done" : "todo",
                })
              }
              className="rounded px-3"
            />
          ))}
        </div>
      </ScrollArea>
      <TaskDialog
        mode="create"
        specId={specId}
        open={showNewTask}
        onOpenChange={setShowNewTask}
        onCreated={() => {
          setShowNewTask(false);
          utils.task.listBySpecId.invalidate({ specId });
        }}
      />
    </div>
  );
}
