import { router } from './trpc';
import { workspaceRouter } from './routers/workspace';
import { projectRouter } from './routers/project';
import { milestoneRouter } from './routers/milestone';
import { taskGroupRouter } from './routers/task-group';
import { taskRouter } from './routers/task';

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  milestone: milestoneRouter,
  taskGroup: taskGroupRouter,
  task: taskRouter,
});

/** @public Used by tRPC client setup */
export type AppRouter = typeof appRouter;
