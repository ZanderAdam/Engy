"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const projectStatusOptions = ["planning", "active", "completing", "archived"] as const;
type ProjectStatus = (typeof projectStatusOptions)[number];

const projectStatusColors: Record<ProjectStatus, string> = {
  planning: "bg-muted text-muted-foreground",
  active: "bg-blue-500/10 text-blue-500",
  completing: "bg-yellow-500/10 text-yellow-500",
  archived: "bg-green-500/10 text-green-500",
};

function nextStatus(current: string): ProjectStatus {
  const idx = projectStatusOptions.indexOf(current as ProjectStatus);
  if (idx === -1 || idx === projectStatusOptions.length - 1) return projectStatusOptions[0];
  return projectStatusOptions[idx + 1];
}

export function ProjectStatusBadge({
  projectId,
  status,
  clickable = false,
  className,
}: {
  projectId: number;
  status: string;
  clickable?: boolean;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const updateStatus = trpc.project.updateStatus.useMutation({
    onSuccess: () => {
      utils.project.get.invalidate();
      utils.project.getBySlug.invalidate();
      utils.project.listWithProgress.invalidate();
    },
  });

  function handleClick(e: React.MouseEvent) {
    if (!clickable) return;
    e.preventDefault();
    e.stopPropagation();
    updateStatus.mutate({ id: projectId, status: nextStatus(status) });
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        projectStatusColors[status as ProjectStatus],
        clickable && "cursor-pointer hover:ring-1 hover:ring-foreground/20",
        className,
      )}
      onClick={clickable ? handleClick : undefined}
    >
      {status}
    </Badge>
  );
}
