/**
 * Pure state model for the code editor's open-file tabs and its IDE-style
 * back/forward navigation history. Kept free of React/Monaco so the transitions
 * are exhaustively unit-testable.
 *
 * `history` is the ordered list of files the user navigated to; `historyIndex`
 * is the cursor into it. Opening/activating a file truncates any forward
 * history and appends, exactly like a browser's location stack.
 */
export interface TabsState {
  tabs: string[];
  active: string | null;
  history: string[];
  historyIndex: number;
}

export const emptyTabsState: TabsState = {
  tabs: [],
  active: null,
  history: [],
  historyIndex: -1,
};

function pushHistory(state: TabsState, path: string): Pick<TabsState, 'history' | 'historyIndex'> {
  const base = state.history.slice(0, state.historyIndex + 1);
  if (base[base.length - 1] === path) {
    return { history: base, historyIndex: base.length - 1 };
  }
  const history = [...base, path];
  return { history, historyIndex: history.length - 1 };
}

/**
 * Opens `path` (adding a tab if needed) and makes it active, recording the
 * navigation. Selecting an already-open tab funnels through here too.
 */
export function openTab(state: TabsState, path: string): TabsState {
  const tabs = state.tabs.includes(path) ? state.tabs : [...state.tabs, path];
  return { tabs, active: path, ...pushHistory(state, path) };
}

/**
 * Closes `path`. When the active tab is closed, focus moves to its right
 * neighbour, falling back to the left. History entries for the closed file are
 * pruned so back/forward never lands on a vanished tab.
 */
export function closeTab(state: TabsState, path: string): TabsState {
  const idx = state.tabs.indexOf(path);
  if (idx === -1) return state;

  const tabs = state.tabs.filter((t) => t !== path);
  const history = state.history.filter((h) => h !== path);

  let active = state.active;
  if (state.active === path) {
    active = tabs[idx] ?? tabs[idx - 1] ?? null;
  }

  let historyIndex = active ? history.lastIndexOf(active) : -1;
  if (historyIndex === -1) historyIndex = history.length - 1;

  return { tabs, active, history, historyIndex };
}

function seekOpen(state: TabsState, from: number, step: number): number {
  for (let i = from; i >= 0 && i < state.history.length; i += step) {
    if (state.tabs.includes(state.history[i])) return i;
  }
  return -1;
}

export function canGoBack(state: TabsState): boolean {
  return seekOpen(state, state.historyIndex - 1, -1) !== -1;
}

export function canGoForward(state: TabsState): boolean {
  return seekOpen(state, state.historyIndex + 1, 1) !== -1;
}

export function navigateBack(state: TabsState): TabsState {
  const i = seekOpen(state, state.historyIndex - 1, -1);
  if (i === -1) return state;
  return { ...state, active: state.history[i], historyIndex: i };
}

export function navigateForward(state: TabsState): TabsState {
  const i = seekOpen(state, state.historyIndex + 1, 1);
  if (i === -1) return state;
  return { ...state, active: state.history[i], historyIndex: i };
}
