export interface RegisterMessage {
  type: 'REGISTER';
  payload: { homeDir?: string };
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

export interface CreateDirRequestMessage {
  type: 'CREATE_DIR_REQUEST';
  payload: {
    requestId: string;
    paths: string[];
  };
}

export interface CreateDirResponseMessage {
  type: 'CREATE_DIR_RESPONSE';
  payload:
    | {
        requestId: string;
        results: Array<{ path: string; success: boolean; error?: string }>;
      }
    | {
        requestId: string;
        error: string;
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
    coderWorkspace?: string;
  };
}

export interface GitStatusResponseMessage {
  type: 'GIT_STATUS_RESPONSE';
  payload:
    | {
        requestId: string;
        files: Array<{ path: string; status: GitFileStatus; staged: boolean }>;
        branch: string;
      }
    | {
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
    coderWorkspace?: string;
  };
}

export interface GitDiffResponseMessage {
  type: 'GIT_DIFF_RESPONSE';
  payload:
    | {
        requestId: string;
        diff: string;
      }
    | {
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
    coderWorkspace?: string;
  };
}

export interface GitLogResponseMessage {
  type: 'GIT_LOG_RESPONSE';
  payload:
    | {
        requestId: string;
        commits: Array<{ hash: string; message: string; author: string; date: string }>;
      }
    | {
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
    coderWorkspace?: string;
  };
}

export interface GitShowResponseMessage {
  type: 'GIT_SHOW_RESPONSE';
  payload:
    | {
        requestId: string;
        files: Array<{ path: string; status: GitFileStatus; oldPath?: string }>;
      }
    | {
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
    coderWorkspace?: string;
  };
}

export interface GitBranchFilesResponseMessage {
  type: 'GIT_BRANCH_FILES_RESPONSE';
  payload:
    | {
        requestId: string;
        files: Array<{ path: string; status: GitFileStatus; oldPath?: string }>;
      }
    | {
        requestId: string;
        error: string;
      };
}

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  isLocked: boolean;
}

export interface GitWorktreeListRequestMessage {
  type: 'GIT_WORKTREE_LIST_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    coderWorkspace?: string;
  };
}

export interface GitWorktreeListResponseMessage {
  type: 'GIT_WORKTREE_LIST_RESPONSE';
  payload:
    | { requestId: string; worktrees: GitWorktreeEntry[] }
    | { requestId: string; error: string };
}

// ── File operations (server ↔ daemon) ────────────────────────────────────────

export interface DirListEntry {
  name: string;
  mtime: number;
}

export interface DirListRequestMessage {
  type: 'DIR_LIST_REQUEST';
  payload: {
    requestId: string;
    dirPath: string;
  };
}

export interface DirListResponseMessage {
  type: 'DIR_LIST_RESPONSE';
  payload:
    | { requestId: string; dirs: string[]; files: DirListEntry[] }
    | { requestId: string; error: string };
}

export interface FsDeleteRequestMessage {
  type: 'FS_DELETE_REQUEST';
  payload: {
    requestId: string;
    rootDir: string;
    relPath: string;
  };
}

export interface FsDeleteResponseMessage {
  type: 'FS_DELETE_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

export interface FsRenameRequestMessage {
  type: 'FS_RENAME_REQUEST';
  payload: {
    requestId: string;
    rootDir: string;
    oldRelPath: string;
    newRelPath: string;
  };
}

export interface FsRenameResponseMessage {
  type: 'FS_RENAME_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

export interface FileReadRequestMessage {
  type: 'FILE_READ_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    filePath: string;
    ref?: string;
    coderWorkspace?: string;
  };
}

export interface FileReadResponseMessage {
  type: 'FILE_READ_RESPONSE';
  payload:
    | { requestId: string; content: string }
    | { requestId: string; error: string };
}

export interface FileReadImageRequestMessage {
  type: 'FILE_READ_IMAGE_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    filePath: string;
    ref?: string;
    coderWorkspace?: string;
  };
}

export interface FileReadImageResponseMessage {
  type: 'FILE_READ_IMAGE_RESPONSE';
  payload:
    | { requestId: string; base64: string }
    | { requestId: string; error: string };
}

export interface GlobFilesRequestMessage {
  type: 'GLOB_FILES_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    patterns: string[];
  };
}

export interface GlobFilesResponseMessage {
  type: 'GLOB_FILES_RESPONSE';
  payload:
    | { requestId: string; files: string[] }
    | { requestId: string; error: string };
}

export interface FileWriteRequestMessage {
  type: 'FILE_WRITE_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    filePath: string;
    content: string;
    coderWorkspace?: string;
  };
}

export interface FileWriteResponseMessage {
  type: 'FILE_WRITE_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

// ── Remote file operations (server ↔ daemon) ──────────────────────────────────

export interface RemoteFilePullRequestMessage {
  type: 'REMOTE_FILE_PULL_REQUEST';
  payload: {
    requestId: string;
    coderWorkspace: string;
    filePath: string;
  };
}

export interface RemoteFilePullResponseMessage {
  type: 'REMOTE_FILE_PULL_RESPONSE';
  payload:
    | { requestId: string; content: string }
    | { requestId: string; error: string };
}

export interface RemoteFilePushRequestMessage {
  type: 'REMOTE_FILE_PUSH_REQUEST';
  payload: {
    requestId: string;
    coderWorkspace: string;
    filePath: string;
    content: string;
  };
}

export interface RemoteFilePushResponseMessage {
  type: 'REMOTE_FILE_PUSH_RESPONSE';
  payload:
    | { requestId: string; success: boolean }
    | { requestId: string; error: string };
}

// ── Worktree merge operations (server ↔ daemon) ──────────────────────────────

export interface WorktreeMergeRequestMessage {
  type: 'WORKTREE_MERGE_REQUEST';
  payload: {
    requestId: string;
    worktreePath: string;
    repoDir: string;
    // When set, run git commands on the Coder workspace via `coder ssh`.
    // The worktreePath and repoDir are then interpreted as remote paths.
    coderWorkspace?: string;
  };
}

export interface WorktreeMergeResultMessage {
  type: 'WORKTREE_MERGE_RESULT';
  payload:
    | { requestId: string; success: boolean; branch: string }
    | { requestId: string; error: string };
}

export type WorktreeAddErrorCode = 'BRANCH_EXISTS' | 'PATH_EXISTS' | 'OTHER';

export interface WorktreeAddRequestMessage {
  type: 'WORKTREE_ADD_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    worktreePath: string;
    branch: string;
    createBranch: boolean;
    baseRef?: string;
    coderWorkspace?: string;
  };
}

export interface WorktreeAddResultMessage {
  type: 'WORKTREE_ADD_RESULT';
  payload:
    | { requestId: string; success: true; worktreePath: string; branch: string }
    | { requestId: string; error: string; code: WorktreeAddErrorCode };
}

export type WorktreeRemoveErrorCode = 'DIRTY' | 'OTHER';

export interface WorktreeRemoveRequestMessage {
  type: 'WORKTREE_REMOVE_REQUEST';
  payload: {
    requestId: string;
    repoDir: string;
    worktreePath: string;
    force: boolean;
    coderWorkspace?: string;
  };
}

export interface WorktreeRemoveResultMessage {
  type: 'WORKTREE_REMOVE_RESULT';
  payload:
    | { requestId: string; success: true }
    | { requestId: string; error: string; code: WorktreeRemoveErrorCode };
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
    executionBackend?: ExecutionBackend;
    coderWorkspace?: string;
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

export interface DevcontainerConfigGenerateRequestMessage {
  type: 'DEVCONTAINER_CONFIG_GENERATE_REQUEST';
  payload: {
    requestId: string;
    workspaceFolder: string;
    repos?: string[];
    config?: ContainerUpRequestMessage['payload']['config'];
  };
}

export interface DevcontainerConfigGenerateResponseMessage {
  type: 'DEVCONTAINER_CONFIG_GENERATE_RESPONSE';
  payload: { requestId: string; success: true } | { requestId: string; error: string };
}

// ── Execution operations (server ↔ daemon) ──────────────────────────────────

export type ExecutionBackend = 'devcontainer' | 'coder';

export interface ExecutionStartConfig {
  repoPath: string;
  containerMode: boolean;
  containerWorkspaceFolder?: string;
  executionBackend?: ExecutionBackend;
  coderWorkspace?: string;
  coderRepoBasePath?: string;
  remote?: boolean;
  env?: Record<string, string>;
  // Reuse an existing worktree (set when resuming a prior session via --resume)
  // so the agent runs from the same cwd as the original session and can find
  // its conversation JSONL on disk.
  existingWorktreePath?: string;
}

export interface ExecutionStartRequestMessage {
  type: 'EXECUTION_START_REQUEST';
  payload: {
    requestId: string;
    sessionId: string;
    prompt: string;
    flags?: string[];
    config?: ExecutionStartConfig;
  };
}

export interface ExecutionStartResponseMessage {
  type: 'EXECUTION_START_RESPONSE';
  payload: { requestId: string; sessionId: string } | { requestId: string; error: string };
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
  payload: { requestId: string; success: boolean } | { requestId: string; error: string };
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

export type FleetingMemoryType = 'capture' | 'question' | 'blocker' | 'idea' | 'reference';

export interface CreateMemoriesEventMessage {
  type: 'CREATE_MEMORIES_EVENT';
  payload: {
    sessionId: string;
    memories: Array<{ content: string; type?: FleetingMemoryType }>;
  };
}

export type WsMessage =
  | RegisterMessage
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | ValidatePathsResponseMessage
  | CreateDirRequestMessage
  | CreateDirResponseMessage
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
  | GitWorktreeListRequestMessage
  | GitWorktreeListResponseMessage
  | DirListRequestMessage
  | DirListResponseMessage
  | FileReadRequestMessage
  | FileReadResponseMessage
  | FileReadImageRequestMessage
  | FileReadImageResponseMessage
  | GlobFilesRequestMessage
  | GlobFilesResponseMessage
  | FileWriteRequestMessage
  | FileWriteResponseMessage
  | FsDeleteRequestMessage
  | FsDeleteResponseMessage
  | FsRenameRequestMessage
  | FsRenameResponseMessage
  | RemoteFilePullRequestMessage
  | RemoteFilePullResponseMessage
  | RemoteFilePushRequestMessage
  | RemoteFilePushResponseMessage
  | WorktreeMergeRequestMessage
  | WorktreeMergeResultMessage
  | WorktreeAddRequestMessage
  | WorktreeAddResultMessage
  | WorktreeRemoveRequestMessage
  | WorktreeRemoveResultMessage
  | ContainerUpRequestMessage
  | ContainerUpResponseMessage
  | ContainerDownRequestMessage
  | ContainerDownResponseMessage
  | ContainerStatusRequestMessage
  | ContainerStatusResponseMessage
  | ContainerProgressEventMessage
  | DevcontainerConfigGenerateRequestMessage
  | DevcontainerConfigGenerateResponseMessage
  | ExecutionStartRequestMessage
  | ExecutionStartResponseMessage
  | ExecutionStopRequestMessage
  | ExecutionStopResponseMessage
  | ExecutionStatusEventMessage
  | ExecutionCompleteEventMessage
  | CreateMemoriesEventMessage;

export type ClientToServerMessage =
  | RegisterMessage
  | ValidatePathsResponseMessage
  | CreateDirResponseMessage
  | SearchFilesResponseMessage
  | FileChangeMessage
  | GitStatusResponseMessage
  | GitDiffResponseMessage
  | GitLogResponseMessage
  | GitShowResponseMessage
  | GitBranchFilesResponseMessage
  | GitWorktreeListResponseMessage
  | DirListResponseMessage
  | FileReadResponseMessage
  | FileReadImageResponseMessage
  | GlobFilesResponseMessage
  | FileWriteResponseMessage
  | FsDeleteResponseMessage
  | FsRenameResponseMessage
  | RemoteFilePullResponseMessage
  | RemoteFilePushResponseMessage
  | WorktreeMergeResultMessage
  | WorktreeAddResultMessage
  | WorktreeRemoveResultMessage
  | ContainerUpResponseMessage
  | ContainerDownResponseMessage
  | ContainerStatusResponseMessage
  | ContainerProgressEventMessage
  | DevcontainerConfigGenerateResponseMessage
  | ExecutionStartResponseMessage
  | ExecutionStopResponseMessage
  | ExecutionStatusEventMessage
  | ExecutionCompleteEventMessage
  | CreateMemoriesEventMessage;

export type ServerToClientMessage =
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | CreateDirRequestMessage
  | SearchFilesRequestMessage
  | GitStatusRequestMessage
  | GitDiffRequestMessage
  | GitLogRequestMessage
  | GitShowRequestMessage
  | GitBranchFilesRequestMessage
  | GitWorktreeListRequestMessage
  | DirListRequestMessage
  | FileReadRequestMessage
  | FileReadImageRequestMessage
  | GlobFilesRequestMessage
  | FileWriteRequestMessage
  | FsDeleteRequestMessage
  | FsRenameRequestMessage
  | RemoteFilePullRequestMessage
  | RemoteFilePushRequestMessage
  | WorktreeMergeRequestMessage
  | WorktreeAddRequestMessage
  | WorktreeRemoveRequestMessage
  | ContainerUpRequestMessage
  | ContainerDownRequestMessage
  | ContainerStatusRequestMessage
  | DevcontainerConfigGenerateRequestMessage
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
  coderWorkspace?: string;
  serverPort?: number;
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

/**
 * Terminal activity state, computed daemon-side from PTY output/input so it is
 * available even when no browser has the terminal mounted. `active` = producing
 * output (busy), `waiting` = blocked on user input (bell/prompt), `done` =
 * finished but unacknowledged, `idle` = nothing pending.
 */
export type TerminalActivityState = 'idle' | 'active' | 'waiting' | 'done';

/** Daemon → server: a session's activity state changed (emitted on transitions). */
export interface TerminalActivityEvent {
  t: 'act';
  sessionId: string;
  state: TerminalActivityState;
}

export type TerminalRelayEvent =
  | TerminalOutputEvent
  | TerminalExitEvent
  | TerminalReconnectedEvent
  | TerminalErrorEvent
  | TerminalSyncEvent
  | TerminalActivityEvent;
