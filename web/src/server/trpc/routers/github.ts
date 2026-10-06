import { router, publicProcedure } from '../trpc';
import { getGithubStatus } from '../../github/viewer';

export const githubRouter = router({
  status: publicProcedure.query(({ ctx }) => getGithubStatus(ctx.state)),
});
