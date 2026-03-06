"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type ProjectWithProgress = {
  id: number;
  name: string;
  slug: string;
  status: string;
  isDefault: boolean;
  taskCount: number;
  completedTasks: number;
};

export function ProjectCard({
  project,
  workspaceSlug,
}: {
  project: ProjectWithProgress;
  workspaceSlug: string;
}) {
  const pct =
    project.taskCount > 0 ? Math.round((project.completedTasks / project.taskCount) * 100) : 0;

  if (project.isDefault) {
    const activeTasks = project.taskCount - project.completedTasks;
    return (
      <Link
        href={`/w/${workspaceSlug}/tasks`}
        className="flex flex-col gap-2 border border-border p-4 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Default Project</span>
          <Badge variant="secondary" className="text-[10px]">
            {activeTasks} active task{activeTasks !== 1 ? "s" : ""}
          </Badge>
        </div>
        <span className="text-xs text-primary">View Tasks</span>
      </Link>
    );
  }

  return (
    <Link
      href={`/w/${workspaceSlug}/projects/${project.slug}`}
      className="flex flex-col gap-2 border border-border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{project.name}</span>
        <Badge variant="secondary" className="text-[10px]">
          {project.status}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {project.completedTasks}/{project.taskCount} tasks
        </span>
      </div>
    </Link>
  );
}
