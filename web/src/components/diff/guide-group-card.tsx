'use client';

import type { ReactNode } from 'react';
import { RiskBadge } from '@/components/review/risk-badge';
import { InlineCodeText } from '@/components/review/inline-code-text';
import type { ChapterRole } from '@/lib/review-summary-meta';
import { cn } from '@/lib/utils';
import type { GuideGroup } from './guide-groups';

const ROLE_LABELS: Record<ChapterRole, string> = {
  core: 'Core',
  supporting: 'Supporting',
  glue: 'Glue',
  tests: 'Tests',
};

const OTHER_TITLE = 'Other changes';

function CardSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap">{children}</p>
    </div>
  );
}

export function GuideGroupLabel({ group }: { group: GuideGroup<{ path: string }> }) {
  const { chapter } = group;
  const title = chapter?.title ?? OTHER_TITLE;
  return (
    <>
      <span className="shrink-0 tabular-nums">{group.number}</span>
      <span
        className={cn(
          'min-w-0 line-clamp-2 text-[11px] normal-case',
          chapter ? 'text-foreground/80' : 'text-muted-foreground',
        )}
        title={title}
      >
        {title}
      </span>
      <RiskBadge risk={chapter?.risk} short className="px-1 py-0" />
    </>
  );
}

interface GuideGroupCardProps {
  group: GuideGroup<{ path: string }>;
  total: number;
  className?: string;
}

export function GuideGroupCard({ group, total, className }: GuideGroupCardProps) {
  const { chapter } = group;
  const fileCount = new Set(group.files.map((f) => f.path)).size;
  return (
    <div
      data-guide-group={group.id}
      className={cn(
        'border-b border-l-2 border-b-border border-l-primary/60 bg-muted/30 px-3 py-2 text-xs text-foreground/90',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular-nums text-muted-foreground">
          Group {group.number} of {total}
        </span>
        {chapter?.role && (
          <span className="border border-border px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {ROLE_LABELS[chapter.role]}
          </span>
        )}
        <span className="text-sm font-medium text-foreground">{chapter?.title ?? OTHER_TITLE}</span>
        <RiskBadge risk={chapter?.risk} />
        <span className="ml-auto text-[10px] text-muted-foreground">
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>
      </div>
      {!chapter && (
        <p className="mt-1 text-muted-foreground">Files the review did not put in a group.</p>
      )}
      {chapter?.explanation && (
        <p className="mt-1 whitespace-pre-wrap">
          <InlineCodeText text={chapter.explanation} />
        </p>
      )}
      {chapter?.systemContext && (
        <CardSection label="How it fits">
          <InlineCodeText text={chapter.systemContext} />
        </CardSection>
      )}
      {chapter?.note && (
        <CardSection label="Check">
          <InlineCodeText text={chapter.note} />
        </CardSection>
      )}
      {chapter?.risk?.reason && (
        <CardSection label="Risk">
          <InlineCodeText text={chapter.risk.reason} />
        </CardSection>
      )}
    </div>
  );
}
