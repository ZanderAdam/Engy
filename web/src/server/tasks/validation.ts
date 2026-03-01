import { getDb } from '../db/client';
import { tasks } from '../db/schema';

export function detectCycle(
  taskId: number,
  deps: number[],
  allTasks: Map<number, number[]>,
): boolean {
  const visited = new Set<number>();
  const stack = [...deps];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const currentDeps = allTasks.get(current) ?? [];
    stack.push(...currentDeps);
  }

  return false;
}

export function validateDependencies(taskId: number | null, dependencies: number[]): void {
  if (dependencies.length === 0) return;

  const db = getDb();
  const allTasks = new Map<number, number[]>();
  const existingTasks = db.select().from(tasks).all();
  for (const t of existingTasks) {
    allTasks.set(t.id, (t.dependencies as number[]) ?? []);
  }

  for (const depId of dependencies) {
    if (!allTasks.has(depId)) {
      throw new Error(`Dependency task ${depId} does not exist`);
    }
  }

  if (taskId !== null && detectCycle(taskId, dependencies, allTasks)) {
    throw new Error('Circular dependency detected');
  }
}
