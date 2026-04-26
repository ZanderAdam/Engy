export type DocScopeType = 'workspace' | 'project';

export interface DocScope {
  scopeType: DocScopeType;
  groupKey: string;
  workspaceSlug: string;
  projectSlug?: string;
  rootDir: string;
}

export interface DocTab {
  filePath: string;
}

export interface DocPanelParams {
  tab: DocTab;
}

export function workspaceDocGroupKey(workspaceSlug: string): string {
  return `docs:workspace:${workspaceSlug}`;
}

export function projectDocGroupKey(workspaceSlug: string, projectSlug: string): string {
  return `docs:project:${workspaceSlug}:${projectSlug}`;
}
