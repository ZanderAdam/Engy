"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ViewToggle, type TaskView } from "@/components/projects/task-views/view-toggle";
import { DependencyGraph } from "@/components/projects/task-views/dependency-graph";
import { KanbanBoard } from "@/components/projects/task-views/kanban-board";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { useOnFileChange } from "@/contexts/events-context";
import { useTaskSelection } from "@/hooks/use-task-selection";
import { TaskDialog } from "@/components/projects/task-dialog";
import { TaskGroupForm } from "@/components/projects/task-group-form";
import { BulkActionBar } from "@/components/projects/bulk-action-bar";
import { GroupFromSelectionDialog } from "@/components/projects/group-from-selection-dialog";
import { AssignMilestoneDialog } from "@/components/projects/assign-milestone-dialog";
import {
  TaskFilter,
  applyTaskFilters,
  emptyFilters,
  DEFAULT_DONE_LIMIT,
  type TaskFilters,
} from "@/components/projects/task-filter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RiAddLine, RiCheckboxMultipleLine } from "@remixicon/react";

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
  const { data: taskGroups } = trpc.taskGroup.list.useQuery({});

  const filters: TaskFilters = useMemo(() => {
    const base = emptyFilters();
    const status = searchParams.get("status")?.split(",").filter(Boolean) ?? [];
    const typeParam = searchParams.get("type");
    const type = typeParam !== null
      ? typeParam.split(",").filter(Boolean)
      : currentView === "eisenhower" ? ["human"] : [];
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
  }, [searchParams, currentView]);

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

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showMilestoneDialog, setShowMilestoneDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const selection = useTaskSelection();

  const utils = trpc.useUtils();

  const bulkDelete = trpc.task.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`Deleted ${data.deleted} tasks`);
      utils.task.list.invalidate();
      utils.task.get.invalidate();
      selection.exitSelectMode();
      setShowDeleteConfirm(false);
    },
  });

  const startBatch = trpc.execution.startBatchExecution.useMutation({
    onSuccess: () => {
      toast.success('Batch execution started');
      utils.task.list.invalidate();
      utils.execution.getSessionStatus.invalidate();
      utils.execution.getActiveSessions.invalidate();
      selection.exitSelectMode();
    },
    onError: (err) => {
      toast.error('Failed to start batch execution', { description: err.message });
    },
  });
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

  const basePath = `/w/${params.workspace}/projects/${params.project}/tasks`;

  function replaceParams(updater: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(searchParams.toString());
    updater(p);
    router.replace(`${basePath}?${p.toString()}`, { scroll: false });
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

  function handleSelectAll() {
    if (selection.selectedCount === visibleTaskIds.length) {
      selection.clear();
    } else {
      selection.selectAll(visibleTaskIds);
    }
  }

  if (!workspace || !project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ViewToggle value={currentView} onChange={handleViewChange} />
          <TaskFilter
            value={filters}
            onChange={handleFilterChange}
            groups={activeGroups}
            milestones={activeMilestones}
          />
        </div>
        <div className="flex gap-2">
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
          <Button size="sm" variant="outline" onClick={() => setShowNewTask(true)}>
            <RiAddLine data-icon="inline-start" />
            Task
          </Button>
        </div>
      </div>

      {selection.isSelecting && (
        <BulkActionBar
          selectedCount={selection.selectedCount}
          totalCount={visibleTaskIds.length}
          onSelectAll={handleSelectAll}
          onGroup={() => setShowGroupDialog(true)}
          onMilestone={() => setShowMilestoneDialog(true)}
          onDelete={() => setShowDeleteConfirm(true)}
          onExecute={() => {
            if (selection.selectedIds.size > 0) {
              startBatch.mutate({ taskIds: Array.from(selection.selectedIds) });
            }
          }}
          onCancel={selection.exitSelectMode}
        />
      )}

      {currentView === "graph" && (
        <DependencyGraph tasks={filteredTasks} onTaskClick={setSelectedTaskId} />
      )}

      {currentView === "kanban" && (
        <KanbanBoard
          tasks={filteredTasks}
          onTaskClick={selection.isSelecting ? undefined : setSelectedTaskId}
          doneLimit={filters.doneLimit}
          selectable={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onTaskSelect={selection.toggle}
        />
      )}

      {currentView === "eisenhower" && (
        <EisenhowerMatrix
          tasks={filteredTasks}
          onTaskClick={selection.isSelecting ? undefined : setSelectedTaskId}
          selectable={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onTaskSelect={selection.toggle}
        />
      )}

      {selectedTaskId !== null && !selection.isSelecting && (
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

      <GroupFromSelectionDialog
        milestones={milestones ?? []}
        selectedIds={selection.selectedIds}
        open={showGroupDialog}
        onOpenChange={setShowGroupDialog}
        onComplete={() => {
          setShowGroupDialog(false);
          selection.exitSelectMode();
        }}
      />

      <AssignMilestoneDialog
        milestones={milestones ?? []}
        selectedIds={selection.selectedIds}
        open={showMilestoneDialog}
        onOpenChange={setShowMilestoneDialog}
        onComplete={() => {
          setShowMilestoneDialog(false);
          selection.exitSelectMode();
        }}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selection.selectedCount} tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected tasks will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDelete.mutate({ ids: Array.from(selection.selectedIds) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
