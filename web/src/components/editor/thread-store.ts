import {
  ThreadStore,
  ThreadStoreAuth,
  DefaultThreadStoreAuth,
  type ThreadData,
  type CommentData,
  type CommentBody,
} from '@blocknote/core/comments';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/server/trpc/root';
import { randomId } from '@/lib/random-id';

export { DefaultThreadStoreAuth };

/** Minimal interface required by DocumentEditor and snapshot/reconcile utilities. */
export interface CommentStore extends ThreadStore {
  /** Resolves when the store has finished its initial load (DB-backed stores only). */
  readonly ready?: Promise<void>;
  getThreads(): Map<string, ThreadData>;
  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void;
  setThreadMetadata(threadId: string, anchor: Record<string, unknown>): void;
}

const USER_ID = 'local-user';

// ---------------------------------------------------------------------------
// InMemoryThreadStore — session-scoped, no persistence
// ---------------------------------------------------------------------------

export class InMemoryThreadStore extends ThreadStore implements CommentStore {
  private threads: Map<string, ThreadData> = new Map();
  private subscribers: Set<(threads: Map<string, ThreadData>) => void> = new Set();
  private readonly userId: string;

  constructor(userId: string, auth: ThreadStoreAuth) {
    super(auth);
    this.userId = userId;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private notify(): void {
    this.subscribers.forEach((cb) => cb(new Map(this.threads)));
  }

  addThreadToDocument = undefined;

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const threadId = this.generateId();
    const commentId = this.generateId();

    const comment: CommentData = {
      type: 'comment',
      id: commentId,
      userId: this.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      reactions: [],
      body: options.initialComment.body,
      metadata: options.initialComment.metadata,
    };

    const thread: ThreadData = {
      type: 'thread',
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      comments: [comment],
      resolved: false,
      metadata: options.metadata,
    };

    this.threads.set(threadId, thread);
    this.notify();
    return thread;
  }

  async addComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
  }): Promise<CommentData> {
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new Error(`Thread ${options.threadId} not found`);

    const comment: CommentData = {
      type: 'comment',
      id: this.generateId(),
      userId: this.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      reactions: [],
      body: options.comment.body,
      metadata: options.comment.metadata,
    };

    thread.comments.push(comment);
    thread.updatedAt = new Date();
    this.notify();
    return comment;
  }

  async updateComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new Error(`Thread ${options.threadId} not found`);
    const comment = thread.comments.find((c) => c.id === options.commentId);
    if (!comment) throw new Error(`Comment ${options.commentId} not found`);

    comment.body = options.comment.body;
    comment.metadata = options.comment.metadata;
    comment.updatedAt = new Date();
    thread.updatedAt = new Date();
    this.notify();
  }

  async deleteComment(options: { threadId: string; commentId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new Error(`Thread ${options.threadId} not found`);
    const remaining = thread.comments.filter((c) => c.id !== options.commentId);
    if (remaining.length > 0) {
      this.threads.set(options.threadId, { ...thread, comments: remaining, updatedAt: new Date() });
      this.notify();
    } else {
      await this.deleteThread({ threadId: options.threadId });
    }
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    this.threads.delete(options.threadId);
    this.notify();
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new Error(`Thread ${options.threadId} not found`);
    thread.resolved = true;
    thread.resolvedBy = this.userId;
    thread.resolvedUpdatedAt = new Date();
    thread.updatedAt = new Date();
    this.notify();
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    const thread = this.threads.get(options.threadId);
    if (!thread) throw new Error(`Thread ${options.threadId} not found`);
    thread.resolved = false;
    thread.resolvedBy = undefined;
    thread.resolvedUpdatedAt = undefined;
    thread.updatedAt = new Date();
    this.notify();
  }

  async addReaction(): Promise<void> {}
  async deleteReaction(): Promise<void> {}

  getThread(threadId: string): ThreadData {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    return thread;
  }

  getThreads(): Map<string, ThreadData> {
    return new Map(this.threads);
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  setThreadMetadata(threadId: string, anchor: Record<string, unknown>): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    thread.metadata = { ...(thread.metadata as Record<string, unknown> | undefined), ...anchor };
  }
}

// ---------------------------------------------------------------------------
// EngyThreadStore — DB-backed, persists across page reloads
// ---------------------------------------------------------------------------

type Reaction = { emoji: string; createdAt: string; userIds: string[] };

function toCommentData(db: Record<string, unknown>): CommentData {
  const base = {
    type: 'comment' as const,
    id: db.id as string,
    userId: db.userId as string,
    createdAt: new Date(db.createdAt as string),
    updatedAt: new Date(db.updatedAt as string),
    reactions: ((db.reactions as Reaction[]) ?? []).map(
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

export class EngyThreadStore extends ThreadStore implements CommentStore {
  private threads: Map<string, ThreadData> = new Map();
  private subscribers: Set<(threads: Map<string, ThreadData>) => void> = new Set();
  private readonly client: ReturnType<typeof createTRPCClient<AppRouter>>;
  private readonly workspaceSlug: string | undefined;
  private readonly documentPath: string;

  readonly ready: Promise<void>;

  constructor(workspaceSlug: string | undefined, documentPath: string) {
    super(new DefaultThreadStoreAuth(USER_ID, 'editor'));
    this.workspaceSlug = workspaceSlug;
    this.documentPath = documentPath;
    this.client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
    });
    this.ready = this.loadFromDb();
  }

  private async loadFromDb(): Promise<void> {
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

  private notify(): void {
    this.subscribers.forEach((cb) => cb(new Map(this.threads)));
  }

  addThreadToDocument = undefined;

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const threadId = randomId();
    const commentId = randomId();
    const now = new Date();

    const thread: ThreadData = {
      type: 'thread',
      id: threadId,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      metadata: options.metadata ?? {},
      comments: [{
        type: 'comment',
        id: commentId,
        userId: USER_ID,
        createdAt: now,
        updatedAt: now,
        body: options.initialComment.body,
        reactions: [],
        metadata: options.initialComment.metadata ?? {},
      }],
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
    const commentId = randomId();
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
      const remaining = thread.comments.filter((c) => c.id !== options.commentId);
      if (remaining.length > 0) {
        this.threads.set(options.threadId, { ...thread, comments: remaining, updatedAt: new Date() });
        this.notify();
      } else {
        await this.deleteThread({ threadId: options.threadId });
      }
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
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    return thread;
  }

  getThreads(): Map<string, ThreadData> {
    return new Map(this.threads);
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  setThreadMetadata(threadId: string, anchor: Record<string, unknown>): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    thread.metadata = { ...(thread.metadata as Record<string, unknown> | undefined), ...anchor };
    this.client.comment.updateThreadMetadata.mutate({
      workspaceSlug: this.workspaceSlug,
      threadId,
      metadata: thread.metadata as Record<string, unknown>,
    });
  }
}
