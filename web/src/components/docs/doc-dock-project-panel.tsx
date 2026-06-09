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
import { isImagePath } from '@/lib/file-types';
import { useOnFileChange } from '@/contexts/events-context';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { useDocDock } from './doc-dock-context';
import type { DocPanelParams } from './types';

export function ProjectDocDockPanel({ params }: IDockviewPanelProps<DocPanelParams>) {
  const { scope, repos } = useDocDock();
  const { workspaceSlug, projectSlug } = scope;
  if (!projectSlug) throw new Error('ProjectDocDockPanel requires project scope');
  const filePath = params.tab.filePath;
  const isSpecMd = filePath === 'spec.md';
  const isImage = isImagePath(filePath);

  const utils = trpc.useUtils();
  const searchParams = useVirtualSearchParams();
  const worktreeBranch = searchParams.get('wt') ?? undefined;

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: projectData } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug, worktreeBranch },
    { enabled: !!workspace },
  );

  useOnFileChange(
    useCallback(
      (changedPath: string) => {
        if (!changedPath.endsWith('/' + filePath)) return;
        if (isSpecMd) {
          utils.project.getSpec.invalidate({ workspaceSlug, projectSlug, worktreeBranch });
        } else if (isImage) {
          utils.project.readImage.invalidate({
            workspaceSlug,
            projectSlug,
            filePath,
            worktreeBranch,
          });
        } else {
          utils.project.readFile.invalidate({
            workspaceSlug,
            projectSlug,
            filePath,
            worktreeBranch,
          });
        }
      },
      [utils, workspaceSlug, projectSlug, filePath, isSpecMd, isImage, worktreeBranch],
    ),
  );

  const mentionDirs: string[] = [
    ...repos,
    ...(projectData?.projectDir ? [projectData.projectDir] : []),
  ];

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, `${projectSlug}/${filePath}`),
    [workspaceSlug, projectSlug, filePath],
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
    { enabled: !isSpecMd && !isImage },
  );

  const imageQuery = trpc.project.readImage.useQuery(
    { workspaceSlug, projectSlug, filePath, worktreeBranch },
    { enabled: isImage },
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

  const editorBody = isSpecMd ? (spec?.body ?? '') : (fileData?.content ?? '');

  let isContentReady: boolean;
  if (isImage) {
    isContentReady = !imageQuery.isLoading;
  } else if (isSpecMd) {
    isContentReady = !isSpecLoading;
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
  } else if (isImage) {
    editor = imageQuery.error ? (
      <div className="flex flex-col items-center justify-center gap-2 flex-1">
        <p className="text-sm font-medium">Failed to load image</p>
        <p className="text-xs text-muted-foreground">{imageQuery.error.message}</p>
      </div>
    ) : (
      <ImagePreview
        dataUri={imageQuery.data!.dataUri}
        fileName={filePath.split('/').pop() ?? filePath}
      />
    );
  } else {
    editor = (
      <DynamicDocumentEditor
        initialMarkdown={editorBody}
        onSave={handleSave}
        comments={true}
        threadStore={threadStore}
        filePath={`${projectSlug}/${filePath}`}
        mentionDirs={mentionDirs.length > 0 ? mentionDirs : undefined}
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
