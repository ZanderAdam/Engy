'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { trpc } from '@/lib/trpc';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { FileContentPreview } from '@/components/editor/file-content-preview';
import { fileKind } from '@/lib/file-types';
import { useOnFileChange } from '@/contexts/events-context';
import { useDocDock } from './doc-dock-context';
import { usePanelOutline } from './use-panel-outline';
import type { DocPanelParams } from './types';

export function WorkspaceDocDockPanel({ params, api }: IDockviewPanelProps<DocPanelParams>) {
  const { scope, repos } = useDocDock();
  const { editorRef, onOutlineChange } = usePanelOutline(api);
  const { workspaceSlug, rootDir } = scope;
  const filePath = params.tab.filePath;
  const kind = fileKind(filePath);

  // Non-markdown tabs render no editor, so clear the outline rather than leave
  // a previously-active document's headings showing.
  useEffect(() => {
    if (kind !== 'markdown') onOutlineChange([]);
  }, [kind, onOutlineChange]);

  const utils = trpc.useUtils();

  useOnFileChange(
    useCallback(
      (changedPath: string) => {
        if (!changedPath.endsWith('/' + filePath)) return;
        if (kind === 'image') {
          utils.dir.readImage.invalidate({ dirPath: rootDir, filePath });
        } else if (kind === 'markdown' || kind === 'text') {
          utils.dir.read.invalidate({ dirPath: rootDir, filePath });
        }
      },
      [utils, rootDir, filePath, kind],
    ),
  );

  const threadStore = useMemo(
    () => (kind === 'markdown' ? new EngyThreadStore(workspaceSlug, filePath) : undefined),
    [workspaceSlug, filePath, kind],
  );

  const {
    data: fileData,
    isLoading,
    error,
  } = trpc.dir.read.useQuery(
    { dirPath: rootDir, filePath },
    { enabled: kind === 'markdown' || kind === 'text' },
  );

  const imageQuery = trpc.dir.readImage.useQuery(
    { dirPath: rootDir, filePath },
    { enabled: kind === 'image' },
  );

  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.read.invalidate({ dirPath: rootDir, filePath }),
  });

  const mutateRef = useRef(writeMutation.mutate);
  useEffect(() => {
    mutateRef.current = writeMutation.mutate;
  }, [writeMutation.mutate]);

  const handleSave = useCallback(
    (content: string) => {
      mutateRef.current({ dirPath: rootDir, filePath, content });
    },
    [rootDir, filePath],
  );

  // Only wired to the markdown editor, whose content comes from dir.read.
  const handleRefresh = useCallback(() => {
    utils.dir.read.invalidate({ dirPath: rootDir, filePath });
  }, [utils, rootDir, filePath]);

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <FileContentPreview
      kind={kind}
      fileName={fileName}
      image={{ isLoading: imageQuery.isLoading, error: imageQuery.error, dataUri: imageQuery.data?.dataUri }}
      fileLoading={isLoading}
      fileError={error}
      textContent={fileData?.content ?? ''}
      textKey={filePath}
      onSaveText={handleSave}
    >
      <DynamicDocumentEditor
        ref={editorRef}
        initialMarkdown={fileData?.content ?? ''}
        onSave={handleSave}
        comments={true}
        threadStore={threadStore}
        filePath={filePath}
        mentionDirs={repos.length > 0 ? repos : undefined}
        onOutlineChange={onOutlineChange}
        onRefresh={handleRefresh}
      />
    </FileContentPreview>
  );
}
