export interface FilterOption {
  value: string;
  label: string;
}

interface FilterableTask {
  status: string;
  taskGroupId: number | null;
  milestoneRef: string | null;
}

function openKeys<K>(tasks: FilterableTask[], keyOf: (task: FilterableTask) => K): Set<K> {
  return new Set(tasks.filter((task) => task.status !== 'done').map(keyOf));
}

export function milestoneFilterOptions<M extends { ref: string }>(
  milestones: M[],
  tasks: FilterableTask[],
  selected: string[],
): M[] {
  const open = openKeys(tasks, (task) => task.milestoneRef);
  return milestones.filter((m) => open.has(m.ref) || selected.includes(m.ref));
}

export function groupFilterOptions<G extends { id: number }>(
  groups: G[],
  tasks: FilterableTask[],
  selected: number[],
): G[] {
  const open = openKeys(tasks, (task) => task.taskGroupId);
  return groups.filter((g) => open.has(g.id) || selected.includes(g.id));
}

// A milestone plan file can be deleted while tasks keep its ref, leaving a
// selection with no matching option and no way to toggle it off.
export function withOrphanOptions(options: FilterOption[], selected: string[]): FilterOption[] {
  const known = new Set(options.map((o) => o.value));
  const orphans = selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }));
  return [...options, ...orphans];
}
