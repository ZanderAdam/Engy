export interface TaskPlacement {
  milestoneRef: string | null;
  taskGroupId: number | null;
}

interface PlacementGroup {
  id: number;
  milestoneRef: string | null;
}

export function groupChoices<G extends PlacementGroup>(groups: G[], placement: TaskPlacement): G[] {
  if (placement.milestoneRef === null) return groups;
  return groups.filter(
    (g) => g.milestoneRef === placement.milestoneRef || g.id === placement.taskGroupId,
  );
}

export function placeInMilestone(
  placement: TaskPlacement,
  milestoneRef: string | null,
  groups: PlacementGroup[],
): TaskPlacement {
  const group = groups.find((g) => g.id === placement.taskGroupId);
  const keepsGroup = group !== undefined && group.milestoneRef === milestoneRef;
  return { milestoneRef, taskGroupId: keepsGroup ? group.id : null };
}

export function placeInGroup(
  placement: TaskPlacement,
  taskGroupId: number | null,
  groups: PlacementGroup[],
): TaskPlacement {
  const group = groups.find((g) => g.id === taskGroupId);
  if (!group) return { ...placement, taskGroupId: null };
  return { milestoneRef: group.milestoneRef, taskGroupId: group.id };
}
