import { taskPlanSlug } from '@/lib/plan-naming';
import { isClosedTaskStatus } from '@/lib/task-status';

export type BulkTask = { id: number; needsPlan: boolean };
type TaskPlans = Record<number, string>;

export function selectedVisibleTasks<T extends { id: number }>(
  visibleTasks: T[],
  selectedIds: ReadonlySet<number>,
): T[] {
  return visibleTasks.filter((task) => selectedIds.has(task.id));
}

export function openTasks<T extends { status: string }>(tasks: T[]): T[] {
  return tasks.filter((task) => !isClosedTaskStatus(task.status));
}

export function formatTaskCount(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

export function formatTaskSlugs(workspaceSlug: string, taskIds: number[]): string {
  return taskIds.map((id) => taskPlanSlug(workspaceSlug, id)).join(', ');
}

export function tasksMissingPlan<T extends BulkTask>(tasks: T[], taskPlans: TaskPlans): T[] {
  return tasks.filter((task) => task.needsPlan && !taskPlans[task.id]);
}

export function buildBulkImplementPrompt(opts: {
  implementSkill: string;
  workspaceSlug: string;
  projectDir: string;
  tasks: BulkTask[];
  taskPlans: TaskPlans;
}): string {
  const { implementSkill, workspaceSlug, projectDir, tasks, taskPlans } = opts;
  const slugs = formatTaskSlugs(
    workspaceSlug,
    tasks.map((task) => task.id),
  );
  const planNotes = tasks
    .filter((task) => task.needsPlan && taskPlans[task.id])
    .map((task) => {
      const slug = taskPlanSlug(workspaceSlug, task.id);
      return `${slug} plan at ${projectDir}/${taskPlans[task.id]}`;
    });
  const prompt = `Use ${implementSkill} for tasks: ${slugs}`;
  return planNotes.length > 0 ? `${prompt}, ${planNotes.join(', ')}` : prompt;
}
