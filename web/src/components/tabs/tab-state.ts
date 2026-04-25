export interface Tab {
  id: string;
  virtualPath: string;
  title: string;
  lastActiveAt: number;
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

export function deriveTitleSegments(virtualPath: string): string[] {
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

export function deriveDefaultTitle(virtualPath: string): string {
  return deriveTitleSegments(virtualPath).join(' › ');
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

