'use client';

import { RiGitCommitLine } from '@remixicon/react';
import { formatRelativeTime } from '@/components/prs/pr-helpers';
import type { ConversationItem, PrDetail } from '@/server/github/pr-detail';
import { cn } from '@/lib/utils';
import { MarkdownView } from './markdown-view';
import { ReviewAvatar } from './review-avatar';
import { reviewStateLabel } from './review-helpers';
import { ReviewCommentBox } from './review-comment-box';

const VERDICT_CLASSES: Record<string, string> = {
  APPROVED: 'border-green-400/30 bg-green-400/10 text-green-400',
  CHANGES_REQUESTED: 'border-red-400/30 bg-red-400/10 text-red-400',
};

function ItemAuthor({ item }: { item: ConversationItem }) {
  if (!item.author) return <span className="text-muted-foreground">ghost</span>;
  return (
    <>
      <ReviewAvatar login={item.author.login} avatarUrl={item.author.avatarUrl} />
      <span className="font-medium text-foreground">{item.author.login}</span>
    </>
  );
}

function ItemTime({ item }: { item: ConversationItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground"
    >
      {formatRelativeTime(item.createdAt)}
    </a>
  );
}

function CommitRow({ item }: { item: Extract<ConversationItem, { kind: 'commit' }> }) {
  return (
    <li className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <RiGitCommitLine className="size-3.5 shrink-0" />
      <span className="font-mono">{item.oid}</span>
      <span className="min-w-0 truncate text-foreground/80">{item.headline}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {item.author && <span>{item.author.login}</span>}
        <ItemTime item={item} />
      </span>
    </li>
  );
}

function CommentCard({ item }: { item: Exclude<ConversationItem, { kind: 'commit' }> }) {
  const hasBody = item.body.trim().length > 0;
  return (
    <li className="border border-border">
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-1.5 text-xs',
          hasBody && 'border-b border-border',
        )}
      >
        <ItemAuthor item={item} />
        {item.kind === 'review' ? (
          <span
            className={cn(
              'border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground',
              VERDICT_CLASSES[item.state],
            )}
          >
            {reviewStateLabel(item.state)}
          </span>
        ) : (
          <span className="text-muted-foreground">commented</span>
        )}
        <span className="ml-auto">
          <ItemTime item={item} />
        </span>
      </div>
      {hasBody && (
        <div className="px-3 py-2">
          <MarkdownView markdown={item.body} />
        </div>
      )}
    </li>
  );
}

interface ReviewOverviewProps {
  detail: PrDetail;
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
}

export function ReviewOverview({
  detail,
  workspaceId,
  repoFullName,
  prNumber,
}: ReviewOverviewProps) {
  const hasBody = detail.body.trim().length > 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-4">
      <section aria-label="Description" className="border border-border px-3 py-2">
        {hasBody ? (
          <MarkdownView markdown={detail.body} />
        ) : (
          <p className="text-xs text-muted-foreground">No description provided.</p>
        )}
      </section>

      <section aria-label="Conversation" className="flex flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Conversation
        </h2>
        {detail.conversation.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.conversation.map((item) =>
              item.kind === 'commit' ? (
                <CommitRow key={`commit-${item.id}`} item={item} />
              ) : (
                <CommentCard key={`${item.kind}-${item.id}`} item={item} />
              ),
            )}
          </ol>
        )}
        <ReviewCommentBox
          workspaceId={workspaceId}
          repoFullName={repoFullName}
          prNumber={prNumber}
        />
      </section>
    </div>
  );
}
