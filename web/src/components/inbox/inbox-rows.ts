import type { ComponentType } from 'react';
import type { GhPrCiStatus } from '@engy/common';
import { prActivityAt } from '@/components/prs/pr-helpers';
import { prStateVisual } from '@/components/prs/pr-state';
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
  iconLabel: string;
  avatarLogin: string | null;
  requestedTeams: string[];
  risk: InboxItem['risk'];
  ci: GhPrCiStatus | undefined;
  item: InboxItem | null;
  pr: WorkspacePr | null;
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
