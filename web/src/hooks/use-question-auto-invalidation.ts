import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';

export function useQuestionAutoInvalidation(): void {
  const utils = trpc.useUtils();

  useOnServerEvent('QUESTION_CHANGE', () => {
    utils.question.list.invalidate();
    utils.question.unansweredCount.invalidate();
    utils.question.unansweredByTask.invalidate();
    // Question events imply task state changes (subStatus blocked/unblocked)
    utils.task.list.invalidate();
    utils.task.get.invalidate();
  });
}
