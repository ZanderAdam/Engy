'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import {
  useTabId,
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { parseTaskId } from '@/components/search/task-id';
import { planStemFromWatchedPath, taskSlugFromStem } from '@/lib/plan-naming';
import { useOnFileChange } from '@/contexts/events-context';
import { useTaskSelection } from '@/hooks/use-task-selection';
import { TaskDialog } from '@/components/projects/task-dialog';
import { BulkActionBar } from '@/components/projects/bulk-action-bar';
import { GroupFromSelectionDialog } from '@/components/projects/group-from-selection-dialog';
import { AssignMilestoneDialog } from '@/components/projects/assign-milestone-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const DEBOUNCE_MS = 500;

type TaskDialogTab = 'description' | 'plan' | 'execution' | 'questions' | undefined;

interface TaskPageControllerOptions {
  /** Docs URL opened by the "Review" action of the plan-ready toast. */
  planReviewUrl: (planStem: string) => string;
  /** Invalidation to run when a task's plan file changes on disk. */
  onPlanChange: () => void;
}

/**
 * State and behavior shared by the workspace- and project-level task pages:
 * task dialog routing (incl. the `task:open` window event), bulk selection
 * with its mutations, and the debounced plan-file watcher.
 */
export function useTaskPageController({ planReviewUrl, onPlanChange }: TaskPageControllerOptions) {
  const tabId = useTabId();
  const nav = useVirtualNavigate();
  const utils = trpc.useUtils();

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedTaskTab, setSelectedTaskTab] = useState<TaskDialogTab>(undefined);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showMilestoneDialog, setShowMilestoneDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const selection = useTaskSelection();

  // Deep-link: open a task when ?task=<id> is present in the URL (e.g. from
  // global search). Adjust-state-during-render so each param *change* opens the
  // dialog — including a second deep-link while the page stays mounted —
  // without overriding manual selection between changes.
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const taskParam = searchParams.get('task');
  const [lastTaskParam, setLastTaskParam] = useState<string | null>(null);
  if (taskParam !== lastTaskParam) {
    setLastTaskParam(taskParam);
    const id = parseTaskId(taskParam);
    if (id !== null) setSelectedTaskId(id);
  }

  // Strip the ?task= param (on dialog close) so the dialog doesn't reopen.
  const clearTaskParam = useCallback(() => {
    if (!searchParams.has('task')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('task');
    const query = next.toString();
    nav.push(`${pathname}${query ? `?${query}` : ''}`);
  }, [searchParams, pathname, nav]);

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

  // Cross-component signal: any quick action / card affordance can request
  // the task dialog to open on a specific tab via a `task:open` window event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: number; tab?: TaskDialogTab; tabId?: string }>)
        .detail;
      if (!detail) return;
      if (detail.tabId !== undefined && detail.tabId !== tabId) return;
      setSelectedTaskId(detail.taskId);
      setSelectedTaskTab(detail.tab);
    };
    window.addEventListener('task:open', handler);
    return () => window.removeEventListener('task:open', handler);
  }, [tabId]);

  useOnFileChange(
    useCallback(
      (filePath: string, eventType: string) => {
        const planStem = planStemFromWatchedPath(filePath);
        if (!planStem) return;

        const taskSlug = taskSlugFromStem(planStem);
        const existing = debounceTimers.current.get(planStem);
        if (existing) clearTimeout(existing);

        debounceTimers.current.set(
          planStem,
          setTimeout(() => {
            debounceTimers.current.delete(planStem);
            onPlanChange();

            if (eventType !== 'unlink') {
              toast(`Plan ready for ${taskSlug}`, {
                action: {
                  label: 'Review',
                  onClick: () => {
                    nav.push(planReviewUrl(planStem));
                  },
                },
              });
            }
          }, DEBOUNCE_MS),
        );
      },
      [nav, planReviewUrl, onPlanChange],
    ),
  );

  return {
    selectedTaskId,
    setSelectedTaskId,
    selectedTaskTab,
    setSelectedTaskTab,
    clearTaskParam,
    showNewTask,
    setShowNewTask,
    showGroupDialog,
    setShowGroupDialog,
    showMilestoneDialog,
    setShowMilestoneDialog,
    showDeleteConfirm,
    setShowDeleteConfirm,
    selection,
    bulkDelete,
    startBatch,
  };
}

type TaskPageController = ReturnType<typeof useTaskPageController>;

interface TaskSelectionBarProps {
  controller: TaskPageController;
  visibleTaskIds: number[];
}

/** Bulk-action bar shown while task selection mode is active. */
export function TaskSelectionBar({ controller, visibleTaskIds }: TaskSelectionBarProps) {
  const { selection, startBatch } = controller;
  if (!selection.isSelecting) return null;

  function handleSelectAll() {
    if (selection.selectedCount === visibleTaskIds.length) {
      selection.clear();
    } else {
      selection.selectAll(visibleTaskIds);
    }
  }

  return (
    <BulkActionBar
      selectedCount={selection.selectedCount}
      totalCount={visibleTaskIds.length}
      onSelectAll={handleSelectAll}
      onGroup={() => controller.setShowGroupDialog(true)}
      onMilestone={() => controller.setShowMilestoneDialog(true)}
      onDelete={() => controller.setShowDeleteConfirm(true)}
      onExecute={() => {
        if (selection.selectedIds.size > 0) {
          startBatch.mutate({ taskIds: Array.from(selection.selectedIds) });
        }
      }}
      onCancel={selection.exitSelectMode}
    />
  );
}

interface TaskPageDialogsProps {
  controller: TaskPageController;
  milestones: Array<{ ref: string; title: string }>;
  /** Project the create-task dialog targets. */
  createProjectId: number;
}

/** Dialog stack shared by the task pages: edit, create, group, milestone, delete. */
export function TaskPageDialogs({ controller, milestones, createProjectId }: TaskPageDialogsProps) {
  const utils = trpc.useUtils();
  const { selection } = controller;

  return (
    <>
      {controller.selectedTaskId !== null && !selection.isSelecting && (
        <TaskDialog
          mode="edit"
          taskId={controller.selectedTaskId}
          initialTab={controller.selectedTaskTab}
          open
          onOpenChange={(open) => {
            if (!open) {
              controller.setSelectedTaskId(null);
              controller.setSelectedTaskTab(undefined);
              controller.clearTaskParam();
            }
          }}
        />
      )}

      <TaskDialog
        mode="create"
        projectId={createProjectId}
        open={controller.showNewTask}
        onOpenChange={controller.setShowNewTask}
        onCreated={() => {
          controller.setShowNewTask(false);
          utils.task.list.invalidate();
        }}
      />

      <GroupFromSelectionDialog
        milestones={milestones}
        selectedIds={selection.selectedIds}
        open={controller.showGroupDialog}
        onOpenChange={controller.setShowGroupDialog}
        onComplete={() => {
          controller.setShowGroupDialog(false);
          selection.exitSelectMode();
        }}
      />

      <AssignMilestoneDialog
        milestones={milestones}
        selectedIds={selection.selectedIds}
        open={controller.showMilestoneDialog}
        onOpenChange={controller.setShowMilestoneDialog}
        onComplete={() => {
          controller.setShowMilestoneDialog(false);
          selection.exitSelectMode();
        }}
      />

      <AlertDialog
        open={controller.showDeleteConfirm}
        onOpenChange={controller.setShowDeleteConfirm}
      >
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
                controller.bulkDelete.mutate({ ids: Array.from(selection.selectedIds) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
