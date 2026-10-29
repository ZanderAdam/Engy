import { z } from 'zod';

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'wont_do',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema = z.enum(TASK_STATUSES);

export const KANBAN_LANES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type KanbanLane = (typeof KANBAN_LANES)[number];

export function isClosedTaskStatus(status: string): boolean {
  return status === 'done' || status === 'wont_do';
}

export function kanbanLaneOf(status: TaskStatus): KanbanLane {
  return status === 'wont_do' ? 'done' : status;
}

export function statusAfterLaneDrop(current: TaskStatus, lane: KanbanLane): KanbanLane | null {
  return kanbanLaneOf(current) === lane ? null : lane;
}
