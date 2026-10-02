import type { ComponentType } from 'react';
import { RiDraftLine, RiGitPullRequestLine } from '@remixicon/react';
import type { GhPrCiStatus } from '@engy/common';
import { prActivityAt } from '@/components/prs/pr-helpers';
import type { RouterOutputs } from '@/lib/trpc';
import { EVENT_META, hasAvatar, summarizeEvent } from './inbox-event-meta';
import { prKey, type InboxItem } from './inbox-helpers';

export type WorkspacePr = RouterOutputs['pr']['list']['prs'][number];

export interface InboxRowModel {
  key: string;
  title: string;
  repoFullName: string;
  prNumber: number;
  url: string;
  workspaceId: number | null;
  projectSlug: string | null;
  at: string;
  unread: boolean;
  snoozedUntil: string | null;
  summary: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  avatarLogin: string | null;
  risk: InboxItem['risk'];
  ci: GhPrCiStatus | undefined;
  item: InboxItem | null;
  pr: WorkspacePr | null;
}

function prReviewSummary(pr: Pick<WorkspacePr, 'isDraft' | 'reviewDecision'>): string {
  if (pr.isDraft) return 'Draft';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested';
  if (pr.reviewDecision === 'APPROVED') return 'Approved';
  return 'Waiting for review';
}

export function inboxItemToRow(item: InboxItem, pr: WorkspacePr | undefined): InboxRowModel {
  const event = item.latestEvent;
  const { icon, className } = EVENT_META[event?.kind ?? 'commented'];
  return {
    key: prKey(item.repoFullName, item.prNumber),
    title: item.title,
    repoFullName: item.repoFullName,
    prNumber: item.prNumber,
    url: item.url,
    workspaceId: item.workspaceId,
    projectSlug: item.projectSlug,
    at: item.lastEventAt,
    unread: item.unread,
    snoozedUntil: item.snoozedUntil,
    summary: summarizeEvent(event),
    icon,
    iconClassName: className,
    avatarLogin: event && hasAvatar(event) ? event.actor : null,
    risk: item.risk,
    ci: pr?.ciStatus,
    item,
    pr: pr ?? null,
  };
}

function prToRow(
  pr: WorkspacePr,
  repoFullName: string,
  workspaceId: number,
  item: InboxItem | undefined,
): InboxRowModel {
  return {
    key: prKey(repoFullName, pr.number),
    title: pr.title,
    repoFullName,
    prNumber: pr.number,
    url: pr.url,
    workspaceId,
    projectSlug: pr.projectSlug,
    at: prActivityAt(pr),
    unread: item?.unread ?? false,
    snoozedUntil: item?.snoozedUntil ?? null,
    summary: prReviewSummary(pr),
    icon: pr.isDraft ? RiDraftLine : RiGitPullRequestLine,
    iconClassName: 'text-muted-foreground',
    avatarLogin: pr.author,
    risk: item?.risk ?? null,
    ci: pr.ciStatus,
    item: item ?? null,
    pr,
  };
}

export function myPullRequestRows(
  prs: WorkspacePr[],
  items: InboxItem[],
  workspaceId: number,
): InboxRowModel[] {
  const itemByPr = new Map(items.map((item) => [prKey(item.repoFullName, item.prNumber), item]));
  return prs.filter((pr) => pr.authoredByViewer).flatMap((pr) =>
    pr.repoFullName === null
      ? []
      : [
          prToRow(
            pr,
            pr.repoFullName,
            workspaceId,
            itemByPr.get(prKey(pr.repoFullName, pr.number)),
          ),
        ],
  );
}
