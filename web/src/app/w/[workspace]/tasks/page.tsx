"use client";

import { useCallback, useMemo } from "react";
import { useVirtualParams } from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { useWatchPaths } from "@/contexts/events-context";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import {
  TaskPageDialogs,
  TaskSelectionBar,
  useTaskPageController,
} from "@/components/projects/task-page-controller";
import { planFilePathFromStem } from "@/lib/plan-naming";
import { Button } from "@/components/ui/button";
import { RiAddLine, RiCheckboxMultipleLine } from "@remixicon/react";

export default function TasksPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: allProjects } = trpc.project.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );

  const defaultProject = allProjects?.find((p) => p.isDefault);

  const { data: tasks } = trpc.task.list.useQuery(
    { projectId: defaultProject?.id ?? 0 },
    { enabled: !!defaultProject },
  );

  const { data: milestones } = trpc.milestone.list.useQuery(
    { projectId: defaultProject?.id ?? 0 },
    { enabled: !!defaultProject },
  );

  const utils = trpc.useUtils();

  // Plan-file changes only flow while this page is watching its plans dir.
  useWatchPaths(
    params.workspace,
    workspace?.resolvedDir && defaultProject?.projectDir
      ? [`${workspace.resolvedDir}/projects/${defaultProject.projectDir}/plans`]
      : [],
  );

  const controller = useTaskPageController({
    planReviewUrl: useCallback(
      (planStem: string) =>
        `/w/${params.workspace}/docs?file=projects/default/${planFilePathFromStem(planStem)}`,
      [params.workspace],
    ),
    onPlanChange: useCallback(() => {
      utils.project.getBySlug.invalidate({
        workspaceId: workspace?.id ?? 0,
        slug: defaultProject?.slug ?? "default",
      });
    }, [utils, workspace?.id, defaultProject?.slug]),
  });
  const { selection } = controller;

  const visibleTaskIds = useMemo(() => (tasks ?? []).map((t) => t.id), [tasks]);

  if (!workspace || !defaultProject) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={selection.isSelecting ? "default" : "outline"}
            onClick={selection.isSelecting ? selection.exitSelectMode : selection.enterSelectMode}
          >
            <RiCheckboxMultipleLine data-icon="inline-start" />
            Select
          </Button>
          <Button variant="outline" size="sm" onClick={() => controller.setShowNewTask(true)}>
            <RiAddLine data-icon="inline-start" />
            New Task
          </Button>
        </div>
      </div>

      <TaskSelectionBar controller={controller} visibleTaskIds={visibleTaskIds} />

      <EisenhowerMatrix
        tasks={tasks ?? []}
        projectSlug={defaultProject.slug}
        onTaskClick={selection.isSelecting ? undefined : controller.setSelectedTaskId}
        selectable={selection.isSelecting}
        selectedIds={selection.selectedIds}
        onTaskSelect={selection.toggle}
      />

      <TaskPageDialogs
        controller={controller}
        milestones={milestones ?? []}
        createProjectId={defaultProject.id}
      />
    </div>
  );
}
