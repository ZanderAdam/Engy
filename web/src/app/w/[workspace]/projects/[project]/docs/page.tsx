"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectTree } from "@/components/projects/project-tree";
import { ProjectFrontmatter } from "@/components/projects/project-frontmatter";
import { SpecTasks } from "@/components/specs/spec-tasks";
import { DynamicDocumentEditor } from "@/components/editor/dynamic-document-editor";
import { EngyThreadStore } from "@/components/editor/document-editor";
import { RiFileTextLine, RiSideBarLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";

export default function ProjectDocsPage() {
  const params = useParams<{ workspace: string; project: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFile = searchParams.get("file");

  function updateUrl(file: string | null) {
    const p = new URLSearchParams();
    if (file) p.set("file", file);
    const qs = p.toString();
    router.replace(
      `/w/${params.workspace}/projects/${params.project}/docs${qs ? `?${qs}` : ""}`,
      { scroll: false },
    );
  }

  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const newWidth = Math.min(384, Math.max(180, startWidth + ev.clientX - startX));
        setSidebarWidth(newWidth);
      };
      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  return (
    <div className="flex h-[calc(100vh-9rem)]">
      {!collapsed && (
        <div
          className="shrink-0 border-r border-border overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <ProjectTree
            workspaceSlug={params.workspace}
            projectSlug={params.project}
            selectedFile={selectedFile}
            onSelectFile={(filePath) => updateUrl(filePath)}
          />
        </div>
      )}
      <div className="relative shrink-0 flex items-stretch">
        {!collapsed && (
          <div
            className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={handleMouseDown}
          />
        )}
        <Button
          variant="outline"
          size="icon"
          className="absolute top-2 -left-3 z-10 h-6 w-6 rounded-full border bg-background shadow-sm"
          onClick={() => setCollapsed((c) => !c)}
        >
          <RiSideBarLine className="size-3" />
        </Button>
      </div>
      <div className="flex-1 min-w-0">
        {selectedFile ? (
          <ProjectDetail
            workspaceSlug={params.workspace}
            projectSlug={params.project}
            selectedFile={selectedFile}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
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

  const isSpecMd = selectedFile === "spec.md";

  const threadStore = useMemo(
    () => new EngyThreadStore(workspaceSlug, `${projectSlug}/${selectedFile}`),
    [workspaceSlug, projectSlug, selectedFile],
  );

  const { data: spec, isLoading: isSpecLoading, error } = trpc.project.getSpec.useQuery({
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
        fileMutateRef.current({ workspaceSlug, projectSlug, filePath: selectedFile, content: markdown });
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
          {error?.message ?? "The spec may have been deleted."}
        </p>
      </div>
    );
  }

  const editorBody = isSpecMd ? (spec.body ?? "") : (fileData?.content ?? "");
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
      <div className="px-4 py-1 text-xs text-muted-foreground border-b border-border">
        {selectedFile}
      </div>
      <TabsContent value="content" className="flex flex-1 overflow-visible m-0">
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
          />
        )}
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={projectSlug} />
      </TabsContent>
    </Tabs>
  );
}
