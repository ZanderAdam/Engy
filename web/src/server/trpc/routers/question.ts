import { z } from 'zod';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { questions, tasks, agentSessions } from '../../db/schema';
import { dispatchExecutionStart } from '../../ws/server';
import { broadcastQuestionChange, broadcastTaskChange } from '../../ws/broadcast';
import { buildResumeConfig, buildResumeFlags } from './execution';

export const questionRouter = router({
  list: publicProcedure
    .input(
      z.object({
        taskId: z.number().optional(),
        sessionId: z.string().optional(),
        unanswered: z.boolean().optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDb();

      const conditions = [];
      if (input.taskId !== undefined) {
        conditions.push(eq(questions.taskId, input.taskId));
      }
      if (input.sessionId !== undefined) {
        conditions.push(eq(questions.sessionId, input.sessionId));
      }
      if (input.unanswered) {
        conditions.push(isNull(questions.answer));
      }

      if (conditions.length === 0) {
        return db.select().from(questions).all();
      }

      return db
        .select()
        .from(questions)
        .where(and(...conditions))
        .all();
    }),

  get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => {
    const db = getDb();
    const question = db.select().from(questions).where(eq(questions.id, input.id)).get();
    if (!question) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    let taskContext: { title: string; description: string | null } | null = null;
    if (question.taskId) {
      const task = db.select().from(tasks).where(eq(tasks.id, question.taskId)).get();
      if (task) {
        taskContext = { title: task.title, description: task.description };
      }
    }

    return {
      ...question,
      taskContext,
    };
  }),

  submitAnswers: publicProcedure
    .input(
      z.object({
        answers: z.array(
          z.object({
            questionId: z.number(),
            answer: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      if (input.answers.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No answers provided' });
      }

      const firstQuestion = db
        .select()
        .from(questions)
        .where(eq(questions.id, input.answers[0].questionId))
        .get();
      if (!firstQuestion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }

      // Determine the group: questions sharing the same sessionId (and optionally taskId)
      const groupCondition = firstQuestion.taskId
        ? and(eq(questions.taskId, firstQuestion.taskId), eq(questions.sessionId, firstQuestion.sessionId))
        : eq(questions.sessionId, firstQuestion.sessionId);

      const groupQuestions = db
        .select()
        .from(questions)
        .where(and(groupCondition, isNull(questions.answer)))
        .all();

      if (input.answers.length !== groupQuestions.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Partial submission: expected ${groupQuestions.length} answers, got ${input.answers.length}`,
        });
      }

      const answerMap = new Map(input.answers.map((a) => [a.questionId, a.answer]));
      const now = new Date().toISOString();

      db.transaction((tx) => {
        for (const q of groupQuestions) {
          const answer = answerMap.get(q.id);
          if (!answer) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Missing answer for question ${q.id}`,
            });
          }
          tx.update(questions)
            .set({ answer, answeredAt: now })
            .where(eq(questions.id, q.id))
            .run();
        }

        // Clear task subStatus from 'blocked' if taskId is set
        if (firstQuestion.taskId) {
          tx.update(tasks)
            .set({ subStatus: null, updatedAt: now })
            .where(
              and(eq(tasks.id, firstQuestion.taskId), eq(tasks.subStatus, 'blocked')),
            )
            .run();
        }
      });

      // Build resume prompt from Q&A pairs
      const promptLines = ['Your questions have been answered:\n'];
      for (const q of groupQuestions) {
        const answer = answerMap.get(q.id)!;
        promptLines.push(`Q: ${q.question}`);
        promptLines.push(`A: ${answer}\n`);
      }
      promptLines.push('Continue with the task.');
      const resumePrompt = promptLines.join('\n');

      // Find the latest session for this task/sessionId and dispatch resume
      const sessionCondition = firstQuestion.taskId
        ? eq(agentSessions.taskId, firstQuestion.taskId)
        : eq(agentSessions.sessionId, firstQuestion.sessionId);

      const latestSession = db
        .select()
        .from(agentSessions)
        .where(sessionCondition)
        .orderBy(desc(agentSessions.createdAt))
        .get();

      if (latestSession) {
        // Mirror sendFeedback: reuse the original session row (claude --resume appends to the
        // original JSONL; a new row leaves the UI polling an empty file forever).
        db.update(agentSessions)
          .set({ status: 'active', completionSummary: null, updatedAt: now })
          .where(eq(agentSessions.sessionId, latestSession.sessionId))
          .run();

        const baseFlags = latestSession.taskId
          ? buildResumeFlags(latestSession.taskId, latestSession.sessionId)
          : [];
        const resumeConfig = latestSession.taskId
          ? buildResumeConfig(latestSession.taskId, latestSession.worktreePath)
          : undefined;

        try {
          await dispatchExecutionStart(
            ctx.state,
            latestSession.sessionId,
            resumePrompt,
            [...baseFlags, '--resume', latestSession.sessionId],
            resumeConfig,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          db.update(agentSessions)
            .set({ status: 'stopped', completionSummary: errorMessage, updatedAt: now })
            .where(eq(agentSessions.sessionId, latestSession.sessionId))
            .run();
          if (latestSession.taskId) {
            const reverted = db.update(tasks)
              .set({ subStatus: 'failed' as typeof tasks.$inferInsert.subStatus, updatedAt: now })
              .where(eq(tasks.id, latestSession.taskId))
              .returning()
              .get();
            if (reverted) {
              broadcastTaskChange('updated', latestSession.taskId, reverted.projectId ?? undefined);
            }
          }
          broadcastQuestionChange('answered', firstQuestion.taskId ?? undefined, firstQuestion.sessionId);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to resume execution: ${errorMessage}`,
          });
        }
      }

      broadcastQuestionChange('answered', firstQuestion.taskId ?? undefined, firstQuestion.sessionId);
      return { success: true };
    }),

  unansweredCount: publicProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(({ input }) => {
      const db = getDb();

      if (input.projectId !== undefined) {
        // Count distinct groups (taskId or sessionId) with unanswered questions,
        // filtered to questions whose task belongs to the given project
        const result = db
          .select({
            count: sql<number>`count(distinct coalesce(${questions.taskId}, ${questions.sessionId}))`,
          })
          .from(questions)
          .leftJoin(tasks, eq(questions.taskId, tasks.id))
          .where(
            and(
              isNull(questions.answer),
              eq(tasks.projectId, input.projectId),
            ),
          )
          .get();

        return { count: result?.count ?? 0 };
      }

      const result = db
        .select({
          count: sql<number>`count(distinct coalesce(${questions.taskId}, ${questions.sessionId}))`,
        })
        .from(questions)
        .where(isNull(questions.answer))
        .get();

      return { count: result?.count ?? 0 };
    }),

  unansweredByTask: publicProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(({ input }) => {
      const db = getDb();

      const conditions = [isNull(questions.answer), sql`${questions.taskId} is not null`];

      if (input.projectId !== undefined) {
        const rows = db
          .select({
            taskId: questions.taskId,
            count: sql<number>`count(*)`,
          })
          .from(questions)
          .leftJoin(tasks, eq(questions.taskId, tasks.id))
          .where(
            and(
              ...conditions,
              eq(tasks.projectId, input.projectId),
            ),
          )
          .groupBy(questions.taskId)
          .all();

        const result: Record<number, number> = {};
        for (const row of rows) {
          if (row.taskId !== null) {
            result[row.taskId] = row.count;
          }
        }
        return result;
      }

      const rows = db
        .select({
          taskId: questions.taskId,
          count: sql<number>`count(*)`,
        })
        .from(questions)
        .where(and(...conditions))
        .groupBy(questions.taskId)
        .all();

      const result: Record<number, number> = {};
      for (const row of rows) {
        if (row.taskId !== null) {
          result[row.taskId] = row.count;
        }
      }
      return result;
    }),
});
