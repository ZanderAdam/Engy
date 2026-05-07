import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { permanentMemories, fleetingMemories } from '../../db/schema';

describe('memory router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let workspaceSlug: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
    const ws = await caller.workspace.create({ name: 'Memory Test WS' });
    workspaceSlug = ws.slug;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('create', () => {
    it('should insert a DB row and write a file', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'JWT expiry is 1 hour',
        content: 'All JWTs issued by the auth service expire after 1 hour.',
        tags: ['auth', 'jwt'],
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.title).toBe('JWT expiry is 1 hour');
      expect(result.subtype).toBe('fact');
      expect(result.filePath).toBeTruthy();

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, result.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('JWT expiry is 1 hour');
      expect(raw).toContain('fact');
    });

    it('should place the file under memory/facts/ for fact subtype', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'A fact memory',
        content: 'Some fact content',
      });
      expect(result.filePath).toMatch(/^memory\/facts\//);
    });

    it('should place file under correct subtype dir for each subtype', async () => {
      const subtypes = ['decision', 'pattern', 'convention', 'insight'] as const;
      for (const subtype of subtypes) {
        const mem = await caller.memory.create({
          workspaceSlug,
          subtype,
          title: `A ${subtype} memory`,
          content: `Content for ${subtype}`,
        });
        expect(mem.filePath).toMatch(new RegExp(`^memory/${subtype}s/`));
      }
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.create({
          workspaceSlug: 'no-such-ws',
          subtype: 'fact',
          title: 'X',
          content: 'Y',
        }),
      ).rejects.toThrow('not found');
    });

    it('should store all optional metadata fields', async () => {
      const result = await caller.memory.create({
        workspaceSlug,
        subtype: 'decision',
        title: 'Use PostgreSQL',
        content: 'We chose PostgreSQL over MySQL for JSONB support.',
        repo: 'api-server',
        confidence: 0.9,
        keywords: ['database', 'postgresql'],
        themes: ['persistence', 'infrastructure'],
        tags: ['db', 'decision'],
        scenarioIds: ['FR-3.1'],
      });

      expect(result.repo).toBe('api-server');
      expect(result.confidence).toBe(0.9);
      expect(result.keywords).toEqual(['database', 'postgresql']);
      expect(result.themes).toEqual(['persistence', 'infrastructure']);
      expect(result.tags).toEqual(['db', 'decision']);
      expect(result.scenarioIds).toEqual(['FR-3.1']);
    });
  });

  describe('get', () => {
    it('should return a memory by id', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'insight',
        title: 'Caching insight',
        content: 'Cache invalidation is hard.',
      });

      const result = await caller.memory.get({ id: created.id });
      expect(result.id).toBe(created.id);
      expect(result.title).toBe('Caching insight');
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(caller.memory.get({ id: 99999 })).rejects.toThrow('not found');
    });
  });

  describe('update', () => {
    it('should update DB row and rewrite file', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Original title',
        content: 'Original content',
      });

      const updated = await caller.memory.update({
        id: created.id,
        title: 'Updated title',
        content: 'Updated content',
        tags: ['updated-tag'],
      });

      expect(updated.title).toBe('Updated title');
      expect(updated.content).toBe('Updated content');
      expect(updated.tags).toEqual(['updated-tag']);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, created.filePath!);
      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('Updated title');
      expect(raw).toContain('Updated content');
    });

    it('should merge partial updates, preserving existing fields', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Keep me',
        content: 'Keep this',
        repo: 'some-repo',
        confidence: 0.8,
      });

      const updated = await caller.memory.update({
        id: created.id,
        tags: ['new-tag'],
      });

      expect(updated.title).toBe('Keep me');
      expect(updated.content).toBe('Keep this');
      expect(updated.repo).toBe('some-repo');
      expect(updated.confidence).toBe(0.8);
      expect(updated.tags).toEqual(['new-tag']);
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(
        caller.memory.update({ id: 99999, title: 'X' }),
      ).rejects.toThrow('not found');
    });

    it('should set supersededById when provided', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Old fact',
        content: 'Old content',
      });
      const replacement = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'New fact',
        content: 'New content',
      });

      const updated = await caller.memory.update({
        id: created.id,
        supersededById: replacement.id,
      });

      expect(updated.supersededById).toBe(replacement.id);
    });
  });

  describe('delete', () => {
    it('should remove DB row and delete file', async () => {
      const created = await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'Deletable fact',
        content: 'To be removed.',
      });

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, created.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      await caller.memory.delete({ id: created.id });

      expect(fs.existsSync(absPath)).toBe(false);

      const row = ctx.db
        .select()
        .from(permanentMemories)
        .where(eq(permanentMemories.id, created.id))
        .get();
      expect(row).toBeUndefined();
    });

    it('should throw NOT_FOUND for non-existent id', async () => {
      await expect(caller.memory.delete({ id: 99999 })).rejects.toThrow('not found');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await caller.memory.create({
        workspaceSlug,
        subtype: 'fact',
        title: 'JWT fact',
        content: 'JWT tokens expire.',
        tags: ['auth', 'jwt'],
        repo: 'api-server',
      });
      await caller.memory.create({
        workspaceSlug,
        subtype: 'decision',
        title: 'Use Redis for caching',
        content: 'Redis was chosen for its speed.',
        tags: ['cache', 'redis'],
        repo: 'api-server',
      });
      await caller.memory.create({
        workspaceSlug,
        subtype: 'pattern',
        title: 'Repository pattern',
        content: 'Repos abstract data access.',
        tags: ['architecture'],
        repo: 'frontend',
      });
    });

    it('should list all memories for a workspace', async () => {
      const result = await caller.memory.list({ workspaceSlug });
      expect(result.length).toBe(3);
    });

    it('should filter by subtype', async () => {
      const result = await caller.memory.list({ workspaceSlug, subtype: 'fact' });
      expect(result.length).toBe(1);
      expect(result[0].subtype).toBe('fact');
    });

    it('should filter by repo', async () => {
      const result = await caller.memory.list({ workspaceSlug, repo: 'api-server' });
      expect(result.length).toBe(2);
    });

    it('should filter by tags (AND match)', async () => {
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth', 'jwt'] });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('JWT fact');
    });

    it('should filter by partial tag match (all tags must be present)', async () => {
      const result = await caller.memory.list({ workspaceSlug, tags: ['auth'] });
      expect(result.length).toBe(1);
    });

    it('should filter by text search on title', async () => {
      const result = await caller.memory.list({ workspaceSlug, search: 'Redis' });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Use Redis for caching');
    });

    it('should filter by text search on content', async () => {
      const result = await caller.memory.list({ workspaceSlug, search: 'Repos abstract' });
      expect(result.length).toBe(1);
      expect(result[0].subtype).toBe('pattern');
    });

    it('should combine subtype and repo filters', async () => {
      const result = await caller.memory.list({
        workspaceSlug,
        subtype: 'decision',
        repo: 'api-server',
      });
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Use Redis for caching');
    });

    it('should respect limit and offset', async () => {
      const page1 = await caller.memory.list({ workspaceSlug, limit: 2, offset: 0 });
      const page2 = await caller.memory.list({ workspaceSlug, limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.list({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('promote', () => {
    it('should create a permanent memory from a fleeting memory', async () => {
      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: 1,
          content: 'We should always validate inputs server-side.',
          type: 'capture',
          source: 'agent',
          tags: ['validation', 'security'],
        })
        .returning()
        .get();

      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .update(fleetingMemories)
        .set({ workspaceId: ws.id })
        .where(eq(fleetingMemories.id, fleeting.id))
        .run();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'convention',
        title: 'Always validate inputs server-side',
        content: 'Server-side validation is non-negotiable for security.',
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.subtype).toBe('convention');
      expect(result.title).toBe('Always validate inputs server-side');
      expect(result.filePath).toMatch(/^memory\/conventions\//);

      const wsDir = path.join(ctx.tmpDir, workspaceSlug);
      const absPath = path.join(wsDir, result.filePath!);
      expect(fs.existsSync(absPath)).toBe(true);

      const updatedFleeting = ctx.db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, fleeting.id))
        .get();
      expect(updatedFleeting!.promoted).toBe(true);
      expect(updatedFleeting!.promotedAt).toBeTruthy();
      expect(updatedFleeting!.promotedFromId).toBe(result.id);
    });

    it('should carry fleeting tags forward when not overridden', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Keep original tags',
          type: 'capture',
          source: 'agent',
          tags: ['original', 'fleeting-tag'],
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Promoted with original tags',
      });

      expect(result.tags).toEqual(['original', 'fleeting-tag']);
    });

    it('should use provided content when supplied', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Raw fleeting content',
          type: 'capture',
          source: 'agent',
        })
        .returning()
        .get();

      const result = await caller.memory.promote({
        fleetingMemoryId: fleeting.id,
        subtype: 'insight',
        title: 'Refined insight',
        content: 'Refined content for the permanent memory.',
      });

      expect(result.content).toBe('Refined content for the permanent memory.');
    });

    it('should throw NOT_FOUND for non-existent fleeting', async () => {
      await expect(
        caller.memory.promote({
          fleetingMemoryId: 99999,
          subtype: 'fact',
          title: 'X',
        }),
      ).rejects.toThrow('not found');
    });

    it('should throw BAD_REQUEST when fleeting is already promoted', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const fleeting = ctx.db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Already promoted',
          type: 'capture',
          source: 'agent',
          promoted: true,
        })
        .returning()
        .get();

      await expect(
        caller.memory.promote({
          fleetingMemoryId: fleeting.id,
          subtype: 'fact',
          title: 'Re-promote',
        }),
      ).rejects.toThrow('already been promoted');
    });
  });

  describe('reviewCandidates', () => {
    it('should return only unpromoted fleeting memories', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          {
            workspaceId: ws.id,
            content: 'Unpromoted 1',
            type: 'capture',
            source: 'agent',
            promoted: false,
          },
          {
            workspaceId: ws.id,
            content: 'Unpromoted 2',
            type: 'idea',
            source: 'user',
            promoted: false,
          },
          {
            workspaceId: ws.id,
            content: 'Already promoted',
            type: 'capture',
            source: 'agent',
            promoted: true,
            promotedAt: new Date().toISOString(),
          },
        ])
        .run();

      const result = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(result.length).toBe(2);
      expect(result.every((m) => !m.promoted)).toBe(true);
    });

    it('should return most recent first', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      ctx.db
        .insert(fleetingMemories)
        .values([
          {
            workspaceId: ws.id,
            content: 'Older memory',
            type: 'capture',
            source: 'agent',
            promoted: false,
            createdAt: '2025-01-01T10:00:00.000Z',
          },
          {
            workspaceId: ws.id,
            content: 'Newer memory',
            type: 'capture',
            source: 'agent',
            promoted: false,
            createdAt: '2025-06-01T10:00:00.000Z',
          },
        ])
        .run();

      const result = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(result[0].content).toBe('Newer memory');
      expect(result[result.length - 1].content).toBe('Older memory');
    });

    it('should respect the limit parameter', async () => {
      const ws = await caller.workspace.get({ slug: workspaceSlug });

      const values = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: ws.id,
        content: `Memory ${i}`,
        type: 'capture' as const,
        source: 'agent' as const,
        promoted: false,
      }));
      ctx.db.insert(fleetingMemories).values(values).run();

      const result = await caller.memory.reviewCandidates({ workspaceSlug, limit: 5 });
      expect(result.length).toBe(5);
    });

    it('should throw NOT_FOUND for unknown workspace', async () => {
      await expect(
        caller.memory.reviewCandidates({ workspaceSlug: 'no-such-ws' }),
      ).rejects.toThrow('not found');
    });

    it('should return empty array when no fleeting memories exist', async () => {
      const result = await caller.memory.reviewCandidates({ workspaceSlug });
      expect(result).toEqual([]);
    });
  });
});
