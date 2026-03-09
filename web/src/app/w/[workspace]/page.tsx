"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RiEditLine } from "@remixicon/react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { EditWorkspaceDialog } from "@/components/workspace/edit-workspace-dialog";

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspace: string }>();
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
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{workspace.name}</h2>
          <Badge variant="secondary" className="mt-1 font-mono text-xs">
            {workspace.slug}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="Edit workspace">
          <RiEditLine />
        </Button>
      </div>

      <Separator />

      <WorkspaceOverview workspaceId={workspace.id} workspaceSlug={params.workspace} />

      <EditWorkspaceDialog
        workspace={workspace}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleSaved}
      />
    </div>
  );
}
