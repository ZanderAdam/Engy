'use client';

import { type ReactNode } from 'react';
import { RiFileCopyLine } from '@remixicon/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import type { PrDetail } from '@/server/github/pr-detail';
import { ReviewAvatar } from './review-avatar';
import { latestReviewVerdicts, reviewStateLabel } from './review-helpers';

interface LinkedWork {
  sessionId: string | null;
  taskGroupId: number | null;
}

interface ReviewSidebarProps {
  detail: PrDetail;
  worktreePath: string;
  linkedWork: LinkedWork | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Person({
  login,
  avatarUrl,
  note,
}: {
  login: string;
  avatarUrl: string | null;
  note: string;
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <ReviewAvatar login={login} avatarUrl={avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{login}</span>
      <span className="shrink-0 text-muted-foreground">{note}</span>
    </li>
  );
}

async function copyWorktreePath(worktreePath: string) {
  const copied = await copyToClipboard(worktreePath);
  if (copied) toast.success('Worktree path copied');
  else toast.error('Could not copy the path');
}

export function ReviewSidebar({ detail, worktreePath, linkedWork }: ReviewSidebarProps) {
  const verdicts = latestReviewVerdicts(detail.conversation);
  const reviewedLogins = new Set(verdicts.map((v) => v.login));
  const pending = detail.reviewRequests.filter((r) => !reviewedLogins.has(r.login));
  const hasLinkedWork = linkedWork && (linkedWork.sessionId || linkedWork.taskGroupId);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Section title="Reviewers">
        {verdicts.length === 0 && pending.length === 0 ? (
          <p className="text-xs text-muted-foreground">No reviewers</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {verdicts.map((v) => (
              <Person
                key={v.login}
                login={v.login}
                avatarUrl={v.avatarUrl}
                note={reviewStateLabel(v.state)}
              />
            ))}
            {pending.map((r) => (
              <Person key={r.login} login={r.login} avatarUrl={r.avatarUrl} note="Requested" />
            ))}
          </ul>
        )}
      </Section>

      {detail.assignees.length > 0 && (
        <Section title="Assignees">
          <ul className="flex flex-col gap-1.5">
            {detail.assignees.map((a) => (
              <Person key={a.login} login={a.login} avatarUrl={a.avatarUrl} note="" />
            ))}
          </ul>
        </Section>
      )}

      {detail.labels.length > 0 && (
        <Section title="Labels">
          <ul className="flex flex-wrap gap-1">
            {detail.labels.map((label) => (
              <li
                key={label.name}
                className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[10px]"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `#${label.color}` }}
                />
                {label.name}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasLinkedWork && (
        <Section title="Linked work">
          <ul className="flex flex-col gap-1 text-xs">
            {linkedWork.taskGroupId && (
              <li>
                Task group <span className="font-mono">#{linkedWork.taskGroupId}</span>
              </li>
            )}
            {linkedWork.sessionId && (
              <li>
                Agent session <span className="font-mono">{linkedWork.sessionId.slice(0, 8)}</span>
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section title="Worktree">
        <div className="flex items-start gap-1">
          <code className="min-w-0 flex-1 break-all text-[11px] text-muted-foreground">
            {worktreePath}
          </code>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy worktree path"
            onClick={() => copyWorktreePath(worktreePath)}
          >
            <RiFileCopyLine className="size-3" />
          </Button>
        </div>
      </Section>
    </div>
  );
}
