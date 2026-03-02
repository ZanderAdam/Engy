import { ThreadStore, DefaultThreadStoreAuth } from '@blocknote/core/comments';
import type { ThreadData, CommentData, CommentBody } from '@blocknote/core/comments';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/server/trpc/root';

const USER_ID = 'local-user';

function generateId(): string {
  return crypto.randomUUID();
}

function toCommentData(db: Record<string, unknown>): CommentData {
  const base = {
    type: 'comment' as const,
    id: db.id as string,
    userId: db.userId as string,
    createdAt: new Date(db.createdAt as string),
    updatedAt: new Date(db.updatedAt as string),
    reactions: ((db.reactions as Array<{ emoji: string; createdAt: string; userIds: string[] }>) ?? []).map(
      (r) => ({ emoji: r.emoji, createdAt: new Date(r.createdAt), userIds: r.userIds }),
    ),
    metadata: db.metadata ?? {},
  };

  if (db.deletedAt) {
    return { ...base, deletedAt: new Date(db.deletedAt as string), body: undefined } as CommentData;
  }
  return { ...base, body: db.body } as CommentData;
}

function toThreadData(db: Record<string, unknown>): ThreadData {
  const comments = (db.comments as Array<Record<string, unknown>>) ?? [];
  return {
    type: 'thread' as const,
    id: db.id as string,
    createdAt: new Date(db.createdAt as string),
    updatedAt: new Date(db.updatedAt as string),
    resolved: db.resolved as boolean,
    resolvedUpdatedAt: db.resolvedAt ? new Date(db.resolvedAt as string) : undefined,
    resolvedBy: (db.resolvedBy as string) ?? undefined,
    metadata: db.metadata ?? {},
    comments: comments.map(toCommentData),
  };
}

export class EngyThreadStore extends ThreadStore {
  private threads: Map<string, ThreadData> = new Map();
  private listeners: Set<(threads: Map<string, ThreadData>) => void> = new Set();
  private client: ReturnType<typeof createTRPCClient<AppRouter>>;
  private workspaceSlug: string;
  private documentPath: string;

  constructor(workspaceSlug: string, documentPath: string) {
    super(new DefaultThreadStoreAuth(USER_ID, 'editor'));
    this.workspaceSlug = workspaceSlug;
    this.documentPath = documentPath;
    this.client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
    });
    this.loadThreads();
  }

  private async loadThreads() {
    const dbThreads = await this.client.comment.listThreads.query({
      workspaceSlug: this.workspaceSlug,
      documentPath: this.documentPath,
    });
    this.threads = new Map(
      (dbThreads as Array<Record<string, unknown>>).map((t) => {
        const td = toThreadData(t);
        return [td.id, td];
      }),
    );
    this.notify();
  }

  private notify() {
    for (const cb of this.listeners) {
      cb(new Map(this.threads));
    }
  }

  addThreadToDocument = undefined;

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const threadId = generateId();
    const commentId = generateId();
    const now = new Date();

    const thread: ThreadData = {
      type: 'thread',
      id: threadId,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      metadata: options.metadata ?? {},
      comments: [
        {
          type: 'comment',
          id: commentId,
          userId: USER_ID,
          createdAt: now,
          updatedAt: now,
          body: options.initialComment.body,
          reactions: [],
          metadata: options.initialComment.metadata ?? {},
        },
      ],
    };

    this.threads.set(threadId, thread);
    this.notify();

    this.client.comment.createThread.mutate({
      workspaceSlug: this.workspaceSlug,
      documentPath: this.documentPath,
      threadId,
      initialComment: { id: commentId, body: options.initialComment.body, metadata: options.initialComment.metadata },
      metadata: options.metadata,
    });

    return thread;
  }

  async addComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
  }): Promise<CommentData> {
    const commentId = generateId();
    const now = new Date();
    const commentData: CommentData = {
      type: 'comment',
      id: commentId,
      userId: USER_ID,
      createdAt: now,
      updatedAt: now,
      body: options.comment.body,
      reactions: [],
      metadata: options.comment.metadata ?? {},
    };

    const thread = this.threads.get(options.threadId);
    if (thread) {
      thread.comments.push(commentData);
      thread.updatedAt = now;
      this.notify();
    }

    this.client.comment.addComment.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
      commentId,
      body: options.comment.body,
      metadata: options.comment.metadata,
    });

    return commentData;
  }

  async updateComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      const comment = thread.comments.find((c) => c.id === options.commentId);
      if (comment && !comment.deletedAt) {
        (comment as { body: CommentBody }).body = options.comment.body;
        comment.updatedAt = new Date();
      }
      this.notify();
    }

    this.client.comment.updateComment.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
      commentId: options.commentId,
      body: options.comment.body,
      metadata: options.comment.metadata,
    });
  }

  async deleteComment(options: { threadId: string; commentId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      const idx = thread.comments.findIndex((c) => c.id === options.commentId);
      if (idx !== -1) {
        const existing = thread.comments[idx];
        thread.comments[idx] = {
          ...existing,
          deletedAt: new Date(),
          body: undefined,
        } as CommentData;
      }
      this.notify();
    }

    this.client.comment.deleteComment.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
      commentId: options.commentId,
    });
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    this.threads.delete(options.threadId);
    this.notify();

    this.client.comment.deleteThread.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
    });
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      thread.resolved = true;
      thread.resolvedBy = USER_ID;
      thread.resolvedUpdatedAt = new Date();
      this.notify();
    }

    this.client.comment.resolveThread.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
    });
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      thread.resolved = false;
      thread.resolvedBy = undefined;
      thread.resolvedUpdatedAt = undefined;
      this.notify();
    }

    this.client.comment.unresolveThread.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
    });
  }

  async addReaction(options: { threadId: string; commentId: string; emoji: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      const comment = thread.comments.find((c) => c.id === options.commentId);
      if (comment) {
        const existing = comment.reactions.find((r) => r.emoji === options.emoji);
        if (existing) {
          if (!existing.userIds.includes(USER_ID)) existing.userIds.push(USER_ID);
        } else {
          comment.reactions.push({ emoji: options.emoji, createdAt: new Date(), userIds: [USER_ID] });
        }
        this.notify();
      }
    }

    this.client.comment.addReaction.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
      commentId: options.commentId,
      emoji: options.emoji,
    });
  }

  async deleteReaction(options: { threadId: string; commentId: string; emoji: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (thread) {
      const comment = thread.comments.find((c) => c.id === options.commentId);
      if (comment) {
        comment.reactions = comment.reactions
          .map((r) =>
            r.emoji === options.emoji ? { ...r, userIds: r.userIds.filter((id) => id !== USER_ID) } : r,
          )
          .filter((r) => r.userIds.length > 0);
        this.notify();
      }
    }

    this.client.comment.deleteReaction.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId: options.threadId,
      commentId: options.commentId,
      emoji: options.emoji,
    });
  }

  getThread(threadId: string): ThreadData {
    return this.threads.get(threadId)!;
  }

  getThreads(): Map<string, ThreadData> {
    return new Map(this.threads);
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
