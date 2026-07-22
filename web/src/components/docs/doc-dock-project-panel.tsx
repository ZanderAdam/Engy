'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { trpc } from '@/lib/trpc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectFrontmatter } from '@/components/projects/project-frontmatter';
import { SpecTasks } from '@/components/specs/spec-tasks';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { ImagePreview } from '@/components/editor/image-preview';
import { TextFileEditor } from '@/components/editor/text-file-editor';
import { UnsupportedFilePreview } from '@/components/editor/unsupported-file-preview';
import { fileKind } from '@/lib/file-types';
import { useOnFileChange, useWatchPaths } from '@/contexts/events-context';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { useDocDock } from './doc-dock-context';
import { usePanelOutline } from './use-panel-outline';
import type { DocPanelParams } from './types';

export function ProjectDocDockPanel({ params, api }: IDockviewPanelProps<DocPanelParams>) {
  const { scope, repos } = useDocDock();
  const { editorRef, onOutlineChange } = usePanelOutline(api);
  const { workspaceSlug, projectSlug } = scope;
  if (!projectSlug) throw new Error('ProjectDocDockPanel requires project scope');
  const filePath = params.tab.filePath;
  const isSpecMd = filePath === 'spec.md';
  const kind = isSpecMd ? 'markdown' : fileKind(filePath);

  // Non-markdown tabs render no editor, so clear the outline rather than leave
  // a previously-active document's headings showing.
  useEffect(() => {
    if (kind !== 'markdown') onOutlineChange([]);
  }, [kind, onOutlineChange]);

  const utils = trpc.useUtils();
  const searchParams = useVirtualSearchParams();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  // Combined mode always reads the default branch; `?wt` only rebases content
  // in split mode.
  const worktreeBranch = workspace?.combinedWorktrees
    ? undefined
    : (searchParams.get('wt') ?? undefined);
  const { data: projectData } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug, worktreeBranch },
    { enabled: !!workspace },
  );

  // projectDir is absolute (and worktree-resolved when `?wt` is active).
  useWatchPaths(
    workspaceSlug,
    projectData?.projectDir ? [`${projectData.projectDir}/${filePath}`] : [],
  );

  useOnFileChange(
    useCallback(
      (changedPath: string) => {
        if (!changedPath.endsWith('/' + filePath)) return;
        if (isSpecMd) {
          utils.project.getSpec.invalidate({ workspaceSlug, projectSlug, worktreeBranch });
        } else if (kind === 'image') {
          utils.project.readImage.invalidate({
            workspaceSlug,
            projectSlug,
            filePath,
            worktreeBranch,
          });
        } else if (kind === 'markdown' || kind === 'text') {
          utils.project.readFile.invalidate({
            workspaceSlug,
            projectSlug,
            filePath,
            worktreeBranch,
          });
        }
      },
      [utils, workspaceSlug, projectSlug, filePath, isSpecMd, kind, worktreeBranch],
    ),
  );

  const mentionDirs: string[] = [
    ...repos,
    ...(projectData?.projectDir ? [projectData.projectDir] : []),
  ];

  const threadStore = useMemo(
    () =>
      kind === 'markdown' ? new EngyThreadStore(workspaceSlug, `${projectSlug}/${filePath}`) : undefined,
    [workspaceSlug, projectSlug, filePath, kind],
  );

  const {
    data: spec,
    isLoading: isSpecLoading,
    error: specError,
  } = trpc.project.getSpec.useQuery(
    { workspaceSlug, projectSlug, worktreeBranch },
    { enabled: isSpecMd, retry: false },
  );

  const missingSpec = isSpecMd && !isSpecLoading && (!spec || !!specError);

  const { data: fileData, isLoading: isFileLoading } = trpc.project.readFile.useQuery(
    { workspaceSlug, projectSlug, filePath, worktreeBranch },
    { enabled: !isSpecMd && (kind === 'markdown' || kind === 'text') },
  );

  const imageQuery = trpc.project.readImage.useQuery(
    { workspaceSlug, projectSlug, filePath, worktreeBranch },
    { enabled: kind === 'image' },
  );

  const specUpdateMutation = trpc.project.updateSpec.useMutation({
    onSuccess: () => {
      utils.project.getSpec.invalidate({ workspaceSlug, projectSlug, worktreeBranch });
    },
  });

  const writeFileMutation = trpc.project.writeFile.useMutation({
    onSuccess: () =>
      utils.project.readFile.invalidate({ workspaceSlug, projectSlug, filePath, worktreeBranch }),
  });

  const specMutateRef = useRef(specUpdateMutation.mutate);
  useEffect(() => {
    specMutateRef.current = specUpdateMutation.mutate;
  }, [specUpdateMutation.mutate]);

  const fileMutateRef = useRef(writeFileMutation.mutate);
  useEffect(() => {
    fileMutateRef.current = writeFileMutation.mutate;
  }, [writeFileMutation.mutate]);

  const handleSave = useCallback(
    (markdown: string) => {
      if (isSpecMd) {
        specMutateRef.current({ workspaceSlug, projectSlug, body: markdown, worktreeBranch });
      } else {
        fileMutateRef.current({
          workspaceSlug,
          projectSlug,
          filePath,
          content: markdown,
          worktreeBranch,
        });
      }
    },
    [isSpecMd, workspaceSlug, projectSlug, filePath, worktreeBranch],
  );

  const handleRefresh = useCallback(() => {
    if (isSpecMd) {
      utils.project.getSpec.invalidate({ workspaceSlug, projectSlug, worktreeBranch });
    } else {
      utils.project.readFile.invalidate({ workspaceSlug, projectSlug, filePath, worktreeBranch });
    }
  }, [utils, isSpecMd, workspaceSlug, projectSlug, filePath, worktreeBranch]);

  const editorBody = isSpecMd ? (spec?.body ?? '') : (fileData?.content ?? '');
  const fileName = filePath.split('/').pop() ?? filePath;

  let isContentReady: boolean;
  if (kind === 'image') {
    isContentReady = !imageQuery.isLoading;
  } else if (isSpecMd) {
    isContentReady = !isSpecLoading;
  } else if (kind === 'binary') {
    isContentReady = true;
  } else {
    isContentReady = !isFileLoading;
  }

  let editor;
  if (!isContentReady) {
    editor = (
      <div className="flex items-center justify-center flex-1">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  } else if (kind === 'image') {
    editor = imageQuery.error ? (
      <div className="flex flex-col items-center justify-center gap-2 flex-1">
        <p className="text-sm font-medium">Failed to load image</p>
        <p className="text-xs text-muted-foreground">{imageQuery.error.message}</p>
      </div>
    ) : (
      <ImagePreview dataUri={imageQuery.data!.dataUri} fileName={fileName} />
    );
  } else if (kind === 'binary') {
    editor = <UnsupportedFilePreview fileName={fileName} />;
  } else if (kind === 'text') {
    editor = (
      <TextFileEditor
        key={filePath}
        content={fileData?.content ?? ''}
        onSave={handleSave}
        fileName={fileName}
      />
    );
  } else {
    editor = (
      <DynamicDocumentEditor
        ref={editorRef}
        initialMarkdown={editorBody}
        onSave={handleSave}
        comments={true}
        threadStore={threadStore}
        filePath={`${projectSlug}/${filePath}`}
        mentionDirs={mentionDirs.length > 0 ? mentionDirs : undefined}
        onOutlineChange={onOutlineChange}
        onRefresh={handleRefresh}
      />
    );
  }

  if (!isSpecMd) {
    return <div className="flex h-full flex-col">{editor}</div>;
  }

  return (
    <Tabs defaultValue="content" className="flex h-full flex-col">
      {spec && !specError && projectData?.projectDir ? (
        <ProjectFrontmatter
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectDir={projectData.projectDir}
          title={spec.frontmatter.title}
          status={spec.frontmatter.status}
          type={spec.frontmatter.type}
        >
          <TabsList className="mr-2">
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
        </ProjectFrontmatter>
      ) : (
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <TabsList className="mr-2">
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>
        </div>
      )}
      <TabsContent value="content" className="flex flex-1 overflow-hidden m-0">
        {missingSpec ? (
          <div className="flex flex-col items-center justify-center gap-2 flex-1">
            <p className="text-sm font-medium">spec.md not found</p>
            <p className="text-xs text-muted-foreground">
              Create a file named spec.md in the file tree to enable spec editing.
            </p>
          </div>
        ) : (
          editor
        )}
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={projectSlug} />
      </TabsContent>
    </Tabs>
  );
}
