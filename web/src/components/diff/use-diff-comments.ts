'use client';

import { useCallback, useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export interface DiffComment {
  threadId: string;
  documentPath: string;
  lineNumber: number;
  codeLine: string;
  side: 'modified' | 'original';
  resolved: boolean;
  comments: Array<{
    id: string;
    body: unknown;
    userId: string | null;
    createdAt: string | null;
  }>;
}

function makeDiffDocPath(repoDir: string, filePath: string): string {
  return `diff://${repoDir}/${filePath}`;
}

export function extractFilePathFromDocPath(documentPath: string, repoDir: string): string | null {
  const prefix = `diff://${repoDir}/`;
  return documentPath.startsWith(prefix) ? documentPath.slice(prefix.length) : null;
}

export function useDiffComments(repoDir: string | null) {
  const prefix = repoDir ? `diff://${repoDir}/` : '';

  const { data: threads, refetch } = trpc.comment.listThreadsByPrefix.useQuery(
    { documentPathPrefix: prefix },
    { enabled: !!repoDir },
  );

  const createThread = trpc.comment.createThread.useMutation({ onSuccess: () => refetch() });
  const addComment = trpc.comment.addComment.useMutation({ onSuccess: () => refetch() });
  const resolveThread = trpc.comment.resolveThread.useMutation({ onSuccess: () => refetch() });
  const deleteThread = trpc.comment.deleteThread.useMutation({ onSuccess: () => refetch() });
  const deleteCommentMut = trpc.comment.deleteComment.useMutation({ onSuccess: () => refetch() });

  const diffComments = useMemo<DiffComment[]>(() => {
    if (!threads) return [];
    return threads.map((thread) => {
      const meta = (thread.metadata ?? {}) as Record<string, unknown>;
      return {
        threadId: thread.id,
        documentPath: thread.documentPath,
        lineNumber: (meta.lineNumber as number) ?? 0,
        codeLine: (meta.codeLine as string) ?? '',
        side: (meta.side as 'modified' | 'original') ?? 'modified',
        resolved: thread.resolved ?? false,
        comments: thread.comments
          .filter((c) => c.deletedAt == null)
          .map((c) => ({
            id: c.id,
            body: c.body,
            userId: c.userId,
            createdAt: c.createdAt,
          })),
      };
    });
  }, [threads]);

  const commentsForFile = useCallback(
    (filePath: string): DiffComment[] => {
      if (!repoDir) return [];
      const docPath = makeDiffDocPath(repoDir, filePath);
      return diffComments.filter((c) => c.documentPath === docPath);
    },
    [repoDir, diffComments],
  );

  const addLineComment = async (
    filePath: string,
    lineNumber: number,
    codeLine: string,
    text: string,
    side: 'modified' | 'original' = 'modified',
  ) => {
    if (!repoDir) return;
    const threadId = crypto.randomUUID();
    const commentId = crypto.randomUUID();
    await createThread.mutateAsync({
      documentPath: makeDiffDocPath(repoDir, filePath),
      threadId,
      initialComment: { id: commentId, body: text },
      metadata: { type: 'diff', lineNumber, codeLine, side },
    });
  };

  const replyToThread = async (threadId: string, text: string) => {
    const commentId = crypto.randomUUID();
    await addComment.mutateAsync({ threadId, commentId, body: text });
  };

  const resolve = async (threadId: string) => {
    await resolveThread.mutateAsync({ threadId });
  };

  const remove = async (threadId: string) => {
    await deleteThread.mutateAsync({ threadId });
  };

  const removeComment = async (threadId: string, commentId: string) => {
    await deleteCommentMut.mutateAsync({ threadId, commentId });
  };

  return {
    diffComments,
    commentsForFile,
    addLineComment,
    replyToThread,
    resolve,
    remove,
    removeComment,
    refetch,
  };
}
