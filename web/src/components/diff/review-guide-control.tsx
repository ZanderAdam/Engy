'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import type { ReviewGuideSource } from './review-summary-meta';

export interface GuideProject {
  id: number;
  workspaceSlug: string;
  slug: string;
}

export function ReviewGuideControl({
  source,
  project,
}: {
  source?: ReviewGuideSource;
  project: GuideProject;
}) {
  const navigate = useVirtualNavigate();
  const utils = trpc.useUtils();
  const { data: guide } = trpc.project.reviewGuide.useQuery({ projectId: project.id });

  function openGuide() {
    navigate.push(`/w/${project.workspaceSlug}/projects/${project.slug}/docs?file=review-guide.md`);
  }

  const createGuide = trpc.project.createReviewGuide.useMutation({
    onSuccess: () => {
      void utils.project.reviewGuide.invalidate({ projectId: project.id });
      openGuide();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!guide) return null;

  const guideSource = source ?? (guide.path ? 'project' : 'default');

  return (
    <>
      <span className="text-[10px] text-muted-foreground/60">
        Guide: {guideSource === 'project' ? 'review-guide.md' : 'default'}
      </span>
      {guide.path ? (
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={openGuide}>
          Edit guide
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          disabled={createGuide.isPending}
          onClick={() => createGuide.mutate({ projectId: project.id })}
        >
          Customize for this project
        </Button>
      )}
    </>
  );
}
