import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/root';
import { getAppState } from '@/server/trpc/context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ({ state: getAppState() }),
    onError: ({ path, error, input }) => {
      console.error(`[tRPC] ${path}: ${error.message}`, {
        code: error.code,
        input,
        ...(error.cause ? { cause: error.cause } : {}),
      });
    },
  });

export { handler as GET, handler as POST };
