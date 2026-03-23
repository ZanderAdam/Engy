import { toast } from 'sonner';
import { useOnServerEvent } from '@/contexts/events-context';
import { trpc } from '@/lib/trpc';

export function useQuestionAutoInvalidation(): void {
  const utils = trpc.useUtils();

  useOnServerEvent('QUESTION_CHANGE', (payload) => {
    utils.question.list.invalidate();
    utils.question.unansweredCount.invalidate();
    utils.question.unansweredByTask.invalidate();
    // Question events imply task state changes (subStatus blocked/unblocked)
    utils.task.list.invalidate();
    utils.task.get.invalidate();

    if (payload.action === 'created') {
      toast.info('An agent is waiting for your input', {
        description: 'Click the ? icon in the header to answer',
        duration: 10_000,
      });
    }
  });
}
