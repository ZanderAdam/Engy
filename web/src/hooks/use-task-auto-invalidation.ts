import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';

export function useTaskAutoInvalidation(): void {
  const utils = trpc.useUtils();

  useOnServerEvent('TASK_CHANGE', () => {
    utils.task.list.invalidate();
    utils.task.get.invalidate();
    utils.task.listBySpecId.invalidate();
    utils.project.listWithProgress.invalidate();
    utils.execution.getSessionStatus.invalidate();
    utils.execution.getActiveSessions.invalidate();
  });
}
