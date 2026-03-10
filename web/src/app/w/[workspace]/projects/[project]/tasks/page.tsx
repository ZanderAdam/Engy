"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ViewToggle, type TaskView } from "@/components/projects/task-views/view-toggle";
import { DependencyGraph } from "@/components/projects/task-views/dependency-graph";
import { KanbanBoard } from "@/components/projects/task-views/kanban-board";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { useOnFileChange } from "@/contexts/file-change-context";
import { TaskDialog } from "@/components/projects/task-dialog";
import { TaskGroupForm } from "@/components/projects/task-group-form";
import { Button } from "@/components/ui/button";
import { RiAddLine } from "@remixicon/react";

const DEBOUNCE_MS = 500;

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

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  const utils = trpc.useUtils();
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useOnFileChange(
    useCallback(
      (filePath: string, eventType: string) => {
        const planMatch = filePath.match(/\/plans\/([^/]+)\.plan\.md$/);
        if (!planMatch) return;

        const taskSlug = planMatch[1];
        const existing = debounceTimers.current.get(taskSlug);
        if (existing) clearTimeout(existing);

        debounceTimers.current.set(
          taskSlug,
          setTimeout(() => {
            debounceTimers.current.delete(taskSlug);
            utils.project.getBySlug.invalidate();

            if (eventType !== 'unlink') {
              toast(`Plan ready for ${taskSlug}`, {
                action: {
                  label: 'Review',
                  onClick: () => {
                    router.push(
                      `/w/${params.workspace}/projects/${params.project}/docs?file=plans/${taskSlug}.plan.md`,
                    );
                  },
                },
              });
            }
          }, DEBOUNCE_MS),
        );
      },
      [utils, router, params.workspace, params.project],
    ),
  );

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
