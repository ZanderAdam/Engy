"use client";

import { useVirtualParams } from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { ProjectOverview } from "@/components/projects/project-overview";

export default function ProjectOverviewPage() {
  const params = useVirtualParams<{ workspace: string; project: string }>();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project },
    { enabled: !!workspace },
  );

  if (!workspace || !project) return null;

  return <ProjectOverview project={project} containerEnabled={workspace.containerEnabled ?? false} />;
}
