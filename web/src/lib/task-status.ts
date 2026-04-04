import { z } from 'zod';

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema = z.enum(TASK_STATUSES);
