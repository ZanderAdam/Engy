'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { trpc } from '@/lib/trpc';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { useOnFileChange } from '@/contexts/events-context';
import { useDocDock } from './doc-dock-context';
import type { DocPanelParams } from './types';

export function WorkspaceDocDockPanel({ params }: IDockviewPanelProps<DocPanelParams>) {
  const { scope, repos } = useDocDock();
  const { workspaceSlug, rootDir } = scope;
  const filePath = params.tab.filePath;

  const utils = trpc.useUtils();

  useOnFileChange(
    useCallback(
      (changedPath: string) => {
        if (!changedPath.endsWith('/' + filePath)) return;
        utils.dir.read.invalidate({ dirPath: rootDir, filePath });
      },
      [utils, rootDir, filePath],
    ),
  );

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, filePath),
    [workspaceSlug, filePath],
  );

  const {
    data: fileData,
    isLoading,
    error,
  } = trpc.dir.read.useQuery({
    dirPath: rootDir,
    filePath,
  });

  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.read.invalidate({ dirPath: rootDir, filePath }),
  });

  const mutateRef = useRef(writeMutation.mutate);
  useEffect(() => {
    mutateRef.current = writeMutation.mutate;
  }, [writeMutation.mutate]);

  const handleSave = useCallback(
    (markdown: string) => {
      mutateRef.current({ dirPath: rootDir, filePath, content: markdown });
    },
    [rootDir, filePath],
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
      initialMarkdown={fileData?.content ?? ''}
      onSave={handleSave}
      comments={true}
      threadStore={threadStore}
      filePath={filePath}
      mentionDirs={repos.length > 0 ? repos : undefined}
    />
  );
}
