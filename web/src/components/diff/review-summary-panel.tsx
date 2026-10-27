'use client';

import { useState, useSyncExternalStore } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine, RiRobot2Line } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/review/markdown-view';
import { InlineCodeText } from '@/components/review/inline-code-text';
import { RiskBadge } from '@/components/review/risk-badge';
import { createPersistentToggle } from '@/lib/persistent-value';
import { commentBodyText } from './agent-findings';
import { ReviewGuideControl, type GuideProject } from './review-guide-control';
import type { DiffComment } from './use-diff-comments';

const summaryCollapsed = createPersistentToggle('engy:review-summary-collapsed:v1', false);

interface ReviewSummaryPanelProps {
  summary: DiffComment | null;
  findingCount: number;
  groupCount: number;
  onDelete?: (threadId: string) => void;
  guideProject?: GuideProject;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The review read before any file. Sits above the stack rather than in a tab so
 * it is on the way to the diff instead of somewhere to navigate to.
 */
export function ReviewSummaryPanel({
  summary,
  findingCount,
  groupCount,
  onDelete,
  guideProject,
}: ReviewSummaryPanelProps) {
  const collapsed = useSyncExternalStore(
    summaryCollapsed.subscribe,
    summaryCollapsed.get,
    summaryCollapsed.getServerSnapshot,
  );
  const [notesOpen, setNotesOpen] = useState(false);

  if (!summary) return null;

  const Chevron = collapsed ? RiArrowRightSLine : RiArrowDownSLine;
  const NotesChevron = notesOpen ? RiArrowDownSLine : RiArrowRightSLine;
  const { risk, overview } = summary;
  const notes = (
    <MarkdownView
      markdown={commentBodyText(summary.comments[0]?.body)}
      className="[&_.bn-block-content]:!text-xs [&_h1]:!text-sm [&_h2]:!text-xs [&_h3]:!text-xs"
    />
  );

  return (
    <div className="shrink-0 border-b border-border bg-muted/20">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => summaryCollapsed.set(!collapsed)}
          className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-3.5 shrink-0" />
          <RiRobot2Line className="size-3.5 shrink-0" />
          <span className="font-medium">{groupCount > 0 ? 'Guided review' : 'Review summary'}</span>
        </button>
        <span className="whitespace-nowrap text-[10px] text-muted-foreground/60">
          {groupCount > 0 && `${plural(groupCount, 'group')} · `}
          {findingCount === 0
            ? 'no findings anchored'
            : `${plural(findingCount, 'finding')} on the diff`}
        </span>
        <RiskBadge risk={risk} className="py-0.5" />
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
      {!collapsed && (
        <div className="max-h-[40dvh] overflow-y-auto px-3 pb-3 pl-9 text-xs text-foreground/90">
          {overview && (
            <p className="mb-1.5 whitespace-pre-wrap text-sm">
              <InlineCodeText text={overview} />
            </p>
          )}
          {risk?.reason && (
            <p className="mb-2 whitespace-pre-wrap text-muted-foreground">
              <InlineCodeText text={risk.reason} />
            </p>
          )}
          {overview ? (
            <>
              <button
                type="button"
                onClick={() => setNotesOpen((open) => !open)}
                aria-expanded={notesOpen}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <NotesChevron className="size-3.5 shrink-0" />
                Review notes
              </button>
              {notesOpen && notes}
            </>
          ) : (
            notes
          )}
        </div>
      )}
    </div>
  );
}
