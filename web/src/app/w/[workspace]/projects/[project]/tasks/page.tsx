"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useVirtualParams,
  useVirtualNavigate,
  useVirtualSearchParams,
} from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { ViewToggle, type TaskView } from "@/components/projects/task-views/view-toggle";
import { DependencyGraph } from "@/components/projects/task-views/dependency-graph";
import { KanbanBoard } from "@/components/projects/task-views/kanban-board";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { TaskGroupForm } from "@/components/projects/task-group-form";
import {
  TaskPageDialogs,
  TaskSelectionBar,
  useTaskPageController,
} from "@/components/projects/task-page-controller";
import {
  TaskFilter,
  applyTaskFilters,
  emptyFilters,
  DEFAULT_DONE_LIMIT,
  type TaskFilters,
} from "@/components/projects/task-filter";
import { Button } from "@/components/ui/button";
import { RiAddLine, RiCheckboxMultipleLine } from "@remixicon/react";

export default function ProjectTasksPage() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const nav = useVirtualNavigate();
  const searchParams = useVirtualSearchParams();

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
  const { data: taskGroups } = trpc.taskGroup.list.useQuery({});

  const filters: TaskFilters = useMemo(() => {
    const base = emptyFilters();
    const status = searchParams.get("status")?.split(",").filter(Boolean) ?? [];
    const typeParam = searchParams.get("type");
    const type = typeParam !== null ? typeParam.split(",").filter(Boolean) : [];
    const groupId =
      searchParams
        .get("group")
        ?.split(",")
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite) ?? [];
    const milestoneRef =
      searchParams.get("milestone")?.split(",").filter(Boolean) ?? [];
    const unassignedParam = searchParams.get("unassigned");
    const unassignedOnly = unassignedParam !== null ? unassignedParam !== "0" : base.unassignedOnly;
    const doneLimitParam = searchParams.get("doneLimit");
    const doneLimit = doneLimitParam !== null ? Number(doneLimitParam) : base.doneLimit;
    const planStatus =
      searchParams.get("planStatus")?.split(",").filter(Boolean) ?? [];
    return { status, type, groupId, milestoneRef, unassignedOnly, doneLimit, planStatus };
  }, [searchParams]);

  const filteredTasks = useMemo(
    () => applyTaskFilters(tasks ?? [], filters),
    [tasks, filters],
  );

  const activeMilestones = useMemo(() => {
    if (!milestones || !tasks) return [];
    const nonDoneByMilestone = new Set(
      tasks.filter((t) => t.status !== "done" && t.milestoneRef).map((t) => t.milestoneRef),
    );
    return milestones.filter((m) => nonDoneByMilestone.has(m.ref));
  }, [milestones, tasks]);

  const activeGroups = useMemo(() => {
    if (!taskGroups || !tasks) return [];
    const nonDoneByGroup = new Set(
      tasks.filter((t) => t.status !== "done" && t.taskGroupId).map((t) => t.taskGroupId),
    );
    return taskGroups.filter((g) => nonDoneByGroup.has(g.id));
  }, [taskGroups, tasks]);

  const [showNewGroup, setShowNewGroup] = useState(false);

  const utils = trpc.useUtils();

  const controller = useTaskPageController({
    planReviewUrl: useCallback(
      (taskSlug: string) =>
        `/w/${params.workspace}/projects/${params.project}/docs?file=plans/${taskSlug}.plan.md`,
      [params.workspace, params.project],
    ),
    onPlanChange: useCallback(() => {
      utils.project.getBySlug.invalidate();
    }, [utils]),
  });
  const { selection } = controller;

  const basePath = `/w/${params.workspace}/projects/${params.project}/tasks`;

  function replaceParams(updater: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(searchParams.toString());
    updater(p);
    const qs = p.toString();
    nav.push(qs ? `${basePath}?${qs}` : basePath);
  }

  function handleViewChange(view: TaskView) {
    replaceParams((p) => p.set("view", view));
  }

  function handleFilterChange(next: TaskFilters) {
    replaceParams((p) => {
      if (next.status.length > 0) p.set("status", next.status.join(","));
      else p.delete("status");
      if (next.type.length > 0) p.set("type", next.type.join(","));
      else p.delete("type");
      if (next.groupId.length > 0) p.set("group", next.groupId.join(","));
      else p.delete("group");
      if (next.milestoneRef.length > 0) p.set("milestone", next.milestoneRef.join(","));
      else p.delete("milestone");
      if (!next.unassignedOnly) p.set("unassigned", "0");
      else p.delete("unassigned");
      if (next.doneLimit !== DEFAULT_DONE_LIMIT) p.set("doneLimit", String(next.doneLimit));
      else p.delete("doneLimit");
      if (next.planStatus.length > 0) p.set("planStatus", next.planStatus.join(","));
      else p.delete("planStatus");
    });
  }

  const visibleTaskIds = useMemo(() => filteredTasks.map((t) => t.id), [filteredTasks]);

  if (!workspace || !project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-2">
          <ViewToggle value={currentView} onChange={handleViewChange} />
          <TaskFilter
            value={filters}
            onChange={handleFilterChange}
            groups={activeGroups}
            milestones={activeMilestones}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          {currentView !== "graph" && (
            <Button
              size="sm"
              variant={selection.isSelecting ? "default" : "outline"}
              onClick={selection.isSelecting ? selection.exitSelectMode : selection.enterSelectMode}
            >
              <RiCheckboxMultipleLine data-icon="inline-start" />
              Select
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowNewGroup(true)}>
            <RiAddLine data-icon="inline-start" />
            Group
          </Button>
          <Button size="sm" variant="outline" onClick={() => controller.setShowNewTask(true)}>
            <RiAddLine data-icon="inline-start" />
            Task
          </Button>
        </div>
      </div>

      <TaskSelectionBar controller={controller} visibleTaskIds={visibleTaskIds} />

      {currentView === "graph" && (
        <DependencyGraph tasks={filteredTasks} onTaskClick={controller.setSelectedTaskId} />
      )}

      {currentView === "kanban" && (
        <KanbanBoard
          tasks={filteredTasks}
          onTaskClick={selection.isSelecting ? undefined : controller.setSelectedTaskId}
          doneLimit={filters.doneLimit}
          selectable={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onTaskSelect={selection.toggle}
        />
      )}

      {currentView === "eisenhower" && (
        <EisenhowerMatrix
          tasks={filteredTasks}
          onTaskClick={selection.isSelecting ? undefined : controller.setSelectedTaskId}
          selectable={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onTaskSelect={selection.toggle}
        />
      )}

      <TaskGroupForm
        milestones={milestones ?? []}
        open={showNewGroup}
        onOpenChange={setShowNewGroup}
        onCreated={() => {
          setShowNewGroup(false);
          utils.taskGroup.list.invalidate();
        }}
      />

      <TaskPageDialogs
        controller={controller}
        milestones={milestones ?? []}
        createProjectId={project.id}
      />
    </div>
  );
}
