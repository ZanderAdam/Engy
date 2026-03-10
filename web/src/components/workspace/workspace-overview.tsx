"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "./project-card";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { RiAddLine } from "@remixicon/react";

export function WorkspaceOverview({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: number;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const { data: projects } = trpc.project.listWithProgress.useQuery({ workspaceId });

  if (!projects) return null;

  const visibleProjects = [...projects]
    .filter((p) => !p.isDefault)
    .sort((a, b) => {
      const aArchived = a.status === 'archived' ? 1 : 0;
      const bArchived = b.status === 'archived' ? 1 : 0;
      return aArchived - bArchived;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Projects
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
          <RiAddLine data-icon="inline-start" />
          New Project
        </Button>
      </div>

      {visibleProjects.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No projects yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((p) => (
            <ProjectCard key={p.id} project={p} workspaceSlug={workspaceSlug} />
          ))}
        </div>
      )}

      <CreateProjectDialog
        workspaceSlug={workspaceSlug}
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(slug) => router.push(`/w/${workspaceSlug}/projects/${slug}`)}
      />
    </div>
  );
}
