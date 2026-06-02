'use client';

import { useState } from 'react';
import { useVirtualParams, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { MemoryBrowser, type MemorySelection } from '@/components/memory/memory-browser';
import { MemoryDetail } from '@/components/memory/memory-detail';
import { MemoryForm, type MemoryFormValues } from '@/components/memory/memory-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SIDEBAR_CONFIG = {
  defaultWidth: 320,
  minWidth: 240,
  maxWidth: 480,
  storageKey: 'engy-workspace-memory-sidebar-width',
} as const;

export default function MemoryPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const searchParams = useVirtualSearchParams();
  const initialPath = searchParams.get('path');
  const [selected, setSelected] = useState<MemorySelection | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: workspace, isLoading } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const utils = trpc.useUtils();

  // Resolve ?path= query param server-side so deep links work regardless of list pagination.
  const { data: pathResolution, isFetched: pathResolutionFetched } = trpc.memory.getByPath.useQuery(
    { workspaceSlug: params.workspace, filePath: initialPath ?? '' },
    { enabled: !!initialPath, staleTime: 60_000 },
  );

  const pathResolved: MemorySelection | null =
    initialPath && pathResolutionFetched ? (pathResolution ?? null) : null;

  const pathNotFound = !!initialPath && pathResolutionFetched && pathResolution === null;

  // User's explicit click overrides the URL-derived selection; path-resolved is the fallback.
  const effectiveSelected = selected ?? pathResolved;

  const [createError, setCreateError] = useState<string | null>(null);

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
      workspaceSlug: params.workspace,
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
        left={SIDEBAR_CONFIG}
        leftContent={
          <MemoryBrowser
            workspaceSlug={params.workspace}
            repos={repos}
            selected={effectiveSelected}
            onSelect={setSelected}
            onCreateNew={() => setCreateOpen(true)}
          />
        }
        centerContent={
          effectiveSelected ? (
            <MemoryDetail
              selection={effectiveSelected}
              workspaceSlug={params.workspace}
              repos={repos}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                {pathNotFound ? 'Memory not found' : 'Select a memory to view'}
              </p>
            </div>
          )
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
