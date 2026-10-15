'use client';

import { RiLoader4Line, RiRobot2Line } from '@remixicon/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { trpc } from '@/lib/trpc';
import type { GitPatchSpec } from '@engy/common';

interface LocalAgentReviewButtonProps {
  workspaceId: number;
  projectSlug: string | null;
  repoDir: string;
  worktreePath?: string;
  coderWorkspace?: string;
  reviewSpec: GitPatchSpec | null;
}

export function LocalAgentReviewButton({
  workspaceId,
  projectSlug,
  repoDir,
  worktreePath,
  coderWorkspace,
  reviewSpec,
}: LocalAgentReviewButtonProps) {
  const { focusTerminal } = useSendToTerminal();

  const startReview = trpc.review.startLocalAgentReview.useMutation({
    onSuccess: ({ sessionId }) => {
      focusTerminal(sessionId);
      toast.success('Agent review started in a new terminal', {
        action: { label: 'Show', onClick: () => focusTerminal(sessionId) },
      });
    },
    onError: (err) => toast.error(err.message),
  });

  function getTooltip() {
    if (coderWorkspace) return 'Review is not available for Coder workspaces';
    if (!reviewSpec) return 'Nothing to review yet — pick a commit or wait for the diff to load';
    return 'Start a new agent terminal that reviews the diff on screen with the project guide';
  }

  function handleClick() {
    if (!reviewSpec) return;
    startReview.mutate({
      workspaceId,
      repoDir,
      worktreePath,
      spec: reviewSpec,
      projectSlug: projectSlug ?? undefined,
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="outline"
            size="xs"
            onClick={handleClick}
            disabled={!reviewSpec || !!coderWorkspace || startReview.isPending}
          >
            {startReview.isPending ? (
              <RiLoader4Line className="size-3 animate-spin" />
            ) : (
              <RiRobot2Line className="size-3" />
            )}
            Review with agent
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{getTooltip()}</TooltipContent>
    </Tooltip>
  );
}
