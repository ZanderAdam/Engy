import { router } from './trpc';
import { workspaceRouter } from './routers/workspace';
import { projectRouter } from './routers/project';
import { milestoneRouter } from './routers/milestone';
import { taskGroupRouter } from './routers/task-group';
import { taskRouter } from './routers/task';
import { commentRouter } from './routers/comment';
import { dirRouter } from './routers/dir';
import { planContentRouter } from './routers/plan-content';

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  milestone: milestoneRouter,
  taskGroup: taskGroupRouter,
  task: taskRouter,
  comment: commentRouter,
  dir: dirRouter,
  planContent: planContentRouter,
});

/** @public Used by tRPC client setup */
export type AppRouter = typeof appRouter;
