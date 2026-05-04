'use client';

import { trpc } from '@/lib/trpc';

export function buildTaskSlug(workspaceSlug: string, taskId: number): string {
  return workspaceSlug ? `${workspaceSlug}-T${taskId}` : '';
}

export function useTaskHasPlan(taskId: number, projectId: number | null | undefined) {
  const { data } = trpc.project.getPlanSlugs.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId },
  );

  const workspaceSlug = data?.workspaceSlug ?? '';
  const taskSlug = buildTaskSlug(workspaceSlug, taskId);
  const hasPlan = !!taskSlug && (data?.planSlugs ?? []).includes(taskSlug);
  const planFilePath = taskSlug ? `plans/${taskSlug}.plan.md` : '';
  // resolved=true once the plan-slug answer is stable: either no project to query,
  // or the query has returned. Distinct from "loading" — used by callers that
  // need to defer a default UI choice until the answer is known.
  const resolved = !projectId || !!data;

  return { hasPlan, taskSlug, planFilePath, resolved };
}
