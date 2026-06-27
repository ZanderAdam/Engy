import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';

// Mock sonner so toast calls don't fail in test environment
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

// Mock tRPC client creation — we'll inject a stub instead
vi.mock('@trpc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trpc/client')>();
  return {
    ...actual,
    createTRPCClient: vi.fn(),
  };
});

import { createTRPCClient } from '@trpc/client';
import { EngyThreadStore } from './thread-store';

function makeMutate(impl: () => Promise<void>) {
  return { mutate: () => impl() };
}

function makeStubClient(overrides: Partial<Record<string, () => Promise<void>>> = {}) {
  const resolve = () => Promise.resolve();
  return {
    comment: {
      listThreads: { query: () => Promise.resolve([]) },
      createThread: makeMutate(overrides.createThread ?? resolve),
      addComment: makeMutate(overrides.addComment ?? resolve),
      updateComment: makeMutate(overrides.updateComment ?? resolve),
      deleteComment: makeMutate(overrides.deleteComment ?? resolve),
      deleteThread: makeMutate(overrides.deleteThread ?? resolve),
      resolveThread: makeMutate(overrides.resolveThread ?? resolve),
      unresolveThread: makeMutate(overrides.unresolveThread ?? resolve),
      addReaction: makeMutate(overrides.addReaction ?? resolve),
      deleteReaction: makeMutate(overrides.deleteReaction ?? resolve),
      updateThreadMetadata: makeMutate(overrides.updateThreadMetadata ?? resolve),
    },
  };
}

async function buildStore(
  clientOverrides: Partial<Record<string, () => Promise<void>>> = {},
): Promise<EngyThreadStore> {
  const stub = makeStubClient(clientOverrides);
  (createTRPCClient as ReturnType<typeof vi.fn>).mockReturnValue(stub);
  const store = new EngyThreadStore(undefined, 'test/doc.md');
  await store.ready; // wait for loadFromDb to complete before running tests
  return store;
}

describe('[FR-EDITOR-080] EngyThreadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('[FR-EDITOR-080] createThread', () => {
    it('[FR-EDITOR-080] should add thread optimistically and return it', async () => {
      const store = await buildStore();
      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
      });
      expect(store.getThreads().has(thread.id)).toBe(true);
    });

    it('[FR-EDITOR-080] should roll back and toast on mutation failure', async () => {
      const error = new Error('Network error');
      const store = await buildStore({
        createThread: () => Promise.reject(error),
      });

      const notified: unknown[] = [];
      store.subscribe((threads) => notified.push(new Map(threads)));

      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
      });

      // Wait for the rejected promise to settle
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getThreads().has(thread.id)).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to save comment', {
        description: 'Network error',
      });
    });
  });

  describe('[FR-EDITOR-080] addComment', () => {
    it('[FR-EDITOR-080] should roll back comment on mutation failure', async () => {
      const error = new Error('Server error');
      const store = await buildStore({
        addComment: () => Promise.reject(error),
      });

      // First create a thread successfully
      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
      });
      await new Promise((r) => setTimeout(r, 0)); // settle createThread mutation

      const initialCommentCount = store.getThreads().get(thread.id)!.comments.length;

      await store.addComment({
        threadId: thread.id,
        comment: { body: { type: 'doc', content: [] } as any },
      });
      await new Promise((r) => setTimeout(r, 0));

      const finalCommentCount = store.getThreads().get(thread.id)!.comments.length;
      expect(finalCommentCount).toBe(initialCommentCount);
      expect(toast.error).toHaveBeenCalledWith('Failed to save comment', expect.any(Object));
    });
  });

  describe('[FR-EDITOR-080] deleteThread', () => {
    it('[FR-EDITOR-080] should roll back thread on mutation failure', async () => {
      const error = new Error('Delete failed');
      const store = await buildStore({
        deleteThread: () => Promise.reject(error),
      });

      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
      });
      await new Promise((r) => setTimeout(r, 0));

      await store.deleteThread({ threadId: thread.id });
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getThreads().has(thread.id)).toBe(true);
      expect(toast.error).toHaveBeenCalledWith('Failed to delete thread', expect.any(Object));
    });
  });

  describe('[FR-EDITOR-080] resolveThread', () => {
    it('[FR-EDITOR-080] should roll back resolved state on mutation failure', async () => {
      const error = new Error('Resolve failed');
      const store = await buildStore({
        resolveThread: () => Promise.reject(error),
      });

      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
      });
      await new Promise((r) => setTimeout(r, 0));

      await store.resolveThread({ threadId: thread.id });
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getThreads().get(thread.id)!.resolved).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to resolve thread', expect.any(Object));
    });
  });

  describe('[FR-EDITOR-080] setThreadMetadata', () => {
    it('[FR-EDITOR-080] should roll back metadata on mutation failure', async () => {
      const error = new Error('Metadata failed');
      const store = await buildStore({
        updateThreadMetadata: () => Promise.reject(error),
      });

      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [] } as any },
        metadata: { anchor: 'original' },
      });
      await new Promise((r) => setTimeout(r, 0));

      const prevMeta = store.getThreads().get(thread.id)!.metadata;

      store.setThreadMetadata(thread.id, { anchor: 'new-anchor' });
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getThreads().get(thread.id)!.metadata).toEqual(prevMeta);
      expect(toast.error).toHaveBeenCalledWith('Failed to save comment anchor', expect.any(Object));
    });
  });

  describe('[FR-EDITOR-080] updateComment', () => {
    it('[FR-EDITOR-080] should roll back body on mutation failure', async () => {
      const error = new Error('Update failed');
      const store = await buildStore({
        updateComment: () => Promise.reject(error),
      });

      const thread = await store.createThread({
        initialComment: { body: { type: 'doc', content: [{ type: 'text', text: 'original' }] } as any },
      });
      await new Promise((r) => setTimeout(r, 0));

      const commentId = store.getThreads().get(thread.id)!.comments[0].id;
      const originalBody = store.getThreads().get(thread.id)!.comments[0].body;

      await store.updateComment({
        threadId: thread.id,
        commentId,
        comment: { body: { type: 'doc', content: [{ type: 'text', text: 'updated' }] } as any },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getThreads().get(thread.id)!.comments[0].body).toEqual(originalBody);
      expect(toast.error).toHaveBeenCalledWith('Failed to update comment', expect.any(Object));
    });
  });
});
