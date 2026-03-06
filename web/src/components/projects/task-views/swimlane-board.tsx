"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Milestone = {
  ref: string;
  num: number;
  title: string;
  status: string;
  filename: string;
};

const milestoneStatusColors: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  planning: "bg-blue-500/10 text-blue-500",
  active: "bg-yellow-500/10 text-yellow-500",
  complete: "bg-green-500/10 text-green-500",
};

export function SwimlaneBoard({
  milestones,
}: {
  milestones: Milestone[];
}) {
  const sorted = [...milestones].sort((a, b) => a.num - b.num);

  if (sorted.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No milestones</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.map((ms) => (
        <MilestoneLane key={ms.ref} milestone={ms} />
      ))}
    </div>
  );
}

function MilestoneLane({
  milestone,
}: {
  milestone: Milestone;
}) {
  const { data: groups } = trpc.taskGroup.list.useQuery({ milestoneRef: milestone.ref });

  return (
    <div className="border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium">{milestone.title}</span>
        <Badge
          variant="outline"
          className={cn("text-[10px]", milestoneStatusColors[milestone.status])}
        >
          {milestone.status}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {(groups ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">No task groups</p>
        )}
        {(groups ?? []).map((group) => (
          <TaskGroupCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}

function TaskGroupCard({
  group,
}: {
  group: { id: number; name: string; status: string | null };
}) {
  const { data: tasks } = trpc.task.list.useQuery({ taskGroupId: group.id });
  const count = tasks?.length ?? 0;

  return (
    <div className="flex flex-col gap-1 border border-border p-2" style={{ minWidth: 140 }}>
      <span className="text-xs font-medium">{group.name}</span>
      <div className="flex items-center gap-2">
        {group.status && (
          <Badge variant="outline" className="text-[10px]">
            {group.status}
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground">
          {count} task{count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
