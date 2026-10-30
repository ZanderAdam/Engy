import { z } from 'zod';

export const taskTitleSchema = z.string().trim().min(1, 'Task title cannot be empty');
