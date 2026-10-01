'use client';

import { useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { commentBodyText } from './agent-findings';
import { RISK_PRESENTATION, type ReviewGuideSource } from './review-summary-meta';
import type { DiffComment } from './use-diff-comments';

interface ReviewSummaryPanelProps {
  summary: DiffComment | null;
  findingCount: number;
  onDelete?: (threadId: string) => void;
  onSelectFile?: (path: string) => void;
  guideProject?: GuideProject;
}

interface GuideProject {
  id: number;
  workspaceSlug: string;
  slug: string;
}

function ReviewGuideControl({
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

  return (
    <>
      {source && (
        <span className="text-[10px] text-muted-foreground/60">
          Guide: {source === 'project' ? 'review-guide.md' : 'default'}
        </span>
      )}
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

/**
 * The review read before any file. Sits above the stack rather than in a tab so
 * it is on the way to the diff instead of somewhere to navigate to.
 */
export function ReviewSummaryPanel({
  summary,
  findingCount,
  onDelete,
  onSelectFile,
  guideProject,
}: ReviewSummaryPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!summary) return null;

  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;
  const { risk, readingOrder } = summary;
  const riskPresentation = risk ? RISK_PRESENTATION[risk.level] : null;

  return (
    <div className="border-b border-border bg-muted/20">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-3.5 shrink-0" />
          <RiRobot2Line className="size-3.5 shrink-0" />
          <span className="font-medium">Review summary</span>
        </button>
        <span className="text-[10px] text-muted-foreground/60">
          {findingCount === 0
            ? 'no findings anchored'
            : `${findingCount} finding${findingCount === 1 ? '' : 's'} on the diff`}
        </span>
        {riskPresentation && (
          <span
            className={cn(
              'border px-1.5 py-0.5 text-[10px] font-medium',
              riskPresentation.className,
            )}
          >
            {riskPresentation.label}
          </span>
        )}
        <span className="ml-auto" />
        {guideProject && <ReviewGuideControl source={summary.guide} project={guideProject} />}
        {onDelete && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => onDelete(summary.threadId)}
          >
            Delete
          </Button>
        )}
      </div>
      <div
        className={cn(
          'whitespace-pre-wrap px-3 pb-3 pl-9 text-xs text-foreground/90',
          collapsed && 'hidden',
        )}
      >
        {risk?.reason && <p className="mb-2 text-muted-foreground">{risk.reason}</p>}
        {commentBodyText(summary.comments[0]?.body)}
        {readingOrder && readingOrder.length > 0 && (
          <ol className="mt-3 list-decimal space-y-2 whitespace-normal pl-4">
            {readingOrder.map((chapter, index) => (
              <li key={`${index}-${chapter.title}`}>
                <span className="font-medium">{chapter.title}</span>
                {chapter.note && <span className="text-muted-foreground"> — {chapter.note}</span>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {chapter.files.map((file) => (
                    <button
                      key={file}
                      type="button"
                      disabled={!onSelectFile}
                      onClick={() => onSelectFile?.(file)}
                      className="font-mono text-[11px] text-foreground/80 underline-offset-2 hover:underline"
                    >
                      {file}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
