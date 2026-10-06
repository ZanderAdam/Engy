import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../db/client';
import { commentThreads } from '../db/schema';
import { LOCAL_USER_ID } from '@/lib/comment-feedback';

type ThreadRow = typeof commentThreads.$inferSelect;

interface GithubThread {
  row: ThreadRow;
  rootCommentId: number;
  nodeId: string;
}

export function requireGithubThread(threadId: string, prNumber: number): GithubThread {
  const row = getDb().select().from(commentThreads).where(eq(commentThreads.id, threadId)).get();
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Comment thread "${threadId}" not found` });
  }
  const { source, githubId, githubThreadNodeId, prNumber: threadPr } = row.metadata ?? {};
  if (
    source !== 'github' ||
    typeof githubId !== 'number' ||
    typeof githubThreadNodeId !== 'string' ||
    threadPr !== prNumber
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only threads imported from this pull request on GitHub can be changed on GitHub',
    });
  }
  return { row, rootCommentId: githubId, nodeId: githubThreadNodeId };
}

export function setResolvedLocally(
  row: ThreadRow,
  resolved: boolean,
  options: { localOnly: boolean },
): void {
  const now = new Date().toISOString();
  const metadata = { ...row.metadata };
  delete metadata.localDismissed;
  getDb()
    .update(commentThreads)
    .set({
      resolved,
      resolvedBy: resolved ? LOCAL_USER_ID : null,
      resolvedAt: resolved ? now : null,
      metadata: options.localOnly && resolved ? { ...metadata, localDismissed: true } : metadata,
      updatedAt: now,
    })
    .where(eq(commentThreads.id, row.id))
    .run();
}
