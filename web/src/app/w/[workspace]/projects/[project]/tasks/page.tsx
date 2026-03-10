"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { ViewToggle, type TaskView } from "@/components/projects/task-views/view-toggle";
import { DependencyGraph } from "@/components/projects/task-views/dependency-graph";
import { KanbanBoard } from "@/components/projects/task-views/kanban-board";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { useFileChangeEvents } from "@/hooks/use-file-change-events";
import { TaskDialog } from "@/components/projects/task-dialog";
import { TaskGroupForm } from "@/components/projects/task-group-form";
import { Button } from "@/components/ui/button";
import { RiAddLine } from "@remixicon/react";

export default function ProjectTasksPage() {
  const params = useParams<{ workspace: string; project: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view") as TaskView | null;
  const currentView = viewParam ?? "kanban";

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project },
    { enabled: !!workspace },
  );
  const { data: tasks } = trpc.task.list.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );
  const { data: milestones } = trpc.milestone.list.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );

  useFileChangeEvents(params.workspace, params.project);

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  const utils = trpc.useUtils();

  function handleViewChange(view: TaskView) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("view", view);
    router.replace(
      `/w/${params.workspace}/projects/${params.project}/tasks?${p.toString()}`,
      { scroll: false },
    );
  }

  if (!workspace || !project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <ViewToggle value={currentView} onChange={handleViewChange} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowNewGroup(true)}>
            <RiAddLine data-icon="inline-start" />
            Group
          </Button>
          <Button size="sm" onClick={() => setShowNewTask(true)}>
            <RiAddLine data-icon="inline-start" />
            Task
          </Button>
        </div>
      </div>

      {currentView === "graph" && (
        <DependencyGraph
          tasks={tasks ?? []}
          workspaceSlug={params.workspace}
          projectDir={project?.projectDir}
          planSlugs={project?.planSlugs}
          repos={workspace?.repos ?? undefined}
          onTaskClick={setSelectedTaskId}
        />
      )}

      {currentView === "kanban" && (
        <KanbanBoard
          tasks={tasks ?? []}
          workspaceSlug={params.workspace}
          projectDir={project?.projectDir}
          planSlugs={project?.planSlugs}
          onTaskClick={setSelectedTaskId}
        />
      )}

      {currentView === "eisenhower" && (
        <EisenhowerMatrix
          tasks={tasks ?? []}
          workspaceSlug={params.workspace}
          projectDir={project?.projectDir}
          planSlugs={project?.planSlugs}
          repos={workspace?.repos ?? undefined}
          onTaskClick={setSelectedTaskId}
        />
      )}

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
        projectId={project.id}
        open={showNewTask}
        onOpenChange={setShowNewTask}
        onCreated={() => {
          setShowNewTask(false);
          utils.task.list.invalidate();
        }}
      />

      <TaskGroupForm
        milestones={milestones ?? []}
        open={showNewGroup}
        onOpenChange={setShowNewGroup}
        onCreated={() => {
          setShowNewGroup(false);
          utils.taskGroup.list.invalidate();
        }}
      />
    </div>
  );
}
