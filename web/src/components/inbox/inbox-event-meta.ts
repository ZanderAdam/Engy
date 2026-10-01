import type { ComponentType } from 'react';
import {
  RiAtLine,
  RiChat1Line,
  RiChatCheckLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiGitClosePullRequestLine,
  RiGitCommitLine,
  RiGitMergeLine,
  RiGitPullRequestLine,
  RiToolsLine,
  RiUserAddLine,
} from '@remixicon/react';
import type { InboxItem } from './inbox-helpers';

export type InboxEventKind = InboxItem['events'][number]['kind'];

interface EventMeta {
  icon: ComponentType<{ className?: string }>;
  className: string;
  verb: string;
  system?: boolean;
}

export const EVENT_META: Record<InboxEventKind, EventMeta> = {
  review_requested: {
    icon: RiEyeLine,
    className: 'text-sky-400',
    verb: 'requested your review',
  },
  mentioned: { icon: RiAtLine, className: 'text-sky-400', verb: 'mentioned you' },
  commented: { icon: RiChat1Line, className: 'text-muted-foreground', verb: 'commented' },
  approved: { icon: RiCheckboxCircleLine, className: 'text-green-400', verb: 'approved' },
  changes_requested: {
    icon: RiErrorWarningLine,
    className: 'text-red-400',
    verb: 'requested changes',
  },
  reviewed: { icon: RiChatCheckLine, className: 'text-muted-foreground', verb: 'reviewed' },
  ci_failed: {
    icon: RiCloseCircleLine,
    className: 'text-red-400',
    verb: 'CI failed',
    system: true,
  },
  ci_passed: { icon: RiCheckLine, className: 'text-green-400', verb: 'CI passed', system: true },
  auto_fix_attention: {
    icon: RiToolsLine,
    className: 'text-amber-400',
    verb: 'auto-fix needs attention',
    system: true,
  },
  merged: { icon: RiGitMergeLine, className: 'text-violet-400', verb: 'merged' },
  closed: { icon: RiGitClosePullRequestLine, className: 'text-red-400', verb: 'closed' },
  reopened: { icon: RiGitPullRequestLine, className: 'text-green-400', verb: 'reopened' },
  pushed: { icon: RiGitCommitLine, className: 'text-muted-foreground', verb: 'pushed' },
  assigned: { icon: RiUserAddLine, className: 'text-sky-400', verb: 'assigned you' },
};

interface SummarizableEvent {
  kind: InboxEventKind;
  summary: string;
  actor: string | null;
}

const RAW_SUMMARY = /^[a-z_]*$|\b[a-z]+_[a-z_]+\b/;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function summarizeEvent(event: SummarizableEvent | null): string {
  if (!event) return 'No activity';
  const summary = event.summary.trim();
  if (!RAW_SUMMARY.test(summary)) return summary;
  const { verb, system } = EVENT_META[event.kind];
  if (system || !event.actor) return capitalize(verb);
  return `${event.actor} ${verb}`;
}

export function hasAvatar(event: Pick<SummarizableEvent, 'kind' | 'actor'>): boolean {
  return event.actor !== null && !EVENT_META[event.kind].system;
}
