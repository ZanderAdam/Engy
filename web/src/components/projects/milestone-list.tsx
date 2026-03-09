"use client";

import { trpc } from "@/lib/trpc";
import { Progress } from "@/components/ui/progress";
import { MilestoneStatusBadge } from "./milestone-status-badge";

type Milestone = {
  ref: string;
  num: number;
  title: string;
  status: string;
  scope?: string | null;
  filename: string;
};

export function MilestoneList({
  projectId,
  milestones,
}: {
  projectId: number;
  milestones: Milestone[];
}) {
  const sorted = [...milestones].sort((a, b) => a.num - b.num);

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((ms) => (
        <MilestoneRow key={ms.ref} projectId={projectId} milestone={ms} />
      ))}
      {sorted.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">No milestones yet</p>
      )}
    </div>
  );
}

function MilestoneRow({
  projectId,
  milestone,
}: {
  projectId: number;
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
          <span className="text-xs text-muted-foreground">M{milestone.num}</span>
          <span className="text-xs font-medium">{milestone.title}</span>
          <MilestoneStatusBadge
            projectId={projectId}
            filename={milestone.filename}
            status={milestone.status}
            clickable
          />
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
