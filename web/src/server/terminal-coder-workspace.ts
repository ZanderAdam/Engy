import { eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { workspaces } from './db/schema';
import type { TerminalSessionMeta } from './trpc/context';

// Browser-opened sessions are isolated unless opened in host mode, and only a
// coder backend runs off this machine. Server-spawned agents carry
// containerMode 'host' because the spawn command has no container wrapping.
export function coderWorkspaceForSession(meta: TerminalSessionMeta): string | undefined {
  if (meta.containerMode === 'host' || !meta.workspaceSlug) return undefined;
  const workspace = getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, meta.workspaceSlug))
    .get();
  if (!workspace?.containerEnabled || !workspace.docsDir) return undefined;
  if (workspace.executionBackend !== 'coder') return undefined;
  return (workspace.coderConfig as { workspace: string } | null)?.workspace;
}
