import type { ComponentType } from 'react';
import {
  RiDraftLine,
  RiGitClosePullRequestLine,
  RiGitMergeLine,
  RiGitPullRequestLine,
} from '@remixicon/react';
import type { GhPrCiStatus } from '@engy/common';
import { prActivityAt } from '@/components/prs/pr-helpers';
import { prStateVisual } from '@/components/prs/pr-state';
import type { RouterOutputs } from '@/lib/trpc';
import { EVENT_META, hasAvatar, summarizeEvent } from './inbox-event-meta';
import { prKey, type InboxItem } from './inbox-helpers';

export type WorkspacePr = RouterOutputs['pr']['list']['prs'][number];
export type InboxReply = RouterOutputs['inbox']['replies'][number];
export type InboxFoundPr = RouterOutputs['inbox']['searchPrs']['prs'][number];

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
  iconLabel: string;
  avatarLogin: string | null;
  requestedTeams: string[];
  risk: InboxItem['risk'];
  ci: GhPrCiStatus | undefined;
  item: InboxItem | null;
  pr: WorkspacePr | null;
  reply: InboxReply | null;
}

export function inboxItemToRow(item: InboxItem, pr: WorkspacePr | undefined): InboxRowModel {
  const event = item.latestEvent;
  const summary = summarizeEvent(event);
  const eventMeta = EVENT_META[event?.kind ?? 'commented'];
  const stateIcon = pr
    ? prStateIcon(pr)
    : { icon: eventMeta.icon, iconClassName: eventMeta.className, iconLabel: summary };
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
    summary,
    ...stateIcon,
    avatarLogin: event && hasAvatar(event) ? event.actor : null,
    requestedTeams: pr?.reviewRequestedFrom.teams ?? [],
    risk: item.risk,
    ci: pr?.ciStatus,
    item,
    pr: pr ?? null,
    reply: null,
  };
}

function prStateIcon(pr: WorkspacePr) {
  const { icon, className, label } = prStateVisual(pr);
  return { icon, iconClassName: className, iconLabel: label };
}

function prToRow(
  pr: WorkspacePr,
  repoFullName: string,
  workspaceId: number,
  item: InboxItem | undefined,
): InboxRowModel {
  const stateIcon = prStateIcon(pr);
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
    summary: stateIcon.iconLabel,
    ...stateIcon,
    avatarLogin: pr.author,
    requestedTeams: [],
    risk: item?.risk ?? null,
    ci: pr.ciStatus,
    item: item ?? null,
    pr,
    reply: null,
  };
}

export function myPullRequestRows(
  prs: WorkspacePr[],
  items: InboxItem[],
  workspaceId: number,
): InboxRowModel[] {
  const itemByPr = new Map(items.map((item) => [prKey(item.repoFullName, item.prNumber), item]));
  return prs
    .filter((pr) => pr.authoredByViewer)
    .flatMap((pr) =>
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

export function replyLocation(reply: InboxReply): string | null {
  if (!reply.path) return null;
  return reply.line === null ? reply.path : `${reply.path}:${reply.line}`;
}

export function replyToRow(reply: InboxReply, pr: WorkspacePr | undefined): InboxRowModel {
  const location = replyLocation(reply);
  const excerpt = reply.body.replace(/\s+/g, ' ').trim();
  const meta = EVENT_META.commented;
  return {
    key: `${prKey(reply.repoFullName, reply.prNumber)}:${reply.id}`,
    title: reply.prTitle,
    repoFullName: reply.repoFullName,
    prNumber: reply.prNumber,
    url: reply.url,
    workspaceId: reply.workspaceId,
    projectSlug: pr?.projectSlug ?? null,
    at: reply.createdAt,
    unread: false,
    snoozedUntil: null,
    summary: location ? `${location} · ${excerpt}` : excerpt,
    icon: meta.icon,
    iconClassName: meta.className,
    iconLabel: location ? 'Review thread reply' : 'Conversation comment',
    avatarLogin: reply.author,
    requestedTeams: [],
    risk: null,
    ci: pr?.ciStatus,
    item: null,
    pr: pr ?? null,
    reply,
  };
}

function foundPrStateIcon(found: InboxFoundPr) {
  switch (found.state) {
    case 'merged':
      return { icon: RiGitMergeLine, iconClassName: 'text-violet-400', iconLabel: 'Merged' };
    case 'closed':
      return {
        icon: RiGitClosePullRequestLine,
        iconClassName: 'text-red-400',
        iconLabel: 'Closed',
      };
    case 'open':
      if (found.isDraft) {
        return { icon: RiDraftLine, iconClassName: 'text-muted-foreground', iconLabel: 'Draft' };
      }
      return { icon: RiGitPullRequestLine, iconClassName: 'text-green-400', iconLabel: 'Open' };
  }
}

export function foundPrToRow(found: InboxFoundPr, pr: WorkspacePr | undefined): InboxRowModel {
  const stateIcon = pr ? prStateIcon(pr) : foundPrStateIcon(found);
  return {
    key: prKey(found.repoFullName, found.prNumber),
    title: found.title,
    repoFullName: found.repoFullName,
    prNumber: found.prNumber,
    url: found.url,
    workspaceId: found.workspaceId,
    projectSlug: pr?.projectSlug ?? null,
    at: found.updatedAt,
    unread: false,
    snoozedUntil: null,
    summary: `${stateIcon.iconLabel} · by ${found.author}`,
    ...stateIcon,
    avatarLogin: found.author,
    requestedTeams: [],
    risk: null,
    ci: pr?.ciStatus,
    item: null,
    pr: pr ?? null,
    reply: null,
  };
}
