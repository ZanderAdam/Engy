import { z } from 'zod';
import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { jsonArrayContains } from '../../db/json';
import fs from 'node:fs';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, permanentMemories, fleetingMemories } from '../../db/schema';
import { getWorkspaceDir } from '../../engy-dir/init';
import {
  writePermanentMemory,
  rewritePermanentMemory,
  collectReadmePaths,
  commitFile,
  sanitizeCommitSubject,
  type PermanentMemoryFrontmatter,
} from '../../lib/memory-files';
import { withWorkspaceLock } from '../../lib/workspace-lock';
import { regenerateReadmeChain } from '../../lib/readme-index';
import { autoLink } from '../../search/auto-linker';
import { proposeMemoryMetadata } from '../../lib/promote-proposal';
import { triggerMemoryIndexOnWrite } from '../../search/indexer';
import { broadcastMemoryChange } from '../../ws/broadcast';
import { clusterReviewCandidates } from '../../search/candidate-clusters';

const memorySubtypeSchema = z.enum(['decision', 'pattern', 'fact', 'convention', 'insight']);
const fleetingTypeSchema = z.enum(['capture', 'question', 'blocker', 'idea', 'reference']);

const createInput = z.object({
  workspaceSlug: z.string().min(1),
  subtype: memorySubtypeSchema,
  title: z.string().min(1),
  content: z.string(),
  repo: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  keywords: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  scenarioIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  linkedMemories: z.array(z.string()).optional(),
});

const updateInput = z.object({
  id: z.number(),
  subtype: memorySubtypeSchema.optional(),
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  repo: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  keywords: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  scenarioIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  linkedMemories: z.array(z.string()).optional(),
  supersededById: z.number().nullable().optional(),
});

const listInput = z.object({
  workspaceSlug: z.string().min(1),
  subtype: memorySubtypeSchema.optional(),
  repo: z.string().optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(200).default(50),
  offset: z.number().min(0).default(0),
});

const promoteInput = z.object({
  fleetingMemoryId: z.number(),
  subtype: memorySubtypeSchema,
  title: z.string().min(1),
  content: z.string().optional(),
  repo: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  keywords: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  scenarioIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  linkedMemories: z.array(z.string()).optional(),
});

function buildMemoryFrontmatter(input: {
  title: string;
  subtype: 'decision' | 'pattern' | 'fact' | 'convention' | 'insight';
  repo?: string | null;
  confidence?: number | null;
  keywords?: string[];
  themes?: string[];
  tags?: string[];
  linkedMemories?: string[];
  scenarioIds?: string[];
  sources?: string[];
}): PermanentMemoryFrontmatter {
  const fm: PermanentMemoryFrontmatter = {
    title: input.title,
    subtype: input.subtype,
  };
  if (input.repo != null) fm.repo = input.repo;
  if (input.confidence != null) fm.confidence = input.confidence;
  if (input.keywords) fm.keywords = input.keywords;
  if (input.themes) fm.themes = input.themes;
  if (input.tags) fm.tags = input.tags;
  if (input.linkedMemories) fm.linkedMemories = input.linkedMemories;
  if (input.scenarioIds) fm.scenarioIds = input.scenarioIds;
  if (input.sources) fm.sources = input.sources;
  return fm;
}

interface MemoryGraphNode {
  id: string;
  kind: 'permanent' | 'fleeting';
  dbId: number;
  title: string;
  subtype: string | null;
  type: string | null;
  tags: string[];
  themes: string[];
  repo: string | null;
  createdAt: string;
}

interface MemoryGraphLink {
  source: string;
  target: string;
}

function truncateForTitle(content: string): string {
  return content.length > 60 ? `${content.slice(0, 60)}…` : content;
}

function buildMemoryGraph(workspaceId: number): {
  nodes: MemoryGraphNode[];
  links: MemoryGraphLink[];
} {
  const db = getDb();

  const permanents = db
    .select()
    .from(permanentMemories)
    .where(
      and(eq(permanentMemories.workspaceId, workspaceId), isNull(permanentMemories.supersededById)),
    )
    .all();

  const pending = db
    .select()
    .from(fleetingMemories)
    .where(
      and(
        eq(fleetingMemories.workspaceId, workspaceId),
        sql`${fleetingMemories.promoted} = 0`,
        isNull(fleetingMemories.dismissedAt),
      ),
    )
    .all();

  const nodes: MemoryGraphNode[] = [];
  const nodeIdByFilePath = new Map<string, string>();

  for (const m of permanents) {
    const id = `p:${m.id}`;
    nodes.push({
      id,
      kind: 'permanent',
      dbId: m.id,
      title: m.title,
      subtype: m.subtype,
      type: null,
      tags: (m.tags as string[]) ?? [],
      themes: (m.themes as string[]) ?? [],
      repo: m.repo,
      createdAt: m.createdAt,
    });
    if (m.filePath) nodeIdByFilePath.set(m.filePath, id);
  }

  for (const m of pending) {
    nodes.push({
      id: `f:${m.id}`,
      kind: 'fleeting',
      dbId: m.id,
      title: truncateForTitle(m.content),
      subtype: null,
      type: m.type,
      tags: (m.tags as string[]) ?? [],
      themes: [],
      repo: null,
      createdAt: m.createdAt,
    });
  }

  // Links come only from permanent memories' linkedMemories[] (workspace-relative filePaths).
  // Bidirectional pairs are stored on both sides, so dedupe by the sorted id pair.
  const seenPairs = new Set<string>();
  const links: MemoryGraphLink[] = [];
  for (const m of permanents) {
    const sourceId = `p:${m.id}`;
    for (const linkedPath of (m.linkedMemories as string[]) ?? []) {
      const targetId = nodeIdByFilePath.get(linkedPath);
      if (!targetId || targetId === sourceId) continue;
      const [a, b] = [sourceId, targetId].sort();
      const pairKey = `${a}|${b}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      links.push({ source: a, target: b });
    }
  }

  return { nodes, links };
}

function resolveWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  }
  return ws;
}

/** Shared lookup for the dismiss/restore/delete fleeting-memory mutations below. */
function findOwnedFleetingMemory(workspaceId: number, id: number) {
  const db = getDb();
  const existing = db
    .select()
    .from(fleetingMemories)
    .where(and(eq(fleetingMemories.id, id), eq(fleetingMemories.workspaceId, workspaceId)))
    .get();
  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Fleeting memory not found' });
  }
  return existing;
}

async function deleteMemoryFile(workspaceDir: string, filePath: string, title: string): Promise<void> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
    regenerateReadmeChain(absPath, workspaceDir);
    const readmePaths = collectReadmePaths(workspaceDir, absPath);
    const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
    const safeTitle = sanitizeCommitSubject(title);
    await withWorkspaceLock(workspaceDir, () =>
      commitFile(
        workspaceDir,
        [absPath, ...readmePaths],
        `memory(delete): ${safeTitle}\n\nmemory_id: ${relPath}`,
      ),
    );
  }
}

export const memoryRouter = router({
  create: publicProcedure.input(createInput).mutation(async ({ input }) => {
    const ws = resolveWorkspace(input.workspaceSlug);
    const db = getDb();
    const workspaceDir = getWorkspaceDir(ws);

    // Insert DB row first so a file-write failure can be compensated by
    // deleting the row (workspace.create reference pattern).
    const memory = db
      .insert(permanentMemories)
      .values({
        workspaceId: ws.id,
        subtype: input.subtype,
        title: input.title,
        content: input.content,
        repo: input.repo ?? null,
        confidence: input.confidence ?? 1.0,
        keywords: input.keywords ?? [],
        themes: input.themes ?? [],
        tags: input.tags ?? [],
        linkedMemories: input.linkedMemories ?? [],
        scenarioIds: input.scenarioIds ?? [],
        sources: input.sources ?? [],
        filePath: null,
      })
      .returning()
      .get();

    let filePath: string;
    try {
      filePath = await writePermanentMemory(
        workspaceDir,
        buildMemoryFrontmatter(input),
        input.content,
        'create',
      );
    } catch (err) {
      db.delete(permanentMemories).where(eq(permanentMemories.id, memory.id)).run();
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to write memory file: ${(err as Error).message}`,
      });
    }

    const updated = db
      .update(permanentMemories)
      .set({ filePath })
      .where(eq(permanentMemories.id, memory.id))
      .returning()
      .get()!;

    broadcastMemoryChange('created', ws.id, updated.id);

    autoLink(updated.id, ws.slug).catch((err) =>
      console.error('[autoLink] create failed:', err),
    );

    triggerMemoryIndexOnWrite(ws.slug);

    return updated;
  }),

  update: publicProcedure.input(updateInput).mutation(async ({ input }) => {
    const db = getDb();
    const { id, ...updates } = input;

    const existing = db.select().from(permanentMemories).where(eq(permanentMemories.id, id)).get();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }

    const ws = db.select().from(workspaces).where(eq(workspaces.id, existing.workspaceId)).get();
    if (!ws) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const merged = {
      subtype: updates.subtype ?? existing.subtype,
      title: updates.title ?? existing.title,
      content: updates.content ?? existing.content,
      repo: updates.repo !== undefined ? updates.repo : existing.repo,
      confidence: updates.confidence !== undefined ? updates.confidence : existing.confidence,
      keywords: updates.keywords ?? (existing.keywords as string[]) ?? [],
      themes: updates.themes ?? (existing.themes as string[]) ?? [],
      tags: updates.tags ?? (existing.tags as string[]) ?? [],
      linkedMemories: updates.linkedMemories ?? (existing.linkedMemories as string[]) ?? [],
      scenarioIds: updates.scenarioIds ?? (existing.scenarioIds as string[]) ?? [],
      sources: updates.sources ?? (existing.sources as string[]) ?? [],
    };

    let resolvedFilePath: string | null = existing.filePath ?? null;

    if (existing.filePath) {
      const workspaceDir = getWorkspaceDir(ws);
      // Use the explicitly-passed supersededById when present; otherwise carry the
      // existing value so an unrelated edit does not strip supersededBy from the file.
      const effectiveSupersededById =
        updates.supersededById !== undefined ? updates.supersededById : existing.supersededById;
      let supersededByPath: string | undefined;
      if (effectiveSupersededById != null) {
        const superseder = db
          .select({ filePath: permanentMemories.filePath })
          .from(permanentMemories)
          .where(eq(permanentMemories.id, effectiveSupersededById))
          .get();
        supersededByPath = superseder?.filePath ?? undefined;
      }
      const fm = buildMemoryFrontmatter(merged);
      if (supersededByPath) fm.supersededBy = supersededByPath;
      resolvedFilePath = await rewritePermanentMemory(workspaceDir, existing.filePath, fm, merged.content);
    }

    const supersededByIdUpdate =
      updates.supersededById !== undefined ? { supersededById: updates.supersededById } : {};

    const updated = db
      .update(permanentMemories)
      .set({ ...merged, ...supersededByIdUpdate, filePath: resolvedFilePath, updatedAt: new Date().toISOString() })
      .where(eq(permanentMemories.id, id))
      .returning()
      .get();

    if (!updated) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }

    broadcastMemoryChange('updated', ws.id, updated.id);

    triggerMemoryIndexOnWrite(ws.slug);

    return updated;
  }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();

    const existing = db
      .select()
      .from(permanentMemories)
      .where(eq(permanentMemories.id, input.id))
      .get();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }

    const ws = db.select().from(workspaces).where(eq(workspaces.id, existing.workspaceId)).get();
    if (!ws) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    // Delete the file first so a failure leaves the DB row intact (recoverable state).
    if (existing.filePath) {
      const workspaceDir = getWorkspaceDir(ws);
      await deleteMemoryFile(workspaceDir, existing.filePath, existing.title);
    }

    db.delete(permanentMemories).where(eq(permanentMemories.id, input.id)).run();

    broadcastMemoryChange('deleted', ws.id, input.id);

    triggerMemoryIndexOnWrite(ws.slug);

    return { success: true };
  }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const memory = db
      .select()
      .from(permanentMemories)
      .where(eq(permanentMemories.id, input.id))
      .get();
    if (!memory) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }
    return memory;
  }),

  // Resolves a workspace-relative filePath to a memory. Only permanent memories
  // are path-addressable; fleeting memories have no file and are never resolved here.
  getByPath: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1), filePath: z.string().min(1) }))
    .query(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      const permanent = db
        .select({ id: permanentMemories.id })
        .from(permanentMemories)
        .where(
          and(
            eq(permanentMemories.workspaceId, ws.id),
            eq(permanentMemories.filePath, input.filePath),
          ),
        )
        .get();

      return permanent ? { id: permanent.id, kind: 'permanent' as const } : null;
    }),

  list: publicProcedure.input(listInput).query(({ input }) => {
    const ws = resolveWorkspace(input.workspaceSlug);
    const db = getDb();

    const conditions = [
      eq(permanentMemories.workspaceId, ws.id),
      isNull(permanentMemories.supersededById),
    ];

    if (input.subtype) {
      conditions.push(eq(permanentMemories.subtype, input.subtype));
    }
    if (input.repo) {
      conditions.push(eq(permanentMemories.repo, input.repo));
    }
    if (input.search) {
      const pattern = `%${input.search}%`;
      conditions.push(
        or(like(permanentMemories.title, pattern), like(permanentMemories.content, pattern))!,
      );
    }
    if (input.tags && input.tags.length > 0) {
      for (const tag of input.tags) {
        conditions.push(jsonArrayContains(permanentMemories.tags, tag));
      }
    }

    return db
      .select()
      .from(permanentMemories)
      .where(and(...conditions))
      .orderBy(desc(permanentMemories.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all();
  }),

  graph: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1) }))
    .query(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      return buildMemoryGraph(ws.id);
    }),

  promote: publicProcedure.input(promoteInput).mutation(async ({ input }) => {
    const db = getDb();

    const fleeting = db
      .select()
      .from(fleetingMemories)
      .where(eq(fleetingMemories.id, input.fleetingMemoryId))
      .get();

    if (!fleeting) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Fleeting memory not found' });
    }
    if (fleeting.promoted) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Fleeting memory has already been promoted',
      });
    }

    const ws = db.select().from(workspaces).where(eq(workspaces.id, fleeting.workspaceId)).get();
    if (!ws) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const workspaceDir = getWorkspaceDir(ws);
    const content = input.content ?? fleeting.content;

    const promoteTags = input.tags ?? (fleeting.tags as string[]) ?? [];
    // Preserve the fleeting's own sources when the caller doesn't supply them,
    // so the ingest→distillation→permanent provenance chain is never severed.
    const fleetingSources = (fleeting.sources as string[] | null) ?? [];
    const callerSources = input.sources ?? null;
    const promoteSources =
      callerSources !== null
        ? [...new Set([...callerSources, ...fleetingSources])]
        : fleetingSources;

    // Insert DB rows first so a file-write failure can be compensated by rollback.
    const result = db.transaction((tx) => {
      const permanent = tx
        .insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: input.subtype,
          title: input.title,
          content,
          repo: input.repo ?? null,
          confidence: input.confidence ?? 1.0,
          keywords: input.keywords ?? [],
          themes: input.themes ?? [],
          tags: promoteTags,
          linkedMemories: input.linkedMemories ?? [],
          scenarioIds: input.scenarioIds ?? [],
          sources: promoteSources,
          filePath: null,
        })
        .returning()
        .get();

      tx
        .update(fleetingMemories)
        .set({
          promoted: true,
          promotedAt: new Date().toISOString(),
          promotedFromId: permanent.id,
          // Promoting from the dismissed view is a valid restore path.
          dismissedAt: null,
        })
        .where(eq(fleetingMemories.id, input.fleetingMemoryId))
        .run();

      return permanent;
    });

    let filePath: string;
    try {
      filePath = await writePermanentMemory(
        workspaceDir,
        buildMemoryFrontmatter({
          ...input,
          tags: promoteTags,
          sources: promoteSources,
        }),
        content,
      );
    } catch (err) {
      db.transaction((tx) => {
        tx.delete(permanentMemories).where(eq(permanentMemories.id, result.id)).run();
        tx
          .update(fleetingMemories)
          .set({
            promoted: false,
            promotedAt: null,
            promotedFromId: null,
            dismissedAt: fleeting.dismissedAt,
          })
          .where(eq(fleetingMemories.id, input.fleetingMemoryId))
          .run();
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to write memory file: ${(err as Error).message}`,
      });
    }

    const promoted = db
      .update(permanentMemories)
      .set({ filePath })
      .where(eq(permanentMemories.id, result.id))
      .returning()
      .get()!;

    broadcastMemoryChange('promoted', ws.id, promoted.id);

    autoLink(promoted.id, ws.slug).catch((err) =>
      console.error('[autoLink] promote failed:', err),
    );

    triggerMemoryIndexOnWrite(ws.slug);

    return promoted;
  }),

  reviewCandidates: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string().min(1),
        status: z.enum(['pending', 'dismissed']).default('pending'),
        type: fleetingTypeSchema.optional(),
        search: z.string().optional(),
        tag: z.string().optional(),
        sort: z.enum(['asc', 'desc']).default('desc'),
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      const conditions = [
        eq(fleetingMemories.workspaceId, ws.id),
        sql`${fleetingMemories.promoted} = 0`,
        input.status === 'dismissed'
          ? sql`${fleetingMemories.dismissedAt} IS NOT NULL`
          : isNull(fleetingMemories.dismissedAt),
      ];
      if (input.type) {
        conditions.push(eq(fleetingMemories.type, input.type));
      }
      if (input.search) {
        conditions.push(like(fleetingMemories.content, `%${input.search}%`));
      }
      if (input.tag) {
        conditions.push(jsonArrayContains(fleetingMemories.tags, input.tag));
      }
      const where = and(...conditions);

      const total = db
        .select({ count: sql<number>`count(*)` })
        .from(fleetingMemories)
        .where(where)
        .get()!.count;

      const items = db
        .select()
        .from(fleetingMemories)
        .where(where)
        .orderBy(input.sort === 'asc' ? asc(fleetingMemories.createdAt) : desc(fleetingMemories.createdAt))
        .limit(input.limit)
        .offset(input.offset)
        .all();

      return { items, total };
    }),

  reviewCandidateClusters: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1) }))
    .query(async ({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      return clusterReviewCandidates(ws);
    }),

  dismissFleeting: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1), id: z.number() }))
    .mutation(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      const existing = findOwnedFleetingMemory(ws.id, input.id);
      if (existing.promoted) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot dismiss a memory that has already been promoted',
        });
      }

      const updated = db
        .update(fleetingMemories)
        .set({ dismissedAt: new Date().toISOString() })
        .where(eq(fleetingMemories.id, input.id))
        .returning()
        .get()!;

      broadcastMemoryChange('dismissed', ws.id, input.id);

      return updated;
    }),

  restoreFleeting: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1), id: z.number() }))
    .mutation(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      findOwnedFleetingMemory(ws.id, input.id);

      const updated = db
        .update(fleetingMemories)
        .set({ dismissedAt: null })
        .where(eq(fleetingMemories.id, input.id))
        .returning()
        .get()!;

      broadcastMemoryChange('restored', ws.id, input.id);

      return updated;
    }),

  deleteFleeting: publicProcedure
    .input(z.object({ workspaceSlug: z.string().min(1), id: z.number() }))
    .mutation(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      const existing = findOwnedFleetingMemory(ws.id, input.id);
      if (existing.promoted) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete a memory that has already been promoted — promoted rows are the audit trail',
        });
      }

      db.delete(fleetingMemories).where(eq(fleetingMemories.id, input.id)).run();

      broadcastMemoryChange('deleted', ws.id, input.id);

      return { success: true };
    }),

  createFleeting: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string().min(1),
        content: z.string().min(1),
        type: z.enum(['capture', 'question', 'blocker', 'idea', 'reference']).optional(),
        tags: z.array(z.string()).optional(),
        source: z.enum(['agent', 'user', 'system']).optional(),
        sources: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();
      const memory = db
        .insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: input.content,
          type: input.type ?? 'capture',
          source: input.source ?? 'user',
          tags: input.tags ?? [],
          sources: input.sources ?? [],
        })
        .returning({ id: fleetingMemories.id })
        .get();
      return { id: memory.id };
    }),

  proposePromotion: publicProcedure
    .input(z.object({ fleetingMemoryId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();

      const fleeting = db
        .select()
        .from(fleetingMemories)
        .where(eq(fleetingMemories.id, input.fleetingMemoryId))
        .get();

      if (!fleeting) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fleeting memory not found' });
      }

      const ws = db.select().from(workspaces).where(eq(workspaces.id, fleeting.workspaceId)).get();
      if (!ws) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      return proposeMemoryMetadata(fleeting.content, ws.slug);
    }),
});
