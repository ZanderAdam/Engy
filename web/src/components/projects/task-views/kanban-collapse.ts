import type { TaskStatus } from '@/lib/task-status';

// An explicit user toggle (override) always wins. Otherwise backlog and empty
// lanes collapse by default. The hasAnyTasks guard prevents every lane from
// collapsing while the board is still loading (all counts momentarily 0).
export function laneCollapsed(
  status: TaskStatus,
  count: number,
  override: boolean | undefined,
  hasAnyTasks: boolean,
): boolean {
  if (override !== undefined) return override;
  return status === 'backlog' || (hasAnyTasks && count === 0);
}
