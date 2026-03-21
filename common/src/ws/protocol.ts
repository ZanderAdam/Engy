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

// ── Git operations (server ↔ daemon) ────────────────────────────────────────

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitStatusRequestMessage {
  type: 'GIT_STATUS_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
  };
}

export interface GitStatusResponseMessage {
  type: 'GIT_STATUS_RESPONSE';
  payload: {
    requestId: string;
    files: Array<{ path: string; status: GitFileStatus; staged: boolean }>;
    branch: string;
  } | {
    requestId: string;
    error: string;
  };
}

export interface GitDiffRequestMessage {
  type: 'GIT_DIFF_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    filePath: string;
    base?: string;
    staged?: boolean;
  };
}

export interface GitDiffResponseMessage {
  type: 'GIT_DIFF_RESPONSE';
  payload: {
    requestId: string;
    diff: string;
  } | {
    requestId: string;
    error: string;
  };
}

export interface GitLogRequestMessage {
  type: 'GIT_LOG_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    maxCount?: number;
  };
}

export interface GitLogResponseMessage {
  type: 'GIT_LOG_RESPONSE';
  payload: {
    requestId: string;
    commits: Array<{ hash: string; message: string; author: string; date: string }>;
  } | {
    requestId: string;
    error: string;
  };
}

export interface GitShowRequestMessage {
  type: 'GIT_SHOW_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    commitHash: string;
  };
}

export interface GitShowResponseMessage {
  type: 'GIT_SHOW_RESPONSE';
  payload: {
    requestId: string;
    diff: string;
    files: Array<{ path: string; status: GitFileStatus }>;
  } | {
    requestId: string;
    error: string;
  };
}

export interface GitBranchFilesRequestMessage {
  type: 'GIT_BRANCH_FILES_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    base: string;
  };
}

export interface GitBranchFilesResponseMessage {
  type: 'GIT_BRANCH_FILES_RESPONSE';
  payload: {
    requestId: string;
    files: Array<{ path: string; status: GitFileStatus }>;
  } | {
    requestId: string;
    error: string;
  };
}

// ── Container operations (server ↔ daemon) ──────────────────────────────────

export interface ContainerUpRequestMessage {
  type: 'CONTAINER_UP_REQUEST';
  payload: {
    requestId: string;
    workspaceFolder: string;
    repos?: string[];
    config?: {
      allowedDomains?: string[];
      extraPackages?: string[];
      envVars?: Record<string, string>;
      idleTimeout?: number;
    };
  };
}

export interface ContainerUpResponseMessage {
  type: 'CONTAINER_UP_RESPONSE';
  payload:
    | { requestId: string; containerId: string }
    | { requestId: string; error: string };
}

export interface ContainerDownRequestMessage {
  type: 'CONTAINER_DOWN_REQUEST';
  payload: {
    requestId: string;
    workspaceFolder: string;
  };
}

export interface ContainerDownResponseMessage {
  type: 'CONTAINER_DOWN_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

export interface ContainerStatusRequestMessage {
  type: 'CONTAINER_STATUS_REQUEST';
  payload: {
    requestId: string;
    workspaceFolder: string;
  };
}

export interface ContainerStatusResponseMessage {
  type: 'CONTAINER_STATUS_RESPONSE';
  payload:
    | { requestId: string; running: boolean; containerId?: string }
    | { requestId: string; error: string };
}

export interface ContainerProgressEventMessage {
  type: 'CONTAINER_PROGRESS_EVENT';
  payload: {
    requestId: string;
    line: string;
  };
}

// ── Execution operations (server ↔ daemon) ──────────────────────────────────

export interface ExecutionStartConfig {
  repoPath: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  env?: Record<string, string>;
}

export interface ExecutionStartRequestMessage {
  type: 'EXECUTION_START_REQUEST';
  payload: {
    requestId: string;
    prompt: string;
    flags?: string[];
    config?: ExecutionStartConfig;
  };
}

export interface ExecutionStartResponseMessage {
  type: 'EXECUTION_START_RESPONSE';
  payload:
    | { requestId: string; sessionId: string }
    | { requestId: string; error: string };
}

export interface ExecutionStopRequestMessage {
  type: 'EXECUTION_STOP_REQUEST';
  payload: {
    requestId: string;
    sessionId: string;
  };
}

export interface ExecutionStopResponseMessage {
  type: 'EXECUTION_STOP_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

export interface ExecutionStatusEventMessage {
  type: 'EXECUTION_STATUS_EVENT';
  payload: {
    sessionId: string;
    status: string;
    taskId?: number;
    worktreePath?: string;
  };
}

export interface ExecutionCompleteEventMessage {
  type: 'EXECUTION_COMPLETE_EVENT';
  payload: {
    sessionId: string;
    exitCode: number;
    success: boolean;
    completionSummary?: string;
  };
}

export type WsMessage =
  | RegisterMessage
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | ValidatePathsResponseMessage
  | SearchFilesRequestMessage
  | SearchFilesResponseMessage
  | FileChangeMessage
  | GitStatusRequestMessage
  | GitStatusResponseMessage
  | GitDiffRequestMessage
  | GitDiffResponseMessage
  | GitLogRequestMessage
  | GitLogResponseMessage
  | GitShowRequestMessage
  | GitShowResponseMessage
  | GitBranchFilesRequestMessage
  | GitBranchFilesResponseMessage
  | ContainerUpRequestMessage
  | ContainerUpResponseMessage
  | ContainerDownRequestMessage
  | ContainerDownResponseMessage
  | ContainerStatusRequestMessage
  | ContainerStatusResponseMessage
  | ContainerProgressEventMessage
  | ExecutionStartRequestMessage
  | ExecutionStartResponseMessage
  | ExecutionStopRequestMessage
  | ExecutionStopResponseMessage
  | ExecutionStatusEventMessage
  | ExecutionCompleteEventMessage;

export type ClientToServerMessage =
  | RegisterMessage
  | ValidatePathsResponseMessage
  | SearchFilesResponseMessage
  | FileChangeMessage
  | GitStatusResponseMessage
  | GitDiffResponseMessage
  | GitLogResponseMessage
  | GitShowResponseMessage
  | GitBranchFilesResponseMessage
  | ContainerUpResponseMessage
  | ContainerDownResponseMessage
  | ContainerStatusResponseMessage
  | ContainerProgressEventMessage
  | ExecutionStartResponseMessage
  | ExecutionStopResponseMessage
  | ExecutionStatusEventMessage
  | ExecutionCompleteEventMessage;

export type ServerToClientMessage =
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | SearchFilesRequestMessage
  | GitStatusRequestMessage
  | GitDiffRequestMessage
  | GitLogRequestMessage
  | GitShowRequestMessage
  | GitBranchFilesRequestMessage
  | ContainerUpRequestMessage
  | ContainerDownRequestMessage
  | ContainerStatusRequestMessage
  | ExecutionStartRequestMessage
  | ExecutionStopRequestMessage;

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
  containerWorkspaceFolder?: string;
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

/** Sent by daemon on connect to announce which sessions it still has alive. */
export interface TerminalSyncEvent {
  t: 'sync';
  sessionIds: string[];
}

export type TerminalRelayEvent =
  | TerminalOutputEvent
  | TerminalExitEvent
  | TerminalReconnectedEvent
  | TerminalErrorEvent
  | TerminalSyncEvent;
