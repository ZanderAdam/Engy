import { asc, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { commentThreads, threadComments } from '../db/schema';
import { diffDocPath, diffScopePrefix } from '@/lib/diff-doc-path';
import { startsWithPrefix } from '../lib/path-prefix';
import { LOCAL_USER_ID } from '@/lib/comment-feedback';
import { isGithubDraft, toGithubSide } from '@/lib/github-draft';
import { randomId } from '@/lib/random-id';
import type { ReviewWorktreeRow } from './worktrees';

type ThreadRow = typeof commentThreads.$inferSelect;
type CommentRow = typeof threadComments.$inferSelect;

interface DraftThread extends ThreadRow {
  comments: CommentRow[];
}

interface NewDraft {
  filePath: string;
  lineNumber: number;
  side: 'modified' | 'original';
  codeLine: string;
  text: string;
}

function commentsByThread(
  threadIds: string[],
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Map<string, CommentRow[]> {
  const grouped = new Map<string, CommentRow[]>();
  if (threadIds.length === 0) return grouped;
  const rows = getDb()
    .select()
    .from(threadComments)
    .where(inArray(threadComments.threadId, threadIds))
    .orderBy(asc(threadComments.createdAt))
    .all();
  for (const row of rows) {
    if (!includeDeleted && row.deletedAt != null) continue;
    const list = grouped.get(row.threadId) ?? [];
    list.push(row);
    grouped.set(row.threadId, list);
  }
  return grouped;
}

function threadsUnderReview(row: ReviewWorktreeRow): ThreadRow[] {
  const prefix = diffScopePrefix(row.repoPath, row.headRefName);
  return getDb()
    .select()
    .from(commentThreads)
    .where(startsWithPrefix(commentThreads.documentPath, prefix))
    .all()
    .filter((thread) => thread.metadata?.prNumber === row.prNumber);
}

export function createDraftThread(row: ReviewWorktreeRow, draft: NewDraft): string {
  const db = getDb();
  const now = new Date().toISOString();
  const threadId = randomId();
  db.insert(commentThreads)
    .values({
      id: threadId,
      workspaceId: null,
      documentPath: diffDocPath(row.repoPath, row.headRefName, draft.filePath),
      metadata: {
        type: 'diff',
        source: 'local',
        githubDraft: true,
        prNumber: row.prNumber,
        lineNumber: draft.lineNumber,
        codeLine: draft.codeLine,
        side: draft.side,
      },
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(threadComments)
    .values({
      id: randomId(),
      threadId,
      userId: LOCAL_USER_ID,
      body: draft.text,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return threadId;
}

export function listDraftThreads(row: ReviewWorktreeRow): DraftThread[] {
  const drafts = threadsUnderReview(row).filter((thread) => isGithubDraft(thread.metadata));
  const comments = commentsByThread(
    drafts.map((thread) => thread.id),
    { includeDeleted: true },
  );
  return drafts.map((thread) => ({ ...thread, comments: comments.get(thread.id) ?? [] }));
}

function firstBody(comments: CommentRow[] | undefined): string | null {
  const body = comments?.[0]?.body;
  return typeof body === 'string' ? body.trim() : null;
}

export function deleteImportedDrafts(row: ReviewWorktreeRow, drafts: DraftThread[]): number {
  const imported = threadsUnderReview(row).filter((thread) => thread.metadata?.source === 'github');
  const importedComments = commentsByThread(imported.map((thread) => thread.id));

  const hasGithubCopy = (draft: DraftThread) =>
    imported.some(
      (thread) =>
        thread.documentPath === draft.documentPath &&
        thread.metadata?.lineNumber === draft.metadata?.lineNumber &&
        thread.metadata?.diffSide === toGithubSide(draft.metadata?.side) &&
        firstBody(importedComments.get(thread.id)) === firstBody(draft.comments),
    );

  const copied = drafts.filter(hasGithubCopy);
  if (copied.length > 0) {
    getDb()
      .delete(commentThreads)
      .where(
        inArray(
          commentThreads.id,
          copied.map((draft) => draft.id),
        ),
      )
      .run();
  }
  return copied.length;
}
