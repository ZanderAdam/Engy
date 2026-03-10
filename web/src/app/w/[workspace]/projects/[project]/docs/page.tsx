'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectTree } from '@/components/projects/project-tree';
import { ProjectFrontmatter } from '@/components/projects/project-frontmatter';
import { SpecTasks } from '@/components/specs/spec-tasks';
import { DynamicDocumentEditor } from '@/components/editor/dynamic-document-editor';
import { EngyThreadStore } from '@/components/editor/document-editor';
import { RiFileTextLine } from '@remixicon/react';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useOnFileChange } from '@/contexts/file-change-context';

const SIDEBAR_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-docs-sidebar-width',
} as const;

export default function ProjectDocsPage() {
  const params = useParams<{ workspace: string; project: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFile = searchParams.get('file');

  function updateUrl(file: string | null) {
    const p = new URLSearchParams();
    if (file) p.set('file', file);
    const qs = p.toString();
    router.replace(
      `/w/${params.workspace}/projects/${params.project}/docs${qs ? `?${qs}` : ''}`,
      { scroll: false },
    );
  }

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={SIDEBAR_CONFIG}
      leftContent={
        <ProjectTree
          workspaceSlug={params.workspace}
          projectSlug={params.project}
          selectedFile={selectedFile}
          onSelectFile={(filePath) => updateUrl(filePath)}
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

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, `${projectSlug}/${selectedFile}`),
    [workspaceSlug, projectSlug, selectedFile],
  );

  const {
    data: spec,
    isLoading: isSpecLoading,
    error,
  } = trpc.project.getSpec.useQuery({
    workspaceSlug,
    projectSlug,
  });

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

  if (isSpecLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium">Spec not found</p>
        <p className="text-xs text-muted-foreground">
          {error?.message ?? 'The spec may have been deleted.'}
        </p>
      </div>
    );
  }

  const editorBody = isSpecMd ? (spec.body ?? '') : (fileData?.content ?? '');
  const isContentReady = isSpecMd ? true : !isFileLoading;

  return (
    <Tabs defaultValue="content" className="flex h-full flex-col">
      {isSpecMd ? (
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
        {!isContentReady ? (
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
          />
        )}
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks
          specSlug={projectSlug}
          workspaceSlug={workspaceSlug}
          projectDir={projectData?.projectDir}
          planSlugs={projectData?.planSlugs}
          repos={workspace?.repos ?? undefined}
        />
      </TabsContent>
    </Tabs>
  );
}
