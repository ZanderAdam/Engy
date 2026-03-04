import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { planContent } from '../../db/schema';

export const planContentRouter = router({
  get: publicProcedure
    .input(z.object({ milestoneId: z.number() }))
    .query(({ input }) => {
      const db = getDb();
      return (
        db
          .select()
          .from(planContent)
          .where(eq(planContent.milestoneId, input.milestoneId))
          .get() ?? null
      );
    }),

  upsert: publicProcedure
    .input(
      z.object({
        milestoneId: z.number(),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const existing = db
        .select()
        .from(planContent)
        .where(eq(planContent.milestoneId, input.milestoneId))
        .get();

      if (existing) {
        return db
          .update(planContent)
          .set({ content: input.content, updatedAt: new Date().toISOString() })
          .where(eq(planContent.id, existing.id))
          .returning()
          .get()!;
      }

      return db
        .insert(planContent)
        .values({
          milestoneId: input.milestoneId,
          content: input.content,
        })
        .returning()
        .get();
    }),

  delete: publicProcedure
    .input(z.object({ milestoneId: z.number() }))
    .mutation(({ input }) => {
      const db = getDb();
      db.delete(planContent).where(eq(planContent.milestoneId, input.milestoneId)).run();
      return { success: true };
    }),
});
