export interface RegisterMessage {
  type: 'REGISTER';
  payload: Record<string, never>;
}

export interface WorkspacesSyncMessage {
  type: 'WORKSPACES_SYNC';
  payload: {
    workspaces: Array<{
      slug: string;
      repos: string[];
      docsDir?: string | null;
    }>;
  };
}

export interface ValidatePathsRequestMessage {
  type: 'VALIDATE_PATHS_REQUEST';
  payload: {
    requestId: string;
    paths: string[];
  };
}

export interface ValidatePathsResponseMessage {
  type: 'VALIDATE_PATHS_RESPONSE';
  payload: {
    requestId: string;
    results: Array<{
      path: string;
      exists: boolean;
    }>;
  };
}

export interface SearchFilesRequestMessage {
  type: 'SEARCH_FILES_REQUEST';
  payload: {
    requestId: string;
    dirs: string[];
    query: string;
    limit: number;
  };
}

export interface SearchFilesResponseMessage {
  type: 'SEARCH_FILES_RESPONSE';
  payload: {
    requestId: string;
    results: Array<{
      label: string;
      path: string;
    }>;
  };
}

export interface FileChangeMessage {
  type: 'FILE_CHANGE';
  payload: {
    workspaceSlug: string;
    path: string;
    eventType: 'add' | 'change' | 'unlink';
  };
}

export type WsMessage =
  | RegisterMessage
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | ValidatePathsResponseMessage
  | SearchFilesRequestMessage
  | SearchFilesResponseMessage
  | FileChangeMessage;

export type ClientToServerMessage =
  | RegisterMessage
  | ValidatePathsResponseMessage
  | SearchFilesResponseMessage
  | FileChangeMessage;

export type ServerToClientMessage =
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | SearchFilesRequestMessage;

// ── Compact terminal relay types (server ↔ daemon) ──────────────────────────

// Server → Daemon commands
export interface TerminalSpawnCmd {
  t: 'spawn';
  sessionId: string;
  workingDir: string;
  command?: string;
  cols: number;
  rows: number;
  scopeType: string;
  scopeLabel: string;
}

export interface TerminalInputCmd {
  t: 'i';
  sessionId: string;
  d: string;
}

export interface TerminalResizeCmd {
  t: 'resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalKillCmd {
  t: 'kill';
  sessionId: string;
}

export interface TerminalReconnectCmd {
  t: 'reconnect';
  sessionId: string;
}

export type TerminalRelayCommand =
  | TerminalSpawnCmd
  | TerminalInputCmd
  | TerminalResizeCmd
  | TerminalKillCmd
  | TerminalReconnectCmd;

// Daemon → Server events
export interface TerminalOutputEvent {
  t: 'o';
  sessionId: string;
  d: string;
}

export interface TerminalExitEvent {
  t: 'exit';
  sessionId: string;
  exitCode: number;
}

export interface TerminalReconnectedEvent {
  t: 'reconnected';
  sessionId: string;
  buffer: string[];
}

export interface TerminalErrorEvent {
  t: 'error';
  sessionId?: string;
  message: string;
}

export type TerminalRelayEvent =
  | TerminalOutputEvent
  | TerminalExitEvent
  | TerminalReconnectedEvent
  | TerminalErrorEvent;
