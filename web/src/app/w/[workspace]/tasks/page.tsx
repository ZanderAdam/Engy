"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { TaskDialog } from "@/components/projects/task-dialog";
import { Button } from "@/components/ui/button";
import { RiAddLine } from "@remixicon/react";

export default function TasksPage() {
  const params = useParams<{ workspace: string }>();
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: allProjects } = trpc.project.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );

  const defaultProject = allProjects?.find((p) => p.isDefault);

  const { data: projectDetails } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: defaultProject?.slug ?? '' },
    { enabled: !!workspace && !!defaultProject },
  );

  const { data: tasks } = trpc.task.list.useQuery(
    { projectId: defaultProject?.id ?? 0 },
    { enabled: !!defaultProject },
  );

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);

  const utils = trpc.useUtils();

  if (!workspace || !defaultProject) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <Button variant="outline" size="sm" onClick={() => setShowNewTask(true)}>
          <RiAddLine data-icon="inline-start" />
          New Task
        </Button>
      </div>

      <EisenhowerMatrix
        tasks={tasks ?? []}
        workspaceSlug={params.workspace}
        projectDir={projectDetails?.projectDir}
        planSlugs={projectDetails?.planSlugs}
        repos={workspace.repos ?? undefined}
        onTaskClick={setSelectedTaskId}
      />

      {selectedTaskId !== null && (
        <TaskDialog
          mode="edit"
          taskId={selectedTaskId}
          open
          onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        />
      )}

      <TaskDialog
        mode="create"
        projectId={defaultProject.id}
        open={showNewTask}
        onOpenChange={setShowNewTask}
        onCreated={() => {
          setShowNewTask(false);
          utils.task.list.invalidate();
        }}
      />
    </div>
  );
}
