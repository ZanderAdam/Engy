"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const milestoneStatusColors: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  planning: "bg-blue-500/10 text-blue-500",
  active: "bg-yellow-500/10 text-yellow-500",
  complete: "bg-green-500/10 text-green-500",
};

type Milestone = {
  ref: string;
  num: number;
  title: string;
  status: string;
  scope?: string | null;
  filename: string;
};

export function MilestoneList({
  milestones,
}: {
  milestones: Milestone[];
}) {
  const sorted = [...milestones].sort((a, b) => a.num - b.num);

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((ms) => (
        <MilestoneRow key={ms.ref} milestone={ms} />
      ))}
      {sorted.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">No milestones yet</p>
      )}
    </div>
  );
}

function MilestoneRow({
  milestone,
}: {
  milestone: Milestone;
}) {
  const { data: tasks } = trpc.task.list.useQuery({ milestoneRef: milestone.ref });
  const total = tasks?.length ?? 0;
  const done = tasks?.filter((t) => t.status === "done").length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3 border border-border p-3">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{milestone.title}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px]", milestoneStatusColors[milestone.status])}
          >
            {milestone.status}
          </Badge>
        </div>
        {milestone.scope && (
          <p className="text-xs text-muted-foreground line-clamp-1">{milestone.scope}</p>
        )}
      </div>
      <div className="flex w-32 items-center gap-2">
        <Progress value={pct} className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}
