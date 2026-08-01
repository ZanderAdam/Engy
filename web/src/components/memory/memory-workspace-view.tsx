'use client';

import { useState } from 'react';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { MemoryBrowser, type MemorySelection } from '@/components/memory/memory-browser';
import { MemoryDetailOverlay } from '@/components/memory/memory-detail-overlay';
import { DynamicMemoryGraph } from '@/components/memory/dynamic-memory-graph';
import { MemoryForm, type MemoryFormValues } from '@/components/memory/memory-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface MemoryWorkspaceViewProps {
  workspaceSlug: string;
  sidebarStorageKey: string;
}

/**
 * Workspace-scoped memory browser. Memories belong to the workspace, so both the
 * workspace route and a project route render this against the parent workspace slug.
 */
export function MemoryWorkspaceView({
  workspaceSlug,
  sidebarStorageKey,
}: MemoryWorkspaceViewProps) {
  const searchParams = useVirtualSearchParams();
  const initialPath = searchParams.get('path');
  const [selected, setSelected] = useState<MemorySelection | null>(null);
  const [graphSearch, setGraphSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: workspace, isLoading } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const utils = trpc.useUtils();

  // Resolve ?path= query param server-side so deep links work regardless of list pagination.
  const { data: pathResolution, isFetched: pathResolutionFetched } = trpc.memory.getByPath.useQuery(
    { workspaceSlug, filePath: initialPath ?? '' },
    { enabled: !!initialPath, staleTime: 60_000 },
  );

  const pathResolved: MemorySelection | null =
    initialPath && pathResolutionFetched ? (pathResolution ?? null) : null;

  const pathNotFound = !!initialPath && pathResolutionFetched && pathResolution === null;

  // User's explicit click overrides the URL-derived selection; path-resolved is the fallback.
  const effectiveSelected = selected ?? pathResolved;

  const createMutation = trpc.memory.create.useMutation({
    onSuccess: async (result) => {
      await utils.memory.list.invalidate();
      setCreateOpen(false);
      setCreateError(null);
      setSelected({ id: result.id, kind: 'permanent' });
    },
    onError: (err) => {
      setCreateError(err.message);
    },
  });

  const repos: string[] = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];

  function handleCreate(values: MemoryFormValues) {
    createMutation.mutate({
      workspaceSlug,
      subtype: values.subtype,
      title: values.title,
      content: values.content,
      repo: values.repo || undefined,
      confidence: values.confidence,
      tags: values.tags.length > 0 ? values.tags : undefined,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!workspace) return null;

  return (
    <>
      <ThreePanelLayout
        className="flex-1 min-h-0"
        left={{ defaultWidth: 320, minWidth: 240, maxWidth: 480, storageKey: sidebarStorageKey }}
        leftContent={
          <MemoryBrowser
            workspaceSlug={workspaceSlug}
            repos={repos}
            selected={effectiveSelected}
            onSelect={setSelected}
            onCreateNew={() => setCreateOpen(true)}
            onGraphSearchChange={setGraphSearch}
          />
        }
        centerContent={
          <div className="relative flex-1 min-h-0 h-full w-full overflow-hidden">
            <DynamicMemoryGraph
              workspaceSlug={workspaceSlug}
              search={graphSearch}
              onSelect={(sel) => setSelected({ id: sel.dbId, kind: sel.kind })}
            />
            {pathNotFound && !effectiveSelected && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-xs text-muted-foreground bg-card/90 border border-border px-2 py-1">
                Memory not found
              </div>
            )}
            {effectiveSelected && (
              <MemoryDetailOverlay
                selection={effectiveSelected}
                workspaceSlug={workspaceSlug}
                repos={repos}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Permanent Memory</DialogTitle>
          </DialogHeader>
          {createError && <p className="text-xs text-destructive px-1">{createError}</p>}
          <MemoryForm
            repos={repos}
            onSubmit={handleCreate}
            submitLabel="Create"
            isSubmitting={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
