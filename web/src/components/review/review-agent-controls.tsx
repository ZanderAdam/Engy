'use client';

import { RiLoader4Line, RiRobot2Line } from '@remixicon/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ReviewGuideControl } from '@/components/diff/review-guide-control';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { buildReviewPath } from '@/lib/review-path';
import { trpc } from '@/lib/trpc';

interface ReviewAgentControlsProps {
  workspaceId: number;
  workspaceSlug: string;
  repoFullName: string;
  prNumber: number;
  projectSlug: string | null;
}

export function ReviewAgentControls({
  workspaceId,
  workspaceSlug,
  repoFullName,
  prNumber,
  projectSlug,
}: ReviewAgentControlsProps) {
  const navigate = useVirtualNavigate();
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
      {projects.length > 0 && (
        <Select
          value={projectSlug ?? undefined}
          onValueChange={(slug) =>
            navigate.push(buildReviewPath(workspaceSlug, repoFullName, prNumber, slug))
          }
        >
          <SelectTrigger size="sm" className="h-6 min-w-28 text-xs" aria-label="Project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.slug}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {project && (
        <ReviewGuideControl project={{ id: project.id, workspaceSlug, slug: project.slug }} />
      )}
      <Button
        variant="outline"
        size="xs"
        disabled={startReview.isPending}
        onClick={() =>
          startReview.mutate({
            workspaceId,
            repoFullName,
            prNumber,
            projectSlug: projectSlug ?? undefined,
          })
        }
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
