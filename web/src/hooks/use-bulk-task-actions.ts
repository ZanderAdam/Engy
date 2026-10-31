'use client';

import { toast } from 'sonner';
import { taskStatusLabels } from '@/components/projects/task-status-badge';
import { resolveAgentSkills } from '@/lib/agent-types';
import {
  buildBulkImplementPrompt,
  formatTaskCount,
  formatTaskSlugs,
  openTasks,
  tasksMissingPlan,
  type BulkTask,
} from '@/lib/bulk-tasks';
import { copyToClipboard } from '@/lib/clipboard';
import { trpc } from '@/lib/trpc';
import { useQuickAction } from '@/hooks/use-quick-action';
import type { TaskStatus } from '@/lib/task-status';

export type BulkActionTask = BulkTask & { status: TaskStatus };

export function useBulkTaskActions(opts: {
  projectId: number;
  projectSlug: string;
  tasks: BulkActionTask[];
  onDone: () => void;
}) {
  const { projectId, projectSlug, tasks, onDone } = opts;
  const { disabled, launch, workspace, project } = useQuickAction(projectSlug);
  const { data: plans } = trpc.project.getTaskPlans.useQuery({ projectId });

  const utils = trpc.useUtils();
  const updateTasks = trpc.task.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.task.get.invalidate();
      utils.task.list.invalidate();
    },
    onError: (err) => {
      toast.error('Failed to update task status', { description: err.message });
    },
  });

  const workspaceSlug = workspace?.slug ?? '';
  const taskIds = tasks.map((task) => task.id);
  const implementableTasks = openTasks(tasks);
  const taskPlans = plans?.taskPlans ?? {};
  const planStateLoaded = !!plans && !!workspaceSlug;
  const missingPlanSlugs = planStateLoaded
    ? formatTaskSlugs(
        workspaceSlug,
        tasksMissingPlan(implementableTasks, taskPlans).map((task) => task.id),
      )
    : '';

  const hasTasks = tasks.length > 0;
  const canCopy = hasTasks && !!workspaceSlug;
  const canImplement =
    implementableTasks.length > 0 && !disabled && planStateLoaded && !missingPlanSlugs;

  async function copyIds() {
    const copied = await copyToClipboard(formatTaskSlugs(workspaceSlug, taskIds));
    if (copied) toast.success(`Copied IDs for ${formatTaskCount(taskIds.length)}`);
    else toast.error('Failed to copy task IDs');
  }

  function changeStatus(status: TaskStatus) {
    if (!hasTasks) return;
    updateTasks.mutate(
      { ids: taskIds, status },
      {
        onSuccess: () => {
          toast.success(`Moved ${formatTaskCount(taskIds.length)} to ${taskStatusLabels[status]}`);
          onDone();
        },
      },
    );
  }

  function implementInTerminal() {
    if (!canImplement || !project?.projectDir) return;
    const { implementSkill } = resolveAgentSkills(workspace ?? {}, 'claude');
    launch({
      prompt: buildBulkImplementPrompt({
        implementSkill,
        workspaceSlug,
        projectDir: project.projectDir,
        tasks: implementableTasks,
        taskPlans,
      }),
      scopeLabel: `impl: ${formatTaskCount(implementableTasks.length)}`,
      containerMode: workspace?.containerEnabled ? 'container' : undefined,
      implementing: true,
    });
    const idsToPromote = implementableTasks
      .filter((task) => task.status === 'backlog' || task.status === 'todo')
      .map((task) => task.id);
    if (idsToPromote.length > 0) updateTasks.mutate({ ids: idsToPromote, status: 'in_progress' });
    onDone();
  }

  return {
    canCopy,
    canChangeStatus: hasTasks,
    canImplement,
    missingPlanSlugs,
    copyIds,
    changeStatus,
    implementInTerminal,
  };
}
