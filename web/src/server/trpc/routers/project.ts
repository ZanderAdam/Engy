import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getDb } from '../../db/client.js';
import { projects } from '../../db/schema.js';
import { generateSlug } from '../utils.js';

export const projectRouter = router({
  create: publicProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        name: z.string().min(1),
        specPath: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const slug = generateSlug(input.name);

      return db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          slug,
          specPath: input.specPath,
        })
        .returning()
        .get();
    }),

  list: publicProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId))
        .all();
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    return project;
  }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(['planning', 'active', 'completing', 'archived']),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const result = db
        .update(projects)
        .set({ status: input.status, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, input.id))
        .returning()
        .get();

      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      return result;
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(projects).where(eq(projects.id, input.id)).run();
    return { success: true };
  }),
});
