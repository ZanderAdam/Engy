"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PlanEditor } from "@/components/projects/plan-editor";
import { RiFileTextLine } from "@remixicon/react";

export default function PlanPage() {
  const params = useParams<{ workspace: string; project: string }>();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project },
    { enabled: !!workspace },
  );
  const { data: milestones } = trpc.milestone.list.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );

  if (!workspace || !project) return null;

  return (
    <div className="flex flex-col gap-4 py-6">
      {project.projectDir && (
        <Link
          href={`/w/${params.workspace}/projects/${params.project}/specs`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <RiFileTextLine className="size-3" />
          View Spec
        </Link>
      )}

      <PlanEditor milestones={milestones ?? []} />
    </div>
  );
}
