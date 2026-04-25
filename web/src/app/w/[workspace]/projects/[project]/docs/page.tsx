'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualParams, useVirtualSearchParams } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectTree } from '@/components/projects/project-tree';
import { ProjectFrontmatter } from '@/components/projects/project-frontmatter';
import { SpecTasks } from '@/components/specs/spec-tasks';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { RiFileTextLine } from '@remixicon/react';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOnFileChange } from '@/contexts/events-context';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-docs-sidebar-width',
} as const;

export default function ProjectDocsPage() {
  const params = useVirtualParams<{ workspace: string; project: string }>();
  const router = useRouter();
  const searchParams = useVirtualSearchParams();
  const isMobile = useIsMobile();
  const selectedFile = searchParams.get('file');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [prevIsMobile, setPrevIsMobile] = useState(false);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setSidebarCollapsed(isMobile);
  }

  const handleSelectFile = useCallback(
    (file: string | null) => {
      const p = new URLSearchParams();
      if (file) p.set('file', file);
      const qs = p.toString();
      router.replace(
        `/w/${params.workspace}/projects/${params.project}/docs${qs ? `?${qs}` : ''}`,
        { scroll: false },
      );
      if (isMobile) setSidebarCollapsed(true);
    },
    [router, params.workspace, params.project, isMobile],
  );

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      isMobile={isMobile}
      leftCollapsed={sidebarCollapsed}
      onLeftCollapsedChange={setSidebarCollapsed}
      leftContent={
        <ProjectTree
          workspaceSlug={params.workspace}
          projectSlug={params.project}
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
        />
      }
      centerContent={
        selectedFile ? (
          <ProjectDetail
            workspaceSlug={params.workspace}
            projectSlug={params.project}
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

interface ProjectDetailProps {
  workspaceSlug: string;
  projectSlug: string;
  selectedFile: string;
}

function ProjectDetail({ workspaceSlug, projectSlug, selectedFile }: ProjectDetailProps) {
  const utils = trpc.useUtils();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: projectData } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug },
    { enabled: !!workspace },
  );

  const isSpecMd = selectedFile === 'spec.md';

  useOnFileChange(
    useCallback(
      (filePath: string) => {
        if (!filePath.endsWith('/' + selectedFile)) return;
        if (isSpecMd) {
          utils.project.getSpec.invalidate({ workspaceSlug, projectSlug });
        } else {
          utils.project.readFile.invalidate({ workspaceSlug, projectSlug, filePath: selectedFile });
        }
      },
      [utils, workspaceSlug, projectSlug, selectedFile, isSpecMd],
    ),
  );

  const mentionDirs: string[] = [
    ...((workspace?.repos as string[] | undefined) ?? []),
    ...(projectData?.projectDir ? [projectData.projectDir] : []),
  ];

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, `${projectSlug}/${selectedFile}`),
    [workspaceSlug, projectSlug, selectedFile],
  );

  const {
    data: spec,
    isLoading: isSpecLoading,
    error: specError,
  } = trpc.project.getSpec.useQuery(
    { workspaceSlug, projectSlug },
    { enabled: isSpecMd, retry: false },
  );

  const missingSpec = isSpecMd && !isSpecLoading && (!spec || !!specError);

  const { data: fileData, isLoading: isFileLoading } = trpc.project.readFile.useQuery(
    { workspaceSlug, projectSlug, filePath: selectedFile },
    { enabled: !isSpecMd },
  );

  const specUpdateMutation = trpc.project.updateSpec.useMutation({
    onSuccess: () => {
      utils.project.getSpec.invalidate({ workspaceSlug, projectSlug });
    },
  });

  const writeFileMutation = trpc.project.writeFile.useMutation({
    onSuccess: () =>
      utils.project.readFile.invalidate({ workspaceSlug, projectSlug, filePath: selectedFile }),
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
        specMutateRef.current({ workspaceSlug, projectSlug, body: markdown });
      } else {
        fileMutateRef.current({
          workspaceSlug,
          projectSlug,
          filePath: selectedFile,
          content: markdown,
        });
      }
    },
    [isSpecMd, workspaceSlug, projectSlug, selectedFile],
  );

  if (isSpecMd && isSpecLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const editorBody = isSpecMd ? (spec?.body ?? '') : (fileData?.content ?? '');
  const isContentReady = isSpecMd ? !isSpecLoading : !isFileLoading;

  return (
    <Tabs defaultValue="content" className="flex h-full flex-col">
      {isSpecMd && spec && !specError ? (
        <ProjectFrontmatter
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
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
        ) : !isContentReady ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <DynamicDocumentEditor
            key={selectedFile}
            initialMarkdown={editorBody}
            onSave={handleSave}
            comments={true}
            threadStore={threadStore}
            filePath={`${projectSlug}/${selectedFile}`}
            mentionDirs={mentionDirs.length > 0 ? mentionDirs : undefined}
          />
        )}
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={projectSlug} />
      </TabsContent>
    </Tabs>
  );
}
