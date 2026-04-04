"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { useOnFileChange } from "@/contexts/events-context";
import { useTaskSelection } from "@/hooks/use-task-selection";
import { TaskDialog } from "@/components/projects/task-dialog";
import { BulkActionBar } from "@/components/projects/bulk-action-bar";
import { GroupFromSelectionDialog } from "@/components/projects/group-from-selection-dialog";
import { AssignMilestoneDialog } from "@/components/projects/assign-milestone-dialog";
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

export default function TasksPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
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

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
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
            utils.project.getBySlug.invalidate({
              workspaceId: workspace?.id ?? 0,
              slug: defaultProject?.slug ?? 'default',
            });

            if (eventType !== 'unlink') {
              toast(`Plan ready for ${taskSlug}`, {
                action: {
                  label: 'Review',
                  onClick: () => {
                    router.push(
                      `/w/${params.workspace}/docs?file=projects/default/plans/${taskSlug}.plan.md`,
                    );
                  },
                },
              });
            }
          }, DEBOUNCE_MS),
        );
      },
      [utils, router, params.workspace, workspace?.id, defaultProject?.slug],
    ),
  );

  const visibleTaskIds = useMemo(() => (tasks ?? []).map((t) => t.id), [tasks]);

  function handleSelectAll() {
    if (selection.selectedCount === visibleTaskIds.length) {
      selection.clear();
    } else {
      selection.selectAll(visibleTaskIds);
    }
  }

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
          <Button variant="outline" size="sm" onClick={() => setShowNewTask(true)}>
            <RiAddLine data-icon="inline-start" />
            New Task
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

      <EisenhowerMatrix
        tasks={tasks ?? []}
        projectSlug={defaultProject.slug}
        onTaskClick={selection.isSelecting ? undefined : setSelectedTaskId}
        selectable={selection.isSelecting}
        selectedIds={selection.selectedIds}
        onTaskSelect={selection.toggle}
      />

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
        projectId={defaultProject.id}
        open={showNewTask}
        onOpenChange={setShowNewTask}
        onCreated={() => {
          setShowNewTask(false);
          utils.task.list.invalidate();
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
