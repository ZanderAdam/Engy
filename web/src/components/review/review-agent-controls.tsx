'use client';

import { RiLoader4Line, RiRobot2Line } from '@remixicon/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ReviewGuideControl } from '@/components/diff/review-guide-control';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { trpc } from '@/lib/trpc';

interface ReviewAgentControlsProps {
  workspaceId: number;
  workspaceSlug: string;
  repoFullName: string;
  prNumber: number;
  projectSlug: string;
}

export function ReviewAgentControls({
  workspaceId,
  workspaceSlug,
  repoFullName,
  prNumber,
  projectSlug,
}: ReviewAgentControlsProps) {
  const { focusTerminal } = useSendToTerminal();
  const { data: projects = [] } = trpc.project.list.useQuery({ workspaceId });
  const project = projects.find((candidate) => candidate.slug === projectSlug);

  const startReview = trpc.review.startAgentReview.useMutation({
    onSuccess: ({ sessionId }) => {
      focusTerminal(sessionId);
      toast.success(`Agent review of #${prNumber} started in a new terminal`, {
        action: { label: 'Show', onClick: () => focusTerminal(sessionId) },
      });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      {project && (
        <ReviewGuideControl project={{ id: project.id, workspaceSlug, slug: project.slug }} />
      )}
      <Button
        variant="outline"
        size="xs"
        disabled={startReview.isPending}
        onClick={() => startReview.mutate({ workspaceId, repoFullName, prNumber, projectSlug })}
      >
        {startReview.isPending ? (
          <RiLoader4Line className="size-3 animate-spin" />
        ) : (
          <RiRobot2Line className="size-3" />
        )}
        Review with agent
      </Button>
    </>
  );
}
