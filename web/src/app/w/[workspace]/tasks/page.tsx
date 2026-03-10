"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EisenhowerMatrix } from "@/components/projects/task-views/eisenhower-matrix";
import { useOnFileChange } from "@/contexts/file-change-context";
import { TaskDialog } from "@/components/projects/task-dialog";
import { Button } from "@/components/ui/button";
import { RiAddLine } from "@remixicon/react";

const DEBOUNCE_MS = 500;

export default function TasksPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const { data: workspace } = trpc.workspace.get.useQuery({ slug: params.workspace });
  const { data: allProjects } = trpc.project.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );

  const defaultProject = allProjects?.find((p) => p.isDefault);

  const { data: projectDetails } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: defaultProject?.slug ?? '' },
    { enabled: !!workspace && !!defaultProject },
  );

  const { data: tasks } = trpc.task.list.useQuery(
    { projectId: defaultProject?.id ?? 0 },
    { enabled: !!defaultProject },
  );

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);

  const utils = trpc.useUtils();
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useOnFileChange(
    useCallback(
      (filePath: string, eventType: string) => {
        const planMatch = filePath.match(/\/plans\/([^/]+)\.plan\.md$/);
        if (!planMatch) return;

        const taskSlug = planMatch[1];
        const existing = debounceTimers.current.get(taskSlug);
        if (existing) clearTimeout(existing);

        debounceTimers.current.set(
          taskSlug,
          setTimeout(() => {
            debounceTimers.current.delete(taskSlug);
            utils.project.getBySlug.invalidate({
              workspaceId: workspace?.id ?? 0,
              slug: defaultProject?.slug ?? 'default',
            });

            if (eventType !== 'unlink') {
              toast(`Plan ready for ${taskSlug}`, {
                action: {
                  label: 'Review',
                  onClick: () => {
                    router.push(
                      `/w/${params.workspace}/docs?file=projects/default/plans/${taskSlug}.plan.md`,
                    );
                  },
                },
              });
            }
          }, DEBOUNCE_MS),
        );
      },
      [utils, router, params.workspace, workspace?.id, defaultProject?.slug],
    ),
  );

  if (!workspace || !defaultProject) return null;

  const skills = { plan: workspace.planSkill, implement: workspace.implementSkill };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <Button variant="outline" size="sm" onClick={() => setShowNewTask(true)}>
          <RiAddLine data-icon="inline-start" />
          New Task
        </Button>
      </div>

      <EisenhowerMatrix
        tasks={tasks ?? []}
        workspaceSlug={params.workspace}
        projectDir={projectDetails?.projectDir}
        planSlugs={projectDetails?.planSlugs}
        repos={workspace.repos ?? undefined}
        skills={skills}
        onTaskClick={setSelectedTaskId}
      />

      {selectedTaskId !== null && (
        <TaskDialog
          mode="edit"
          taskId={selectedTaskId}
          open
          onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        />
      )}

      <TaskDialog
        mode="create"
        projectId={defaultProject.id}
        open={showNewTask}
        onOpenChange={setShowNewTask}
        onCreated={() => {
          setShowNewTask(false);
          utils.task.list.invalidate();
        }}
      />
    </div>
  );
}
