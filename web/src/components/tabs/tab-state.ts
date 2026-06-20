import { randomId } from '@/lib/random-id';

export interface Tab {
  id: string;
  virtualPath: string;
  title: string;
  lastActiveAt: number;
}

export interface TabsState {
  tabs: Tab[];
  activeTabId: string;
}

interface PersistedTabsV1 {
  tabs: Tab[];
  activeTabId: string | null;
}

const PERSIST_KEY = 'engy:tabs:v1';

export function normalizeVirtualPath(raw: string): string {
  if (!raw) return '/';
  try {
    const url = new URL(raw, 'http://_');
    const pathname = url.pathname || '/';
    const search = url.search || '';
    return `${pathname}${search}`;
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
}

export interface VirtualParams {
  workspace?: string;
  project?: string;
  section?: string;
}

export function parseVirtualPath(virtualPath: string): VirtualParams {
  const path = virtualPath.split('?')[0];
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return {};
  if (segments[0] !== 'w') {
    return { section: segments[0] };
  }

  const workspace = segments[1];
  if (!workspace) return {};

  if (segments[2] !== 'projects') {
    return { workspace, section: segments[2] };
  }

  const project = segments[3];
  const section = segments[4];
  return { workspace, project, section };
}

function basenameFromPath(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const trimmed = rawPath.replace(/\/+$/, '');
  const last = trimmed.split('/').filter(Boolean).pop();
  return last ?? null;
}

function deriveTitleSegments(virtualPath: string): string[] {
  const { workspace, project, section } = parseVirtualPath(virtualPath);
  if (!workspace) {
    if (section === 'open') {
      const idx = virtualPath.indexOf('?');
      const search = idx >= 0 ? virtualPath.slice(idx + 1) : '';
      const dirName = basenameFromPath(new URLSearchParams(search).get('path'));
      return dirName ? ['open', dirName] : ['open'];
    }
    return [section ?? 'engy'];
  }
  const parts: string[] = [workspace];
  if (project) parts.push(project);
  if (section) parts.push(section);
  return parts;
}

interface TabTitle {
  segments: string[];
  worktree?: string;
}

export function deriveTabTitle(virtualPath: string): TabTitle {
  const segments = deriveTitleSegments(virtualPath);
  const wt = searchParam(virtualPath, 'wt');
  if (wt) return { segments, worktree: wt };
  // Project routes that haven't picked a worktree are on the default branch —
  // show that explicitly so the second-row chip doesn't render as a blank gap.
  const { workspace, project } = parseVirtualPath(virtualPath);
  if (workspace && project) return { segments, worktree: 'default' };
  return { segments };
}

export function deriveDefaultTitle(virtualPath: string): string {
  const { segments, worktree } = deriveTabTitle(virtualPath);
  const base = segments.join(' › ');
  return worktree ? `${base} (${worktree})` : base;
}

function searchParam(virtualPath: string, name: string): string | null {
  const idx = virtualPath.indexOf('?');
  if (idx < 0) return null;
  return new URLSearchParams(virtualPath.slice(idx + 1)).get(name);
}

/**
 * Stable identity for a "project tab": a workspace + project + worktree combo,
 * independent of which section (code/docs/tasks/diffs) is showing. Returns null
 * for non-project paths (home, open-directory) so those never get deduplicated.
 */
export function projectTabKey(virtualPath: string): string | null {
  const { workspace, project } = parseVirtualPath(virtualPath);
  if (!workspace || !project) return null;
  const worktree = searchParam(virtualPath, 'wt') ?? '';
  return `${workspace}/${project}@${worktree}`;
}

/**
 * Find an open tab already showing the same project + worktree as `virtualPath`,
 * so callers can focus it instead of opening a duplicate. Returns undefined for
 * non-project paths or when no match exists.
 */
export function findReusableProjectTab(tabs: Tab[], virtualPath: string): Tab | undefined {
  const key = projectTabKey(virtualPath);
  if (!key) return undefined;
  return tabs.find((t) => projectTabKey(t.virtualPath) === key);
}

/**
 * Collapse tabs that point at the same project + worktree, keeping the most
 * recently active one and preserving order. Non-project tabs are never merged.
 * Used on load to clean up duplicates persisted before dedup existed.
 */
export function dedupeProjectTabs(tabs: Tab[]): Tab[] {
  const keptByKey = new Map<string, Tab>();
  const result: Tab[] = [];
  for (const tab of tabs) {
    const key = projectTabKey(tab.virtualPath);
    if (!key) {
      result.push(tab);
      continue;
    }
    const existing = keptByKey.get(key);
    if (!existing) {
      keptByKey.set(key, tab);
      result.push(tab);
      continue;
    }
    if (tab.lastActiveAt > existing.lastActiveAt) {
      result[result.indexOf(existing)] = tab;
      keptByKey.set(key, tab);
    }
  }
  return result;
}

export function makeTab(virtualPath: string): Tab {
  const path = normalizeVirtualPath(virtualPath);
  return {
    id: randomId(),
    virtualPath: path,
    title: deriveDefaultTitle(path),
    lastActiveAt: Date.now(),
  };
}

export function navigateTab(tabs: Tab[], tabId: string, path: string): Tab[] {
  return tabs.map((t) =>
    t.id === tabId
      ? { ...t, virtualPath: path, title: deriveDefaultTitle(path), lastActiveAt: Date.now() }
      : t,
  );
}

/**
 * Resolve the tab set to start from on load. Collapses project-tab duplicates
 * persisted before dedup existed, then reuses an existing project tab matching
 * the bootstrap URL (navigating it to the requested section) rather than opening
 * a duplicate. Falls back to prepending a fresh active tab.
 */
export function computeInitialTabs(urlPath: string, persistedTabs: Tab[]): TabsState {
  const savedTabs = dedupeProjectTabs(persistedTabs);
  if (savedTabs.length > 0) {
    const exact = savedTabs.find((t) => t.virtualPath === urlPath);
    if (exact) return { tabs: savedTabs, activeTabId: exact.id };
    const reusable = findReusableProjectTab(savedTabs, urlPath);
    if (reusable) {
      return { tabs: navigateTab(savedTabs, reusable.id, urlPath), activeTabId: reusable.id };
    }
    const newActive = makeTab(urlPath);
    return { tabs: [newActive, ...savedTabs], activeTabId: newActive.id };
  }
  const initial = makeTab(urlPath);
  return { tabs: [initial], activeTabId: initial.id };
}

export function loadPersisted(): PersistedTabsV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTabsV1;
    if (!Array.isArray(parsed.tabs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

let lastPersistedJson: string | null = null;

export function savePersisted(state: PersistedTabsV1): void {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify(state);
    if (json === lastPersistedJson) return;
    window.localStorage.setItem(PERSIST_KEY, json);
    lastPersistedJson = json;
  } catch {
    // localStorage may be full or unavailable
  }
}

