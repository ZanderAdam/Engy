"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpecTree } from "@/components/specs/spec-tree";
import { SpecFrontmatter } from "@/components/specs/spec-frontmatter";
import { SpecComments } from "@/components/specs/spec-comments";
import { SpecTasks } from "@/components/specs/spec-tasks";
import { RiFileTextLine } from "@remixicon/react";

const SpecEditor = dynamic(
  () =>
    import("@/components/specs/spec-editor").then((mod) => mod.SpecEditor),
  { ssr: false },
);

export default function SpecsPage() {
  const params = useParams<{ workspace: string }>();
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-6rem)]">
      <div className="w-64 shrink-0 border-r border-border">
        <SpecTree
          workspaceSlug={params.workspace}
          selectedSpec={selectedSpec}
          onSelectSpec={setSelectedSpec}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selectedSpec ? (
          <SpecDetail
            workspaceSlug={params.workspace}
            specSlug={selectedSpec}
            onDeleted={() => setSelectedSpec(null)}
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
  onDeleted: () => void;
}

function SpecDetail({ workspaceSlug, specSlug, onDeleted }: SpecDetailProps) {
  const { data: spec, isLoading, error } = trpc.spec.get.useQuery({
    workspaceSlug,
    specSlug,
  });

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

  const documentPath = `specs/${specSlug}/spec.md`;

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
      <TabsContent value="content" className="flex flex-1 overflow-hidden m-0">
        <div className="flex-1 overflow-auto">
          <SpecEditor
            workspaceSlug={workspaceSlug}
            specSlug={specSlug}
            initialBody={spec.body}
          />
        </div>
        <div className="w-64 shrink-0">
          <SpecComments
            workspaceSlug={workspaceSlug}
            documentPath={documentPath}
          />
        </div>
      </TabsContent>
      <TabsContent value="tasks" className="flex-1 overflow-hidden m-0">
        <SpecTasks specSlug={specSlug} />
      </TabsContent>
    </Tabs>
  );
}
