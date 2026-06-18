export interface CodePageState {
  repo: string | null;
  tabs: string[];
  active: string | null;
  wordWrap: boolean;
  minimap: boolean;
}

export const defaultCodePageState: CodePageState = {
  repo: null,
  tabs: [],
  active: null,
  wordWrap: false,
  minimap: true,
};

export function codeStateKey(workspaceSlug: string, projectSlug: string | undefined): string {
  return `code-page:${workspaceSlug}:${projectSlug ?? ''}`;
}

/**
 * Parses a persisted code-page state, tolerating older/partial shapes. Pure so
 * the migration/validation rules are unit-testable without localStorage. The
 * active tab is forced to be one of the open tabs (or null) to keep callers from
 * having to re-validate.
 */
export function parseCodeState(raw: string | null): CodePageState {
  if (!raw) return { ...defaultCodePageState };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...defaultCodePageState };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...defaultCodePageState };

  const obj = parsed as Record<string, unknown>;
  const repo = typeof obj.repo === 'string' ? obj.repo : null;
  const rawTabs = Array.isArray(obj.tabs)
    ? obj.tabs.filter((t): t is string => typeof t === 'string')
    : [];
  // Dedupe — corrupted/hand-edited storage could repeat a path, and openTab only
  // guards against duplicates for new opens, not initial hydration.
  const tabs = [...new Set(rawTabs)];
  // Back-compat: older state persisted a single `file` instead of tabs.
  if (tabs.length === 0 && typeof obj.file === 'string') tabs.push(obj.file);

  const candidateActive =
    typeof obj.active === 'string'
      ? obj.active
      : typeof obj.file === 'string'
        ? obj.file
        : null;
  const active = candidateActive && tabs.includes(candidateActive) ? candidateActive : tabs[0] ?? null;

  return {
    repo,
    tabs,
    active,
    wordWrap: typeof obj.wordWrap === 'boolean' ? obj.wordWrap : defaultCodePageState.wordWrap,
    minimap: typeof obj.minimap === 'boolean' ? obj.minimap : defaultCodePageState.minimap,
  };
}

export function serializeCodeState(state: CodePageState): string {
  return JSON.stringify(state);
}
