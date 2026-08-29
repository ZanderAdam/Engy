'use client';

import { trpc } from '@/lib/trpc';
import { taskPlanSlug } from '@/lib/plan-naming';

export function useTaskHasPlan(taskId: number, projectId: number | null | undefined) {
  const { data } = trpc.project.getTaskPlans.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: !!projectId },
  );

  const taskSlug = taskPlanSlug(data?.workspaceSlug ?? '', taskId);
  const planFilePath = data?.taskPlans[taskId] ?? '';
  // resolved=true once the plan answer is stable: either no project to query,
  // or the query has returned. Distinct from "loading" — used by callers that
  // need to defer a default UI choice until the answer is known.
  const resolved = !projectId || !!data;

  return { hasPlan: !!planFilePath, taskSlug, planFilePath, resolved };
}
