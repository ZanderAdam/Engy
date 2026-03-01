"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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
    <ResizablePanelGroup orientation="horizontal" className="h-[calc(100vh-8rem)]">
      <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
        <SpecTree
          workspaceSlug={params.workspace}
          selectedSpec={selectedSpec}
          onSelectSpec={setSelectedSpec}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={75}>
        {selectedSpec ? (
          <SpecDetail
            workspaceSlug={params.workspace}
            specSlug={selectedSpec}
          />
        ) : (
          <EmptyState />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
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
}

function SpecDetail({ workspaceSlug, specSlug }: SpecDetailProps) {
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
    <div className="flex h-full flex-col">
      <SpecFrontmatter
        workspaceSlug={workspaceSlug}
        specSlug={specSlug}
        title={spec.frontmatter.title}
        status={spec.frontmatter.status}
        type={spec.frontmatter.type}
      />
      <Tabs defaultValue="content" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden">
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
        <TabsContent value="tasks" className="flex-1 overflow-hidden">
          <SpecTasks
            workspaceSlug={workspaceSlug}
            specSlug={specSlug}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
