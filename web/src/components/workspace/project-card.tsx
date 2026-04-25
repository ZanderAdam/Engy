"use client";

import { VLink } from "@/components/tabs/virtual-link";
import { Progress } from "@/components/ui/progress";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";

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

  return (
    <VLink
      href={`/w/${workspaceSlug}/projects/${project.slug}`}
      className="flex flex-col gap-2 border border-border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{project.name}</span>
        <ProjectStatusBadge projectId={project.id} status={project.status} clickable />
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {project.completedTasks}/{project.taskCount} tasks
        </span>
      </div>
    </VLink>
  );
}
