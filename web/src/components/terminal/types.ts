export type TerminalScopeType = 'spec' | 'project' | 'workspace' | 'docs' | 'dir';

export type TerminalStatus = 'connecting' | 'active' | 'exited' | 'error';

export interface TerminalScope {
  scopeType: TerminalScopeType;
  scopeLabel: string;
  workingDir: string;
  command?: string;
}

export interface TerminalTab {
  sessionId: string;
  scope: TerminalScope;
  status: TerminalStatus;
}

export interface TerminalPanelParams {
  tab: TerminalTab;
}

export interface SplitPosition {
  referencePanel: string;
  direction: 'right' | 'below';
}
