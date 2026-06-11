import { eq, and, sql, inArray, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../db/client';
import { projects, fleetingMemories, agentSessions, tasks, taskGroups } from '../db/schema';

type FleetingMemory = typeof fleetingMemories.$inferSelect;

function signalScore(memory: FleetingMemory): number {
  const tags = (memory.tags as string[]) ?? [];
  const sources = (memory.sources as string[]) ?? [];
  return (
    (tags.length > 0 ? 1 : 0) +
    (memory.source !== 'agent' ? 1 : 0) +
    (sources.length > 0 ? 1 : 0)
  );
}

class ProjectCompletionService {
  startCompletion(projectId: number): { candidates: FleetingMemory[] } {
    const db = getDb();

    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    db.update(projects)
      .set({ status: 'completing', updatedAt: new Date().toISOString() })
      .where(eq(projects.id, projectId))
      .run();

    const candidates = db
      .select()
      .from(fleetingMemories)
      .where(
        and(
          eq(fleetingMemories.workspaceId, project.workspaceId),
          sql`${fleetingMemories.promoted} = 0`,
        ),
      )
      .all();

    // Sort descending by signal score, then by age (newest first) as tiebreaker
    candidates.sort((a, b) => {
      const scoreDiff = signalScore(b) - signalScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return { candidates };
  }

  archive(projectId: number): { success: boolean } {
    const db = getDb();

    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    if (project.status !== 'completing') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Project must be in 'completing' status before archiving (current: '${project.status}'). Call startCompletion first.`,
      });
    }

    const projectTaskIds = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .all()
      .map((t) => t.id);

    const projectTaskGroupIds = db
      .select({ id: taskGroups.id })
      .from(taskGroups)
      .where(eq(taskGroups.projectId, projectId))
      .all()
      .map((tg) => tg.id);

    const sessionConditions = [
      ...(projectTaskIds.length > 0 ? [inArray(agentSessions.taskId, projectTaskIds)] : []),
      ...(projectTaskGroupIds.length > 0
        ? [inArray(agentSessions.taskGroupId, projectTaskGroupIds)]
        : []),
    ];

    if (sessionConditions.length > 0) {
      db.delete(agentSessions)
        .where(sessionConditions.length === 1 ? sessionConditions[0] : or(...sessionConditions))
        .run();
    }

    db.update(projects)
      .set({ status: 'archived', updatedAt: new Date().toISOString() })
      .where(eq(projects.id, projectId))
      .run();

    return { success: true };
  }
}

export const projectCompletionService = new ProjectCompletionService();
