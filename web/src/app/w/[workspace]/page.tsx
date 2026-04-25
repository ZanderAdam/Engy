"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useVirtualParams } from "@/components/tabs/tab-context";
import { RiEditLine } from "@remixicon/react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { EditWorkspaceDialog } from "@/components/workspace/edit-workspace-dialog";

export default function WorkspaceOverviewPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const [editOpen, setEditOpen] = useState(false);

  function handleSaved(newSlug: string) {
    if (newSlug !== params.workspace) {
      router.replace(`/w/${newSlug}`);
    } else {
      utils.workspace.get.invalidate({ slug: params.workspace });
    }
  }

  if (!workspace) return null;

  return (
    <div className="flex flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{workspace.name}</h2>
          <Badge variant="secondary" className="font-mono text-xs">
            {workspace.slug}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="Edit workspace">
          <RiEditLine />
        </Button>
      </div>

      <WorkspaceOverview workspaceId={workspace.id} workspaceSlug={params.workspace} />

      <EditWorkspaceDialog
        workspace={workspace}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleSaved}
        onDeleted={() => router.replace("/")}
      />
    </div>
  );
}
