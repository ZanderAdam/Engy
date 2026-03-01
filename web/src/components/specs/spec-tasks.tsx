"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RiCheckboxLine,
  RiCheckboxBlankLine,
  RiRobotLine,
  RiUserLine,
} from "@remixicon/react";
import { CreateSpecTaskDialog } from "./create-spec-task-dialog";

interface SpecTasksProps {
  workspaceSlug: string;
  specSlug: string;
}

export function SpecTasks({ workspaceSlug, specSlug }: SpecTasksProps) {
  const specId = `${workspaceSlug}/${specSlug}`;
  const utils = trpc.useUtils();

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
        <CreateSpecTaskDialog
          workspaceSlug={workspaceSlug}
          specSlug={specSlug}
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {tasks?.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No tasks yet. Add tasks to track work for this spec.
            </p>
          )}
          {tasks?.map((task) => {
            const isDone = task.status === "done";
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded px-3 py-2 hover:bg-muted/50",
                  isDone && "opacity-50",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() =>
                    updateMutation.mutate({
                      id: task.id,
                      status: isDone ? "todo" : "done",
                    })
                  }
                >
                  {isDone ? (
                    <RiCheckboxLine className="size-4" />
                  ) : (
                    <RiCheckboxBlankLine className="size-4" />
                  )}
                </Button>
                <span
                  className={cn(
                    "text-sm flex-1 truncate",
                    isDone && "line-through",
                  )}
                >
                  {task.title}
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {task.type === "ai" ? (
                    <RiRobotLine className="size-3 mr-0.5" />
                  ) : (
                    <RiUserLine className="size-3 mr-0.5" />
                  )}
                  {task.type ?? "human"}
                </Badge>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
