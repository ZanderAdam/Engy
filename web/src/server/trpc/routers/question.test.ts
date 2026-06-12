import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { appRouter } from '../root';
import { setupTestDb, type TestContext } from '../test-helpers';
import { getDb } from '../../db/client';
import { questions, tasks, agentSessions } from '../../db/schema';
import { eq } from 'drizzle-orm';

function createMockDaemon(ctx: TestContext) {
  const sent: string[] = [];
  const mock = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (data: string) => {
      sent.push(data);
      const msg = JSON.parse(data);
      if (msg.type === 'EXECUTION_START_REQUEST') {
        const pending = ctx.state.pendingExecutionStart.get(msg.payload.requestId);
        if (pending) {
          ctx.state.pendingExecutionStart.delete(msg.payload.requestId);
          pending.resolve({ sessionId: 'daemon-session-id' });
        }
      }
    },
  };
  ctx.state.daemon = mock as unknown as WebSocket;
  return { sent };
}

async function seedProject(caller: ReturnType<typeof appRouter.createCaller>) {
  const ws = await caller.workspace.create({ name: 'Q WS' });
  const proj = await caller.project.create({ workspaceSlug: ws.slug, name: 'Q Project' });
  return { ws, proj };
}

function insertQuestion(
  db: ReturnType<typeof getDb>,
  overrides: Partial<{
    taskId: number | null;
    sessionId: string;
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    documentPath: string | null;
    answer: string | null;
    answeredAt: string | null;
  }> = {},
) {
  return db
    .insert(questions)
    .values({
      taskId: overrides.taskId ?? null,
      sessionId: overrides.sessionId ?? 'test-session',
      question: overrides.question ?? 'What color?',
      header: overrides.header ?? 'Color choice',
      options: overrides.options ?? [{ label: 'Red', description: 'A red color' }],
      documentPath: overrides.documentPath ?? null,
      answer: overrides.answer ?? null,
      answeredAt: overrides.answeredAt ?? null,
    })
    .returning()
    .get();
}

describe('question router', () => {
  let ctx: TestContext;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    ctx = setupTestDb();
    caller = appRouter.createCaller({ state: ctx.state });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('list', () => {
    it('should return all questions when no filters provided', async () => {
      const db = getDb();
      insertQuestion(db, { question: 'Q1', sessionId: 'sess-1' });
      insertQuestion(db, { question: 'Q2', sessionId: 'sess-2' });

      const result = await caller.question.list({});

      expect(result).toHaveLength(2);
    });

    it('should filter by taskId', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const db = getDb();
      insertQuestion(db, { taskId: task.id, question: 'Q1', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: null, question: 'Q2', sessionId: 'sess-2' });

      const result = await caller.question.list({ taskId: task.id });

      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('Q1');
    });

    it('should filter by sessionId', async () => {
      const db = getDb();
      insertQuestion(db, { question: 'Q1', sessionId: 'sess-A' });
      insertQuestion(db, { question: 'Q2', sessionId: 'sess-B' });

      const result = await caller.question.list({ sessionId: 'sess-A' });

      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('Q1');
    });

    it('should filter by unanswered', async () => {
      const db = getDb();
      insertQuestion(db, { question: 'Q1', sessionId: 'sess-1', answer: null });
      insertQuestion(db, {
        question: 'Q2',
        sessionId: 'sess-2',
        answer: 'done',
        answeredAt: new Date().toISOString(),
      });

      const result = await caller.question.list({ unanswered: true });

      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('Q1');
    });

    it('should return full options JSON', async () => {
      const db = getDb();
      const opts = [
        { label: 'Red', description: 'A warm color' },
        { label: 'Blue', description: 'A cool color' },
      ];
      insertQuestion(db, { options: opts, sessionId: 'sess-1' });

      const result = await caller.question.list({});

      expect(result[0].options).toEqual(opts);
    });
  });

  describe('get', () => {
    it('should return a single question with task context', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({
        projectId: proj.id,
        title: 'My Task',
        description: 'Task desc',
      });
      const db = getDb();
      const q = insertQuestion(db, {
        taskId: task.id,
        question: 'What framework?',
        documentPath: '/docs/plan.md',
        sessionId: 'sess-1',
      });

      const result = await caller.question.get({ id: q.id });

      expect(result.question).toBe('What framework?');
      expect(result.documentPath).toBe('/docs/plan.md');
      expect(result.taskContext).toEqual({
        title: 'My Task',
        description: 'Task desc',
      });
    });

    it('should return null taskContext when no taskId', async () => {
      const db = getDb();
      const q = insertQuestion(db, { taskId: null, sessionId: 'sess-1' });

      const result = await caller.question.get({ id: q.id });

      expect(result.taskContext).toBeNull();
    });

    it('should throw NOT_FOUND for nonexistent question', async () => {
      await expect(caller.question.get({ id: 9999 })).rejects.toThrow('Question not found');
    });
  });

  describe('unansweredCount', () => {
    it('should count distinct groups with unanswered questions', async () => {
      const { proj } = await seedProject(caller);
      const task1 = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const task2 = await caller.task.create({ projectId: proj.id, title: 'T2' });
      const db = getDb();

      // Two unanswered questions for task1 (1 group)
      insertQuestion(db, { taskId: task1.id, question: 'Q1', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: task1.id, question: 'Q2', sessionId: 'sess-1' });
      // One unanswered question for task2 (1 group)
      insertQuestion(db, { taskId: task2.id, question: 'Q3', sessionId: 'sess-2' });

      const result = await caller.question.unansweredCount({ projectId: proj.id });

      expect(result.count).toBe(2);
    });

    it('should not count answered questions', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const db = getDb();

      insertQuestion(db, {
        taskId: task.id,
        answer: 'done',
        answeredAt: new Date().toISOString(),
        sessionId: 'sess-1',
      });

      const result = await caller.question.unansweredCount({ projectId: proj.id });

      expect(result.count).toBe(0);
    });

    it('should count all groups when no projectId', async () => {
      const db = getDb();
      insertQuestion(db, { taskId: null, question: 'Q1', sessionId: 'sess-A' });
      insertQuestion(db, { taskId: null, question: 'Q2', sessionId: 'sess-B' });

      const result = await caller.question.unansweredCount({});

      expect(result.count).toBe(2);
    });
  });

  describe('unansweredByTask', () => {
    it('should return taskId to unanswered count map', async () => {
      const { proj } = await seedProject(caller);
      const task1 = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const task2 = await caller.task.create({ projectId: proj.id, title: 'T2' });
      const task3 = await caller.task.create({ projectId: proj.id, title: 'T3' });
      const db = getDb();

      insertQuestion(db, { taskId: task1.id, question: 'Q1', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: task1.id, question: 'Q2', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: task3.id, question: 'Q3', sessionId: 'sess-3' });
      // task2 has an answered question (should not appear)
      insertQuestion(db, {
        taskId: task2.id,
        answer: 'done',
        answeredAt: new Date().toISOString(),
        sessionId: 'sess-2',
      });

      const result = await caller.question.unansweredByTask({ projectId: proj.id });

      expect(result).toEqual({ [task1.id]: 2, [task3.id]: 1 });
    });

    it('should return empty map when no unanswered questions', async () => {
      const result = await caller.question.unansweredByTask({});

      expect(result).toEqual({});
    });
  });

  describe('submitAnswers', () => {
    it('should reject partial submissions', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const db = getDb();

      const q1 = insertQuestion(db, { taskId: task.id, question: 'Q1', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: task.id, question: 'Q2', sessionId: 'sess-1' });
      insertQuestion(db, { taskId: task.id, question: 'Q3', sessionId: 'sess-1' });

      await expect(
        caller.question.submitAnswers({
          answers: [{ questionId: q1.id, answer: 'Red' }],
        }),
      ).rejects.toThrow('Partial submission');
    });

    it('should store answers and clear task blocked subStatus', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({
        projectId: proj.id,
        title: 'Blocked Task',
        subStatus: 'blocked',
      });
      const db = getDb();

      const q1 = insertQuestion(db, { taskId: task.id, question: 'Q1', sessionId: 'sess-1' });
      const q2 = insertQuestion(db, { taskId: task.id, question: 'Q2', sessionId: 'sess-1' });

      // Create a session for this task so resume can find it
      db.insert(agentSessions)
        .values({
          sessionId: 'original-sess',
          executionMode: 'task',
          status: 'active',
          taskId: task.id,
        })
        .run();

      createMockDaemon(ctx);

      await caller.question.submitAnswers({
        answers: [
          { questionId: q1.id, answer: 'Answer 1' },
          { questionId: q2.id, answer: 'Answer 2' },
        ],
      });

      // Verify answers are stored
      const updatedQ1 = db.select().from(questions).where(eq(questions.id, q1.id)).get();
      expect(updatedQ1!.answer).toBe('Answer 1');
      expect(updatedQ1!.answeredAt).toBeDefined();

      const updatedQ2 = db.select().from(questions).where(eq(questions.id, q2.id)).get();
      expect(updatedQ2!.answer).toBe('Answer 2');

      // Verify task subStatus is cleared
      const updatedTask = db.select().from(tasks).where(eq(tasks.id, task.id)).get();
      expect(updatedTask!.subStatus).toBeNull();
    });

    it('should dispatch EXECUTION_START_REQUEST reusing the original session row', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({
        projectId: proj.id,
        title: 'T1',
        subStatus: 'blocked',
      });
      const db = getDb();

      const q1 = insertQuestion(db, {
        taskId: task.id,
        question: 'What color?',
        sessionId: 'sess-1',
      });

      db.insert(agentSessions)
        .values({
          sessionId: 'original-sess',
          executionMode: 'task',
          status: 'active',
          taskId: task.id,
        })
        .run();

      const { sent } = createMockDaemon(ctx);

      await caller.question.submitAnswers({
        answers: [{ questionId: q1.id, answer: 'Blue' }],
      });

      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('EXECUTION_START_REQUEST');
      expect(msg.payload.prompt).toContain('Your questions have been answered');
      expect(msg.payload.prompt).toContain('Q: What color?');
      expect(msg.payload.prompt).toContain('A: Blue');
      expect(msg.payload.flags).toContain('--resume');
      expect(msg.payload.flags).toContain('original-sess');

      // Fix: must reuse the original session row (not insert a new one)
      const sessions = db.select().from(agentSessions).all();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('original-sess');
      expect(sessions[0].status).toBe('active');

      // The dispatched sessionId must be the original session id (so claude --resume finds the right JSONL)
      expect(msg.payload.sessionId).toBe('original-sess');
    });

    it('should leave no orphaned active row and broadcast when dispatch fails', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'T1', subStatus: 'blocked' });
      const db = getDb();

      const q1 = insertQuestion(db, { taskId: task.id, question: 'Q1', sessionId: 'sess-1' });

      db.insert(agentSessions)
        .values({
          sessionId: 'original-sess',
          executionMode: 'task',
          status: 'active',
          taskId: task.id,
        })
        .run();

      // Failing daemon
      const mock = {
        readyState: WebSocket.OPEN,
        OPEN: WebSocket.OPEN,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === 'EXECUTION_START_REQUEST') {
            const pending = ctx.state.pendingExecutionStart.get(msg.payload.requestId);
            if (pending) {
              ctx.state.pendingExecutionStart.delete(msg.payload.requestId);
              pending.reject(new Error('daemon crashed'));
            }
          }
        },
      };
      ctx.state.daemon = mock as unknown as WebSocket;

      await expect(
        caller.question.submitAnswers({ answers: [{ questionId: q1.id, answer: 'Yes' }] }),
      ).rejects.toThrow('Failed to resume execution');

      // Session must be marked stopped, not left active
      const session = db.select().from(agentSessions).where(eq(agentSessions.sessionId, 'original-sess')).get();
      expect(session!.status).toBe('stopped');
    });

    it('should throw when no daemon connected for resume', async () => {
      const { proj } = await seedProject(caller);
      const task = await caller.task.create({ projectId: proj.id, title: 'T1' });
      const db = getDb();

      const q1 = insertQuestion(db, { taskId: task.id, question: 'Q1', sessionId: 'sess-1' });

      db.insert(agentSessions)
        .values({
          sessionId: 'original-sess',
          executionMode: 'task',
          status: 'active',
          taskId: task.id,
        })
        .run();

      // No daemon set up — should throw
      await expect(
        caller.question.submitAnswers({
          answers: [{ questionId: q1.id, answer: 'Yes' }],
        }),
      ).rejects.toThrow('No daemon connected');
    });

    it('should reject empty answers array', async () => {
      await expect(
        caller.question.submitAnswers({ answers: [] }),
      ).rejects.toThrow('No answers provided');
    });
  });
});
