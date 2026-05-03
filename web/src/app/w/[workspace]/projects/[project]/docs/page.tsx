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
import { useIsMobile } from '@/hooks/use-mobile';
import { DocDockManager, type DocDockHandle } from '@/components/docs/doc-dock-manager';
import { ProjectDocDockPanel } from '@/components/docs/doc-dock-project-panel';
import { useDocDockHandlers } from '@/components/docs/use-doc-dock-handlers';
import { projectDocGroupKey, type DocScope } from '@/components/docs/types';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-docs-sidebar-width',
} as const;

export default function ProjectDocsPage() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const nav = useVirtualNavigate();
  const searchParams = useVirtualSearchParams();
  const isMobile = useIsMobile();
  const initialFile = searchParams.get('file');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [prevIsMobile, setPrevIsMobile] = useState(false);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setSidebarCollapsed(isMobile);
  }

  const dockRef = useRef<DocDockHandle>(null);
  const [activeFile, setActiveFile] = useState<string | null>(initialFile);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: projectData, error: projectError } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project },
    { enabled: !!workspace, retry: false },
  );

  const updateUrl = useCallback(
    (file: string | null) => {
      const p = new URLSearchParams();
      if (file) p.set('file', file);
      const qs = p.toString();
      nav.push(
        `/w/${params.workspace}/projects/${params.project}/docs${qs ? `?${qs}` : ''}`,
      );
    },
    [nav, params.workspace, params.project],
  );

  const handleActiveFileChange = useCallback(
    (file: string | null) => {
      setActiveFile(file);
      updateUrl(file);
    },
    [updateUrl],
  );

  const onAfterSelect = useCallback(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile]);

  const { onSelectFile, onRenameFile, onDeleteFile, onRenameDir, onDeleteDir } =
    useDocDockHandlers(dockRef, { onAfterSelect });

  const repos: string[] = Array.isArray(workspace?.repos) ? (workspace.repos as string[]) : [];

  const scope: DocScope | null = projectData?.projectDir
    ? {
        scopeType: 'project',
        groupKey: projectDocGroupKey(params.workspace, params.project),
        workspaceSlug: params.workspace,
        projectSlug: params.project,
        rootDir: projectData.projectDir,
      }
    : null;

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      isMobile={isMobile}
      leftCollapsed={sidebarCollapsed}
      onLeftCollapsedChange={setSidebarCollapsed}
      leftContent={
        projectData?.projectDir ? (
          <DirFileTree
            dirPath={projectData.projectDir}
            selectedFile={activeFile}
            onSelectFile={onSelectFile}
            onRenameFile={onRenameFile}
            onDeleteFile={onDeleteFile}
            onRenameDir={onRenameDir}
            onDeleteDir={onDeleteDir}
            label="Files"
          />
        ) : projectError ? (
          <div className="flex flex-col items-center justify-center gap-1 py-10 px-4">
            <p className="text-sm font-medium">Project not found</p>
            <p className="text-xs text-muted-foreground">{projectError.message}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        )
      }
      centerContent={
        scope ? (
          <DocDockManager
            ref={dockRef}
            scope={scope}
            repos={repos}
            panelComponent={ProjectDocDockPanel}
            initialFile={initialFile}
            onActiveFileChange={handleActiveFileChange}
          />
        ) : (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        )
      }
    />
  );
}
