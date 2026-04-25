'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualParams, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { EditableFileTree } from '@/components/editable-file-tree';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { RiFileTextLine } from '@remixicon/react';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useOnFileChange } from '@/contexts/events-context';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-workspace-docs-sidebar-width',
} as const;

export default function WorkspaceDocsPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const router = useRouter();
  const searchParams = useVirtualSearchParams();
  const selectedFile = searchParams.get('file');

  const { data: workspace, isLoading } = trpc.workspace.get.useQuery({ slug: params.workspace });

  function updateUrl(file: string | null) {
    const p = new URLSearchParams();
    if (file) p.set('file', file);
    const qs = p.toString();
    router.replace(`/w/${params.workspace}/docs${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!workspace?.resolvedDir) return null;

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      leftContent={
        <EditableFileTree
          dirPath={workspace.resolvedDir}
          selectedFile={selectedFile}
          onSelectFile={updateUrl}
        />
      }
      centerContent={
        selectedFile ? (
          <WorkspaceDocDetail
            workspaceSlug={params.workspace}
            resolvedDir={workspace.resolvedDir}
            repos={(workspace.repos as string[]) ?? []}
            selectedFile={selectedFile}
          />
        ) : (
          <EmptyState />
        )
      }
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <RiFileTextLine className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">Select a file to view</p>
    </div>
  );
}

interface WorkspaceDocDetailProps {
  workspaceSlug: string;
  resolvedDir: string;
  repos: string[];
  selectedFile: string;
}

function WorkspaceDocDetail({
  workspaceSlug,
  resolvedDir,
  repos,
  selectedFile,
}: WorkspaceDocDetailProps) {
  const utils = trpc.useUtils();

  useOnFileChange(
    useCallback(
      (filePath: string) => {
        if (!filePath.endsWith('/' + selectedFile)) return;
        utils.dir.read.invalidate({ dirPath: resolvedDir, filePath: selectedFile });
      },
      [utils, resolvedDir, selectedFile],
    ),
  );

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, selectedFile),
    [workspaceSlug, selectedFile],
  );

  const {
    data: fileData,
    isLoading,
    error,
  } = trpc.dir.read.useQuery({
    dirPath: resolvedDir,
    filePath: selectedFile,
  });

  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.read.invalidate({ dirPath: resolvedDir, filePath: selectedFile }),
  });

  const mutateRef = useRef(writeMutation.mutate);
  useEffect(() => {
    mutateRef.current = writeMutation.mutate;
  }, [writeMutation.mutate]);

  const handleSave = useCallback(
    (markdown: string) => {
      mutateRef.current({ dirPath: resolvedDir, filePath: selectedFile, content: markdown });
    },
    [resolvedDir, selectedFile],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium">Failed to load file</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <DynamicDocumentEditor
      key={selectedFile}
      initialMarkdown={fileData?.content ?? ''}
      onSave={handleSave}
      comments={true}
      threadStore={threadStore}
      filePath={selectedFile}
      mentionDirs={repos.length > 0 ? repos : undefined}
    />
  );
}
