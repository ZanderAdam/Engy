"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiArrowRightLine } from "@remixicon/react";

type SpecStatus = "draft" | "ready" | "approved" | "active" | "completed";

interface ProjectFrontmatterProps {
  workspaceSlug: string;
  projectSlug: string;
  title: string;
  status: SpecStatus;
  type: string;
  children?: React.ReactNode;
}

const statusColors: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-400",
  ready: "bg-blue-500/20 text-blue-400",
  approved: "bg-purple-500/20 text-purple-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-emerald-500/20 text-emerald-400",
};

const nextStatus: Record<string, SpecStatus | null> = {
  draft: "ready",
  ready: "approved",
  approved: "active",
  active: "completed",
  completed: null,
};

const visionNextStatus: Record<string, SpecStatus | null> = {
  draft: "completed",
  completed: null,
};

export function ProjectFrontmatter({
  workspaceSlug,
  projectSlug,
  title,
  status,
  type,
  children,
}: ProjectFrontmatterProps) {
  const utils = trpc.useUtils();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: projectData } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug },
    { enabled: !!workspace },
  );

  const updateMutation = trpc.project.updateSpec.useMutation({
    onSuccess: () => {
      utils.project.getSpec.invalidate({ workspaceSlug, projectSlug });
      utils.project.listFiles.invalidate({ workspaceSlug, projectSlug });
      if (projectData?.projectDir) {
        utils.dir.listFiles.invalidate({ dirPath: projectData.projectDir });
      }
    },
  });

  const transitions = type === "vision" ? visionNextStatus : nextStatus;
  const next = transitions[status];
  const colorClass = statusColors[status] ?? statusColors.draft;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
      {children}
      <h2 className="text-sm font-semibold flex-1 truncate">{title}</h2>
      <Badge variant="outline" className="text-xs">
        {type}
      </Badge>
      <Badge className={`text-xs ${colorClass} border-0`}>{status}</Badge>
      {next && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            updateMutation.mutate({ workspaceSlug, projectSlug, status: next })
          }
          disabled={updateMutation.isPending}
        >
          <RiArrowRightLine data-icon="inline-start" />
          Mark {next}
        </Button>
      )}
    </div>
  );
}
