import {
  ThreadStore,
  ThreadStoreAuth,
  type ThreadData,
  type CommentData,
  type CommentBody,
} from '@blocknote/core/comments';

export class InMemoryThreadStore extends ThreadStore {
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
    thread.comments = thread.comments.filter((c) => c.id !== options.commentId);
    thread.updatedAt = new Date();
    this.notify();
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
}
