'use client';

import { useCallback, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { randomId } from '@/lib/random-id';
import { useOnServerEvent } from '@/contexts/events-context';
import {
  findingSeverity,
  threadSource,
  type DiffThreadSource,
  type FindingSeverity,
} from './agent-findings';

export interface DiffComment {
  threadId: string;
  documentPath: string;
  lineNumber: number;
  codeLine: string;
  side: 'modified' | 'original';
  resolved: boolean;
  source: DiffThreadSource;
  severity?: FindingSeverity;
  agentType?: string;
  githubAuthor?: string;
  githubUrl?: string;
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

  // An agent replying over MCP writes straight to the DB, so a mutation-local
  // refetch would never see it.
  useOnServerEvent('COMMENT_CHANGE', (payload) => {
    if (prefix && payload.documentPath.startsWith(prefix)) refetch();
  });

  const createThread = trpc.comment.createThread.useMutation({ onSuccess: () => refetch() });
  const addComment = trpc.comment.addComment.useMutation({ onSuccess: () => refetch() });
  const resolveThread = trpc.comment.resolveThread.useMutation({ onSuccess: () => refetch() });
  const deleteThread = trpc.comment.deleteThread.useMutation({ onSuccess: () => refetch() });
  const deleteCommentMut = trpc.comment.deleteComment.useMutation({ onSuccess: () => refetch() });

  const diffComments = useMemo<DiffComment[]>(() => {
    if (!threads) return [];
    return threads.map((thread) => {
      const meta = (thread.metadata ?? {}) as Record<string, unknown>;
      const source = threadSource(meta.source);
      const isGithub = source === 'github';
      return {
        threadId: thread.id,
        documentPath: thread.documentPath,
        lineNumber: (meta.lineNumber as number) ?? 0,
        codeLine: (meta.codeLine as string) ?? '',
        side: (meta.side as 'modified' | 'original') ?? 'modified',
        resolved: thread.resolved ?? false,
        source,
        severity: findingSeverity(meta.severity),
        agentType: source === 'agent' ? (meta.agentType as string | undefined) : undefined,
        githubAuthor: isGithub ? (meta.author as string | undefined) : undefined,
        githubUrl: isGithub ? (meta.url as string | undefined) : undefined,
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

  // The summary sits at the repo root path, so the same prefix query returns it
  // but it never matches a file's exact path.
  const reviewSummary = useMemo<DiffComment | null>(() => {
    if (!repoDir) return null;
    const rootPath = `diff://${repoDir}/`;
    return diffComments.find((c) => c.documentPath === rootPath) ?? null;
  }, [repoDir, diffComments]);

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
    const threadId = randomId();
    const commentId = randomId();
    await createThread.mutateAsync({
      documentPath: makeDiffDocPath(repoDir, filePath),
      threadId,
      initialComment: { id: commentId, body: text },
      metadata: { type: 'diff', source: 'local', lineNumber, codeLine, side },
    });
  };

  const replyToThread = async (threadId: string, text: string) => {
    const commentId = randomId();
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
    reviewSummary,
    commentsForFile,
    addLineComment,
    replyToThread,
    resolve,
    remove,
    removeComment,
    refetch,
  };
}
