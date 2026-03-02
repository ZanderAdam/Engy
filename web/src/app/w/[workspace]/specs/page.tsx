"use client";

import { useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpecTree } from "@/components/specs/spec-tree";
import { SpecFrontmatter } from "@/components/specs/spec-frontmatter";
import { SpecTasks } from "@/components/specs/spec-tasks";
import { DynamicDocumentEditor } from "@/components/editor/dynamic-document-editor";
import { RiFileTextLine } from "@remixicon/react";

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

  return (
    <div className="flex h-[calc(100vh-6rem)]">
      <div className="w-64 min-w-48 max-w-96 shrink-0 border-r border-border resize-x overflow-hidden">
        <SpecTree
          workspaceSlug={params.workspace}
          selectedSpec={selectedSpec}
          onSelectSpec={(slug) => updateUrl(slug, null)}
          onSelectFile={(specSlug, filePath) => updateUrl(specSlug, filePath)}
        />
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

  const handleSave = useCallback(
    (markdown: string) => {
      if (isSpecMd) {
        specUpdateMutation.mutate({ workspaceSlug, specSlug, body: markdown });
      } else {
        writeFileMutation.mutate({ workspaceSlug, specSlug, filePath, content: markdown });
      }
    },
    [isSpecMd, workspaceSlug, specSlug, filePath, specUpdateMutation, writeFileMutation],
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
        />
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={specSlug} />
      </TabsContent>
    </Tabs>
  );
}
