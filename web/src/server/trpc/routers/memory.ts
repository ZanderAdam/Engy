import { z } from 'zod';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { workspaces, permanentMemories, fleetingMemories } from '../../db/schema';
import { getWorkspaceDir } from '../../engy-dir/init';
import {
  writePermanentMemory,
  escapeIndexMarkers,
  type PermanentMemoryFrontmatter,
} from '../../lib/memory-files';
import { simpleGit } from 'simple-git';
import matter from 'gray-matter';
import { autoLink } from '../../search/auto-linker';

const memorySubtypeSchema = z.enum(['decision', 'pattern', 'fact', 'convention', 'insight']);

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

function resolveWorkspace(workspaceSlug: string) {
  const db = getDb();
  const ws = db.select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).get();
  if (!ws) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Workspace "${workspaceSlug}" not found` });
  }
  return ws;
}

async function rewriteMemoryFile(
  workspaceDir: string,
  filePath: string,
  fm: {
    title: string;
    subtype: string;
    repo?: string | null;
    confidence?: number | null;
    keywords?: string[];
    themes?: string[];
    tags?: string[];
    linkedMemories?: string[];
    scenarioIds?: string[];
    sources?: string[];
  },
  body: string,
): Promise<void> {
  const safeFm = {
    title: fm.title,
    subtype: fm.subtype,
    ...(fm.repo != null ? { repo: fm.repo } : {}),
    ...(fm.confidence != null ? { confidence: fm.confidence } : {}),
    keywords: fm.keywords ?? [],
    themes: fm.themes ?? [],
    tags: fm.tags ?? [],
    linkedMemories: fm.linkedMemories ?? [],
    scenarioIds: fm.scenarioIds ?? [],
    sources: fm.sources ?? [],
  };

  const safeBody = escapeIndexMarkers(body);
  const fileContent = matter.stringify(safeBody, safeFm);
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath);
  fs.writeFileSync(absPath, fileContent, 'utf8');

  const git = simpleGit(workspaceDir);
  const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
  await git.add([relPath]);
  await git.commit(`memory(edit): ${fm.title}\n\nmemory_id: ${relPath}\nsubtype: ${fm.subtype}`, {
    '--allow-empty': null,
  });
}

async function deleteMemoryFile(workspaceDir: string, filePath: string, title: string): Promise<void> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
    const git = simpleGit(workspaceDir);
    const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, '/');
    await git.add([relPath]);
    await git.commit(`memory(delete): ${title}\n\nmemory_id: ${relPath}`, { '--allow-empty': null });
  }
}

export const memoryRouter = router({
  create: publicProcedure.input(createInput).mutation(async ({ input }) => {
    const ws = resolveWorkspace(input.workspaceSlug);
    const db = getDb();
    const workspaceDir = getWorkspaceDir(ws);

    const filePath = await writePermanentMemory(
      workspaceDir,
      buildMemoryFrontmatter(input),
      input.content,
    );

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
        filePath,
      })
      .returning()
      .get();

    autoLink(memory.id, ws.slug).catch((err) =>
      console.error('[autoLink] create failed:', err),
    );

    return memory;
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

    if (existing.filePath) {
      const workspaceDir = getWorkspaceDir(ws);
      await rewriteMemoryFile(workspaceDir, existing.filePath, merged, merged.content);
    }

    const supersededByIdUpdate =
      updates.supersededById !== undefined ? { supersededById: updates.supersededById } : {};

    const updated = db
      .update(permanentMemories)
      .set({ ...merged, ...supersededByIdUpdate, updatedAt: new Date().toISOString() })
      .where(eq(permanentMemories.id, id))
      .returning()
      .get();

    if (!updated) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found' });
    }

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

    db.delete(permanentMemories).where(eq(permanentMemories.id, input.id)).run();

    if (existing.filePath) {
      const workspaceDir = getWorkspaceDir(ws);
      await deleteMemoryFile(workspaceDir, existing.filePath, existing.title);
    }

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

  list: publicProcedure.input(listInput).query(({ input }) => {
    const ws = resolveWorkspace(input.workspaceSlug);
    const db = getDb();

    const conditions = [eq(permanentMemories.workspaceId, ws.id)];

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

    let rows = db
      .select()
      .from(permanentMemories)
      .where(and(...conditions))
      .orderBy(desc(permanentMemories.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all();

    if (input.tags && input.tags.length > 0) {
      rows = rows.filter((row) => {
        const rowTags = (row.tags as string[]) ?? [];
        return input.tags!.every((tag) => rowTags.includes(tag));
      });
    }

    return rows;
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
    const promoteSources = input.sources ?? (fleeting.sources as string[]) ?? [];

    const filePath = await writePermanentMemory(
      workspaceDir,
      buildMemoryFrontmatter({
        ...input,
        tags: promoteTags,
        sources: promoteSources,
      }),
      content,
    );

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
          filePath,
        })
        .returning()
        .get();

      tx
        .update(fleetingMemories)
        .set({
          promoted: true,
          promotedAt: new Date().toISOString(),
          promotedFromId: permanent.id,
        })
        .where(eq(fleetingMemories.id, input.fleetingMemoryId))
        .run();

      return permanent;
    });

    autoLink(result.id, ws.slug).catch((err) =>
      console.error('[autoLink] promote failed:', err),
    );

    return result;
  }),

  reviewCandidates: publicProcedure
    .input(
      z.object({
        workspaceSlug: z.string().min(1),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(({ input }) => {
      const ws = resolveWorkspace(input.workspaceSlug);
      const db = getDb();

      return db
        .select()
        .from(fleetingMemories)
        .where(
          and(
            eq(fleetingMemories.workspaceId, ws.id),
            sql`${fleetingMemories.promoted} = 0`,
          ),
        )
        .orderBy(desc(fleetingMemories.createdAt))
        .limit(input.limit)
        .all();
    }),
});
