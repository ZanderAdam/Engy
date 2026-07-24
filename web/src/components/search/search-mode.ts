export type SearchMode = 'lex' | 'vector' | 'hybrid';

interface SearchModeMeta {
  mode: SearchMode;
  label: string;
  /** Short description shown alongside the toggle. */
  hint: string;
  /**
   * Live modes query as-you-type (debounced). Manual modes only query the
   * explicitly submitted text — hybrid runs local LLM inference that is far too
   * slow to fire on every keystroke.
   */
  live: boolean;
}

export const SEARCH_MODES: SearchModeMeta[] = [
  { mode: 'lex', label: 'Lex', hint: 'Fast keyword match', live: true },
  { mode: 'vector', label: 'Vector', hint: 'Related-meaning matches', live: true },
  { mode: 'hybrid', label: 'Hybrid', hint: 'Best relevance — Enter to run (slow)', live: false },
];

export function searchModeMeta(mode: SearchMode): SearchModeMeta {
  return SEARCH_MODES.find((m) => m.mode === mode) ?? SEARCH_MODES[0];
}

export function isLiveMode(mode: SearchMode): boolean {
  return searchModeMeta(mode).live;
}

/**
 * The query string to send for the active mode: the debounced input for live
 * modes, the explicitly submitted value for manual modes.
 */
export function activeQueryForMode(
  mode: SearchMode,
  debouncedQuery: string,
  submittedQuery: string,
): string {
  return isLiveMode(mode) ? debouncedQuery : submittedQuery;
}

/**
 * True when a manual mode has text typed but not yet submitted (or edited since
 * the last submit) — the palette should prompt for Enter rather than query.
 */
export function needsManualSubmit(
  mode: SearchMode,
  inputValue: string,
  submittedQuery: string,
): boolean {
  if (isLiveMode(mode)) return false;
  const trimmed = inputValue.trim();
  return trimmed.length > 0 && trimmed !== submittedQuery;
}
