/**
 * Whether a broadcast event belongs to the workspace this browser is showing.
 *
 * Broadcasts reach every open `/ws/events` socket regardless of what each one
 * is looking at, so any event carrying a `workspaceSlug` has to be filtered
 * here. Keyed on the field rather than on a list of event types: a new
 * workspace-scoped event is then scoped by construction, instead of leaking
 * into other workspaces until someone remembers to add it — which is how an
 * agent's spoken answer came to play in every open tab.
 */
export function isEventForWorkspace(payload: unknown, workspaceSlug: string): boolean {
  if (typeof payload !== 'object' || payload === null) return true;
  const slug = (payload as { workspaceSlug?: unknown }).workspaceSlug;
  if (typeof slug !== 'string') return true;
  return slug === workspaceSlug;
}
