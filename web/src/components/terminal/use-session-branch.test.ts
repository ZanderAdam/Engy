// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, getTrpcClientOptions } from '@/lib/trpc';
import { useSessionBranch } from './use-session-branch';
import type { TerminalScope } from './types';

const BASE: TerminalScope = {
  scopeType: 'project',
  scopeLabel: 'claude: web',
  workingDir: '/repo/docs/projects/initial',
  groupKey: 'project:ws:initial',
  workspaceSlug: 'ws',
};

function Probe({ scope }: { scope: TerminalScope }) {
  const { branch } = useSessionBranch(scope);
  return createElement('span', null, branch ?? 'no-branch');
}

/** What the hook reports, and which directory it asked git about, before any reply. */
function probe(scope: TerminalScope): { branch: string; askedFor: string | null } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(
    createElement(
      trpc.Provider,
      { client: trpc.createClient(getTrpcClientOptions()), queryClient },
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe, { scope }),
      ),
    ),
  );
  const key = queryClient.getQueryCache().getAll()[0]?.queryKey as
    | [string[], { input?: { repoDir?: string } }]
    | undefined;
  return {
    branch: html.replace(/<[^>]*>/g, ''),
    askedFor: key?.[1]?.input?.repoDir ?? null,
  };
}

describe('a terminal session’s branch', () => {
  describe('useSessionBranch', () => {
    it('[FR-GIT-530] should ask git about the directory the agent moved into', () => {
      expect(probe({ ...BASE, agentCwd: '/repo/worktrees/feature' }).askedFor).toBe(
        '/repo/worktrees/feature',
      );
    });

    it('[FR-GIT-530] should ask about the working directory while the agent has not moved', () => {
      expect(probe(BASE).askedFor).toBe(BASE.workingDir);
    });

    it('[FR-GIT-530] should report the recorded branch until git answers', () => {
      expect(probe({ ...BASE, worktreeBranch: 'main' }).branch).toBe('main');
    });

    it('[FR-GIT-530] should report no branch when none was ever recorded', () => {
      expect(probe(BASE).branch).toBe('no-branch');
    });
  });
});
