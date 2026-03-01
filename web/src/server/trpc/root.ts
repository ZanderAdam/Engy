import { router } from './trpc.js';
import { workspaceRouter } from './routers/workspace.js';
import { projectRouter } from './routers/project.js';
import { milestoneRouter } from './routers/milestone.js';
import { taskGroupRouter } from './routers/task-group.js';
import { taskRouter } from './routers/task.js';

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  milestone: milestoneRouter,
  taskGroup: taskGroupRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;
