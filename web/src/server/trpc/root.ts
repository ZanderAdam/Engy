import { router } from './trpc';
import { workspaceRouter } from './routers/workspace';
import { projectRouter } from './routers/project';
import { milestoneRouter } from './routers/milestone';
import { taskGroupRouter } from './routers/task-group';
import { taskRouter } from './routers/task';
import { commentRouter } from './routers/comment';
import { dirRouter } from './routers/dir';
import { diffRouter } from './routers/diff';
import { fileRouter } from './routers/file';
import { executionRouter } from './routers/execution';
import { questionRouter } from './routers/question';
import { memoryRouter } from './routers/memory';
import { searchRouter } from './routers/search';

export const appRouter = router({
  workspace: workspaceRouter,
  project: projectRouter,
  milestone: milestoneRouter,
  taskGroup: taskGroupRouter,
  task: taskRouter,
  comment: commentRouter,
  dir: dirRouter,
  diff: diffRouter,
  file: fileRouter,
  execution: executionRouter,
  question: questionRouter,
  memory: memoryRouter,
  search: searchRouter,
});

/** @public Used by tRPC client setup */
export type AppRouter = typeof appRouter;
