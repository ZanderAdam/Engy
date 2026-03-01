"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RiArrowRightLine,
  RiDeleteBinLine,
  RiMoreLine,
} from "@remixicon/react";

interface SpecFrontmatterProps {
  workspaceSlug: string;
  specSlug: string;
  title: string;
  status: string;
  type: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-400",
  ready: "bg-blue-500/20 text-blue-400",
  approved: "bg-purple-500/20 text-purple-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-emerald-500/20 text-emerald-400",
};

const nextStatus: Record<string, string | null> = {
  draft: "ready",
  ready: "approved",
  approved: "active",
  active: "completed",
  completed: null,
};

const visionNextStatus: Record<string, string | null> = {
  draft: "completed",
  completed: null,
};

export function SpecFrontmatter({
  workspaceSlug,
  specSlug,
  title,
  status,
  type,
}: SpecFrontmatterProps) {
  const utils = trpc.useUtils();

  const updateMutation = trpc.spec.update.useMutation({
    onSuccess: () => {
      utils.spec.get.invalidate({ workspaceSlug, specSlug });
      utils.spec.list.invalidate({ workspaceSlug });
    },
  });

  const deleteMutation = trpc.spec.delete.useMutation({
    onSuccess: () => {
      utils.spec.list.invalidate({ workspaceSlug });
    },
  });

  const transitions = type === "vision" ? visionNextStatus : nextStatus;
  const next = transitions[status];
  const colorClass = statusColors[status] ?? statusColors.draft;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
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
            updateMutation.mutate({ workspaceSlug, specSlug, status: next as never })
          }
          disabled={updateMutation.isPending}
        >
          <RiArrowRightLine data-icon="inline-start" />
          Mark {next}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <RiMoreLine className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive"
            onClick={() =>
              deleteMutation.mutate({ workspaceSlug, specSlug })
            }
          >
            <RiDeleteBinLine className="size-4" />
            Delete Spec
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
