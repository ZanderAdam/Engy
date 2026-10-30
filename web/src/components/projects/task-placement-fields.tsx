'use client';

import { trpc } from '@/lib/trpc';
import { Label } from '@/components/ui/label';
import { OptionCombobox } from '@/components/projects/option-combobox';
import {
  groupOption,
  milestoneOption,
  type FilterOption,
} from '@/components/projects/task-filter-options';
import {
  groupChoices,
  placeInGroup,
  placeInMilestone,
  type TaskPlacement,
} from '@/components/projects/task-placement';

const NONE = 'none';
const NONE_OPTION: FilterOption = { value: NONE, label: 'None' };

function selectedLabel(options: FilterOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function TaskPlacementFields({
  projectId,
  value,
  onChange,
}: {
  projectId: number;
  value: TaskPlacement;
  onChange: (placement: TaskPlacement) => void;
}) {
  const { data: milestones = [] } = trpc.milestone.list.useQuery({ projectId });
  const { data: groups } = trpc.taskGroup.list.useQuery({ projectId });
  if (!groups) return null;

  const milestoneValue = value.milestoneRef ?? NONE;
  const groupValue = value.taskGroupId?.toString() ?? NONE;
  const milestoneOptions = [NONE_OPTION, ...milestones.map(milestoneOption)];
  const groupOptions = [NONE_OPTION, ...groupChoices(groups, value).map(groupOption)];
  const showMilestones = milestones.length > 0 || value.milestoneRef !== null;
  const showGroups = groups.length > 0 || value.taskGroupId !== null;

  return (
    <>
      {showMilestones && (
        <div className="flex flex-col gap-1.5">
          <Label>Milestone</Label>
          <OptionCombobox
            label="Milestones"
            options={milestoneOptions}
            selected={[milestoneValue]}
            onSelect={(ref) => onChange(placeInMilestone(value, ref === NONE ? null : ref, groups))}
            triggerText={selectedLabel(milestoneOptions, milestoneValue)}
            closeOnSelect
            className="h-7 w-48"
          />
        </div>
      )}
      {showGroups && (
        <div className="flex flex-col gap-1.5">
          <Label>Task Group</Label>
          <OptionCombobox
            label="Task Groups"
            options={groupOptions}
            selected={[groupValue]}
            onSelect={(id) =>
              onChange(placeInGroup(value, id === NONE ? null : Number(id), groups))
            }
            triggerText={selectedLabel(groupOptions, groupValue)}
            closeOnSelect
            className="h-7 w-56"
          />
        </div>
      )}
    </>
  );
}
