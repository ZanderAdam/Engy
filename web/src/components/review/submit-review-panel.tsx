'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RiSendPlaneLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { diffScopePrefix } from '@/lib/diff-doc-path';
import { isGithubDraft } from '@/lib/github-draft';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

interface SubmitReviewPanelProps {
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
  repoPath: string;
  headRefName: string;
  isOwnPr: boolean;
}

const VERDICTS: Array<{ value: ReviewEvent; label: string; needsOtherAuthor: boolean }> = [
  { value: 'COMMENT', label: 'Comment', needsOtherAuthor: false },
  { value: 'APPROVE', label: 'Approve', needsOtherAuthor: true },
  { value: 'REQUEST_CHANGES', label: 'Request changes', needsOtherAuthor: true },
];

export function SubmitReviewPanel({
  workspaceId,
  repoFullName,
  prNumber,
  repoPath,
  headRefName,
  isOwnPr,
}: SubmitReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const utils = trpc.useUtils();

  const { data: threads } = trpc.comment.listThreadsByPrefix.useQuery({
    documentPathPrefix: diffScopePrefix(repoPath, headRefName),
  });
  const draftCount = useMemo(
    () =>
      (threads ?? []).filter((thread) =>
        isGithubDraft(thread.metadata as Record<string, unknown> | null),
      ).length,
    [threads],
  );

  const submit = trpc.review.submit.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.submitted === 0
          ? 'Review submitted'
          : `Review submitted with ${result.submitted} comment${result.submitted === 1 ? '' : 's'}`,
      );
      if (result.remainingDrafts > 0) {
        toast.warning(
          `${result.remainingDrafts} draft${result.remainingDrafts === 1 ? '' : 's'} could not be matched to GitHub and stayed pending`,
        );
      }
      setBody('');
      setEvent('COMMENT');
      setOpen(false);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      void utils.comment.listThreadsByPrefix.invalidate();
      void utils.review.detail.invalidate();
      void utils.inbox.invalidate();
    },
  });

  const handleSubmit = () => {
    if (submit.isPending) return;
    submit.mutate({ workspaceId, repoFullName, prNumber, event, body });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs">
          <RiSendPlaneLine className="size-3" />
          Submit review ({draftCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-3 p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Leave a review summary..."
          className="min-h-[96px] resize-none text-xs"
          autoFocus
        />
        <RadioGroup
          value={event}
          onValueChange={(value) => setEvent(value as ReviewEvent)}
          className="gap-2"
        >
          {VERDICTS.map(({ value, label, needsOtherAuthor }) => {
            const disabled = needsOtherAuthor && isOwnPr;
            return (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`review-event-${value}`} disabled={disabled} />
                <Label
                  htmlFor={`review-event-${value}`}
                  className={disabled ? 'text-muted-foreground' : undefined}
                >
                  {label}
                  {disabled && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (not on your own PR)
                    </span>
                  )}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {draftCount} pending comment{draftCount === 1 ? '' : 's'}
          </span>
          <Button size="xs" onClick={handleSubmit} disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : 'Submit review'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
