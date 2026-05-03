'use client';

import { useCallback, useRef, useState } from 'react';
import {
  useVirtualNavigate,
  useVirtualParams,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { DirFileTree } from '@/components/dir-browser';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { DocDockManager, type DocDockHandle } from '@/components/docs/doc-dock-manager';
import { WorkspaceDocDockPanel } from '@/components/docs/doc-dock-panel';
import { useDocDockHandlers } from '@/components/docs/use-doc-dock-handlers';
import { workspaceDocGroupKey, type DocScope } from '@/components/docs/types';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-workspace-docs-sidebar-width',
} as const;

export default function WorkspaceDocsPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const nav = useVirtualNavigate();
  const searchParams = useVirtualSearchParams();
  const initialFile = searchParams.get('file');

  const dockRef = useRef<DocDockHandle>(null);
  const [activeFile, setActiveFile] = useState<string | null>(initialFile);

  const { data: workspace, isLoading } = trpc.workspace.get.useQuery({ slug: params.workspace });

  const updateUrl = useCallback(
    (file: string | null) => {
      const p = new URLSearchParams();
      if (file) p.set('file', file);
      const qs = p.toString();
      nav.push(`/w/${params.workspace}/docs${qs ? `?${qs}` : ''}`);
    },
    [nav, params.workspace],
  );

  const handleActiveFileChange = useCallback(
    (file: string | null) => {
      setActiveFile(file);
      updateUrl(file);
    },
    [updateUrl],
  );

  const { onSelectFile, onRenameFile, onDeleteFile, onRenameDir, onDeleteDir } =
    useDocDockHandlers(dockRef);

  const repos: string[] = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];

  const scope: DocScope | null = workspace?.resolvedDir
    ? {
        scopeType: 'workspace',
        groupKey: workspaceDocGroupKey(params.workspace),
        workspaceSlug: params.workspace,
        rootDir: workspace.resolvedDir,
      }
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!workspace?.resolvedDir || !scope) return null;

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      leftContent={
        <DirFileTree
          dirPath={workspace.resolvedDir}
          selectedFile={activeFile}
          onSelectFile={onSelectFile}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
          onRenameDir={onRenameDir}
          onDeleteDir={onDeleteDir}
          label="Files"
        />
      }
      centerContent={
        <DocDockManager
          ref={dockRef}
          scope={scope}
          repos={repos}
          panelComponent={WorkspaceDocDockPanel}
          initialFile={initialFile}
          onActiveFileChange={handleActiveFileChange}
        />
      }
    />
  );
}
