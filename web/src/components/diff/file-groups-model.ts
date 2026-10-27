export interface FileGroupPaths {
  id: string;
  paths: string[];
}

export function revealGroupOf(
  collapsed: ReadonlySet<string>,
  selectedId: string | null,
  idPrefix: string,
  groups: FileGroupPaths[],
): ReadonlySet<string> {
  if (selectedId === null || !selectedId.startsWith(idPrefix)) return collapsed;
  const path = selectedId.slice(idPrefix.length);
  const group = groups.find((g) => g.paths.includes(path));
  if (!group || !collapsed.has(group.id)) return collapsed;
  const next = new Set(collapsed);
  next.delete(group.id);
  return next;
}
