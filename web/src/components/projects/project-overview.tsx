'use client';

import { useCallback, useMemo, useState } from 'react';
import { isClosedTaskStatus } from '@/lib/task-status';
import { trpc } from '@/lib/trpc';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useVirtualParams } from '@/components/tabs/tab-context';
import { useWatchPaths } from '@/contexts/events-context';
import { planFilePathFromStem } from '@/lib/plan-naming';
import {
  MilestoneList,
  StandaloneGroupList,
  overviewVisibleTasks,
  type TaskListSelection,
} from './milestone-list';
import { MilestoneForm } from './milestone-form';
import { TaskPageDialogs, TaskSelectionBar, useTaskPageController } from './task-page-controller';
import { RiAddLine, RiCheckboxMultipleLine } from '@remixicon/react';

type Project = {
  id: number;
  name: string;
  slug: string;
  status: string;
  projectDir: string | null;
  workspaceId: number;
};

export function ProjectOverview({
  project,
  containerEnabled = false,
}: {
  project: Project;
  containerEnabled?: boolean;
}) {
  const { data: milestones } = trpc.milestone.list.useQuery({ projectId: project.id });
  const { data: tasks } = trpc.task.list.useQuery({ projectId: project.id });
  const { data: taskGroups } = trpc.taskGroup.list.useQuery({ projectId: project.id });

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const utils = trpc.useUtils();

  const params = useVirtualParams<{ workspace: string }>();
  useWatchPaths(params.workspace, project.projectDir ? [`${project.projectDir}/plans`] : []);
  const controller = useTaskPageController({
    planReviewUrl: useCallback(
      (planStem: string) =>
        `/w/${params.workspace}/projects/${project.slug}/docs?file=${planFilePathFromStem(planStem)}`,
      [params.workspace, project.slug],
    ),
    onPlanChange: useCallback(() => {
      utils.project.getBySlug.invalidate();
    }, [utils]),
  });
  const { selection } = controller;
  const taskSelection: TaskListSelection = {
    selectable: selection.isSelecting,
    selectedIds: selection.selectedIds,
    onTaskSelect: selection.toggle,
  };

  const visibleTasks = useMemo(
    () => overviewVisibleTasks(tasks ?? [], milestones ?? [], taskGroups ?? [], showDone),
    [tasks, milestones, taskGroups, showDone],
  );

  const totalTasks = tasks?.length ?? 0;
  const doneTasks = tasks?.filter((t) => isClosedTaskStatus(t.status)).length ?? 0;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <ScrollArea
      role="region"
      aria-label="Project overview"
      className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block"
    >
      <div className="flex flex-col gap-6 py-6">
        <div className="flex items-center gap-3">
          <Progress value={pct} className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {doneTasks}/{totalTasks} tasks
          </span>
        </div>

        <div className="sticky top-0 z-10 bg-background empty:hidden">
          <TaskSelectionBar
            controller={controller}
            visibleTasks={visibleTasks}
            projectId={project.id}
            projectSlug={project.slug}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">Milestones</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Switch id="show-done" size="sm" checked={showDone} onCheckedChange={setShowDone} />
                <Label htmlFor="show-done" className="text-xs text-muted-foreground">
                  Show done
                </Label>
              </div>
              <Button
                size="xs"
                variant={selection.isSelecting ? 'default' : 'ghost'}
                onClick={
                  selection.isSelecting ? selection.exitSelectMode : selection.enterSelectMode
                }
              >
                <RiCheckboxMultipleLine data-icon="inline-start" />
                Select
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setShowMilestoneForm(true)}>
                <RiAddLine data-icon="inline-start" />
                Add
              </Button>
            </div>
          </div>
          <MilestoneList
            projectId={project.id}
            milestones={milestones ?? []}
            showDone={showDone}
            onTaskClick={controller.setSelectedTaskId}
            selection={taskSelection}
            containerEnabled={containerEnabled}
          />
        </div>

        <StandaloneGroupList
          projectId={project.id}
          showDone={showDone}
          onTaskClick={controller.setSelectedTaskId}
          selection={taskSelection}
          containerEnabled={containerEnabled}
        />

        <MilestoneForm
          projectId={project.id}
          open={showMilestoneForm}
          onOpenChange={setShowMilestoneForm}
          onCreated={() => {
            setShowMilestoneForm(false);
            utils.milestone.list.invalidate();
          }}
        />

        <TaskPageDialogs
          controller={controller}
          milestones={milestones ?? []}
          createProjectId={project.id}
        />
      </div>
    </ScrollArea>
  );
}
