import type { AppState } from '../trpc/context';

const DEBOUNCE_MS = 300;

export function handleSpecFileChange(workspaceSlug: string, state: AppState): void {
  const existing = state.specDebounceTimers.get(workspaceSlug);
  if (existing) clearTimeout(existing);

  state.specDebounceTimers.set(
    workspaceSlug,
    setTimeout(() => {
      state.specLastChanged.set(workspaceSlug, Date.now());
      state.specDebounceTimers.delete(workspaceSlug);
    }, DEBOUNCE_MS),
  );
}

export function getSpecLastChanged(workspaceSlug: string, state: AppState): number | null {
  return state.specLastChanged.get(workspaceSlug) ?? null;
}

export function clearDebounceTimers(state: AppState): void {
  for (const timer of state.specDebounceTimers.values()) {
    clearTimeout(timer);
  }
  state.specDebounceTimers.clear();
}
