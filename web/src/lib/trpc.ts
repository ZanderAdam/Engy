import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/root";

export const trpc = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * A batch travels in the URL of a GET, and Node rejects a request line past its
 * 16 KB header budget with a 431 whose body is empty — which every call in the
 * batch then reports as a JSON parse failure. Refreshing a large diff invalidates
 * every open patch at once and lands well past that, so batches are split first.
 */
export const MAX_BATCH_URL_LENGTH = 8000;

export function getTrpcClientOptions() {
  return {
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        maxURLLength: MAX_BATCH_URL_LENGTH,
      }),
    ],
  };
}
