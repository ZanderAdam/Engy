'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MilestoneList } from './milestone-list';
import { MilestoneForm } from './milestone-form';
import { TaskDialog } from './task-dialog';
import { RiAddLine } from '@remixicon/react';

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

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const totalTasks = tasks?.length ?? 0;
  const doneTasks = tasks?.filter((t) => t.status === 'done').length ?? 0;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div
      role="region"
      aria-label="Project overview"
      tabIndex={0}
      className="engy-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-auto py-6 pr-2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center gap-3">
        <Progress value={pct} className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {doneTasks}/{totalTasks} tasks
        </span>
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
          onTaskClick={setSelectedTaskId}
          containerEnabled={containerEnabled}
        />
      </div>

      <MilestoneForm
        projectId={project.id}
        open={showMilestoneForm}
        onOpenChange={setShowMilestoneForm}
        onCreated={() => {
          setShowMilestoneForm(false);
          utils.milestone.list.invalidate();
        }}
      />

      {selectedTaskId !== null && (
        <TaskDialog
          mode="edit"
          taskId={selectedTaskId}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}
