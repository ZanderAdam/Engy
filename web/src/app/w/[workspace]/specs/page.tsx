"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpecTree } from "@/components/specs/spec-tree";
import { SpecFrontmatter } from "@/components/specs/spec-frontmatter";
import { SpecTasks } from "@/components/specs/spec-tasks";
import { DynamicDocumentEditor } from "@/components/editor/dynamic-document-editor";
import { InMemoryThreadStore, DefaultThreadStoreAuth } from "@/components/editor/document-editor";
import { RiFileTextLine, RiSideBarLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";

const USER_ID = "local-user";

export default function SpecsPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSpec = searchParams.get("spec");
  const selectedFile = searchParams.get("file");

  function updateUrl(spec: string | null, file: string | null) {
    const p = new URLSearchParams();
    if (spec) p.set("spec", spec);
    if (file) p.set("file", file);
    const qs = p.toString();
    router.replace(`/w/${params.workspace}/specs${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [sidebarWidth]);

  return (
    <div className="flex h-[calc(100vh-6rem)]">
      {!collapsed && (
        <div className="shrink-0 border-r border-border overflow-hidden" style={{ width: sidebarWidth }}>
          <SpecTree
            workspaceSlug={params.workspace}
            selectedSpec={selectedSpec}
            onSelectSpec={(slug) => updateUrl(slug, null)}
            onSelectFile={(specSlug, filePath) => updateUrl(specSlug, filePath)}
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
        {selectedSpec ? (
          <SpecDetail
            workspaceSlug={params.workspace}
            specSlug={selectedSpec}
            selectedFile={selectedFile}
            onDeleted={() => updateUrl(null, null)}
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
      <p className="text-sm text-muted-foreground">Select a spec to view</p>
      <p className="text-xs text-muted-foreground">
        Or create a new one from the sidebar.
      </p>
    </div>
  );
}

interface SpecDetailProps {
  workspaceSlug: string;
  specSlug: string;
  selectedFile: string | null;
  onDeleted: () => void;
}

function SpecDetail({ workspaceSlug, specSlug, selectedFile, onDeleted }: SpecDetailProps) {
  const utils = trpc.useUtils();

  const threadStore = useMemo(() => {
    const auth = new DefaultThreadStoreAuth(USER_ID, 'editor');
    return new InMemoryThreadStore(USER_ID, auth);
  }, [specSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  const filePath = selectedFile ?? "spec.md";
  const isSpecMd = filePath === "spec.md";

  const { data: spec, isLoading, error } = trpc.spec.get.useQuery({
    workspaceSlug,
    specSlug,
  });

  const { data: fileData } = trpc.spec.readFile.useQuery(
    { workspaceSlug, specSlug, filePath },
    { enabled: !isSpecMd },
  );

  const specUpdateMutation = trpc.spec.update.useMutation({
    onSuccess: () => utils.spec.get.invalidate({ workspaceSlug, specSlug }),
  });

  const writeFileMutation = trpc.spec.writeFile.useMutation({
    onSuccess: () => utils.spec.readFile.invalidate({ workspaceSlug, specSlug, filePath }),
  });

  const specMutateRef = useRef(specUpdateMutation.mutate);
  useEffect(() => { specMutateRef.current = specUpdateMutation.mutate; }, [specUpdateMutation.mutate]);

  const fileMutateRef = useRef(writeFileMutation.mutate);
  useEffect(() => { fileMutateRef.current = writeFileMutation.mutate; }, [writeFileMutation.mutate]);

  const handleSave = useCallback(
    (markdown: string) => {
      if (isSpecMd) {
        specMutateRef.current({ workspaceSlug, specSlug, body: markdown });
      } else {
        fileMutateRef.current({ workspaceSlug, specSlug, filePath, content: markdown });
      }
    },
    [isSpecMd, workspaceSlug, specSlug, filePath],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading spec...</p>
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

  const editorBody = isSpecMd ? spec.body : (fileData?.content ?? "");

  return (
    <Tabs defaultValue="content" className="flex h-full flex-col">
      <SpecFrontmatter
        workspaceSlug={workspaceSlug}
        specSlug={specSlug}
        title={spec.frontmatter.title}
        status={spec.frontmatter.status}
        type={spec.frontmatter.type}
        onDeleted={onDeleted}
      >
        <TabsList className="mr-2">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
      </SpecFrontmatter>
      {!isSpecMd && (
        <div className="px-4 py-1 text-xs text-muted-foreground border-b border-border">
          {filePath}
        </div>
      )}
      <TabsContent value="content" className="flex flex-1 overflow-visible m-0">
        <DynamicDocumentEditor
          key={filePath}
          initialMarkdown={editorBody}
          onSave={handleSave}
          comments={isSpecMd}
          threadStore={isSpecMd ? threadStore : undefined}
        />
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={specSlug} />
      </TabsContent>
    </Tabs>
  );
}
