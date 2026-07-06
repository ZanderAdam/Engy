import type WebSocket from 'ws';
import type {
  DirListEntry,
  GitFileStatus,
  GitWorktreeEntry,
  GhPr,
  GhReviewComment,
  TerminalActivityState,
  WorktreeAddErrorCode,
  WorktreeRemoveErrorCode,
} from '@engy/common';

export interface CreateDirResult {
  results: Array<{ path: string; success: boolean; error?: string }>;
}

export interface FileChangeEvent {
  workspaceSlug: string;
  path: string;
  eventType: 'add' | 'change' | 'unlink';
  timestamp: number;
}

export interface TerminalSessionMeta {
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  // Which agent CLI this terminal runs ('claude' | 'codex'; undefined = plain
  // shell or unknown). Drives the worker picker and dispatch paste behavior.
  agentType?: string;
  groupKey?: string;
  workspaceSlug?: string;
  containerMode?: string;
  taskId?: number;
  projectId?: number;
  projectSlug?: string;
  // Which worktree branch this terminal runs against (undefined = default
  // branch). Drives grouping-by-worktree in the rail and dropdowns; persisted so
  // grouping survives reloads. Independent of groupKey (combined mode keeps a
  // single project-level groupKey across all worktrees).
  worktreeBranch?: string;
  // Terminal session id of the agent that created this session via the
  // terminal_spawn MCP tool (undefined = user-opened). Counted against the
  // agent-spawn cap so agents cannot fork terminals without bound.
  spawnedBy?: string;
  // Activity state computed daemon-side (per-project badges); updated by the
  // relay 'act' handler, available even when no browser has the terminal mounted.
  activityState?: TerminalActivityState;
  cols: number;
  rows: number;
}

export interface GitStatusResult {
  files: Array<{ path: string; status: GitFileStatus; staged: boolean }>;
  branch: string;
}

export interface GitLogResult {
  commits: Array<{ hash: string; message: string; author: string; date: string }>;
}

export interface GitShowResult {
  files: Array<{ path: string; status: GitFileStatus; oldPath?: string }>;
}

export interface GitBranchFilesResult {
  files: Array<{ path: string; status: GitFileStatus; oldPath?: string }>;
}

export interface ContainerUpResult {
  containerId: string;
}

export interface ContainerDownResult {
  success: boolean;
}

export interface ContainerStatusResult {
  running: boolean;
  containerId?: string;
}

export interface ExecutionStartResult {
  sessionId: string;
}

export interface ExecutionStopResult {
  success: boolean;
}

export interface DirListResult {
  dirs: string[];
  files: DirListEntry[];
}

export interface FsDeleteResult {
  success: boolean;
}

export interface FsRenameResult {
  success: boolean;
}

export interface FileReadResult {
  content: string;
}

export interface FileReadImageResult {
  base64: string;
}

export interface GlobFilesResult {
  files: string[];
}

export interface FileWriteResult {
  success: boolean;
}

export interface RemoteFilePullResult {
  content: string;
}

export interface RemoteFilePushResult {
  success: boolean;
}

export interface WorktreeMergeResult {
  success: boolean;
  branch: string;
}

export interface WorktreeAddResult {
  worktreePath: string;
  branch: string;
}

export interface WorktreeAddError extends Error {
  code: WorktreeAddErrorCode;
}

export interface WorktreeRemoveError extends Error {
  code: WorktreeRemoveErrorCode;
}

export interface GitWorktreeListResult {
  worktrees: GitWorktreeEntry[];
}

export interface GhPrListResult {
  prs: GhPr[];
}

export interface GhPrFailedLogsResult {
  logs: Array<{ checkName: string; excerpt: string }>;
}

export interface GhPrReviewCommentsResult {
  comments: GhReviewComment[];
}

export interface DispatchEntry {
  correlationId: string;
  workerSessionId: string;
  message: string;
  status: 'queued' | 'delivered' | 'replied' | 'failed';
  result?: string;
  error?: string;
  createdAt: number;
  deliveredAt?: number;
  repliedAt?: number;
  /** Terminal session of the agent that dispatched (from its /mcp/<token> identity). */
  originSessionId?: string;
  /** Push the settled result into the origin terminal instead of requiring terminal_collect polling. */
  notifyOnReply?: boolean;
}

interface DispatchWorker {
  description: string;
  connectedAt: number;
}

export interface AppState {
  daemon: WebSocket | null;
  fileChanges: Map<string, FileChangeEvent[]>;
  pendingValidations: Map<
    string,
    {
      resolve: (results: Array<{ path: string; exists: boolean }>) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFileSearches: Map<
    string,
    {
      resolve: (results: Array<{ label: string; path: string }>) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGitStatus: Map<
    string,
    {
      resolve: (result: GitStatusResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGitLog: Map<
    string,
    {
      resolve: (result: GitLogResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGitShow: Map<
    string,
    {
      resolve: (result: GitShowResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGitBranchFiles: Map<
    string,
    {
      resolve: (result: GitBranchFilesResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingContainerUp: Map<
    string,
    {
      resolve: (result: ContainerUpResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingContainerDown: Map<
    string,
    {
      resolve: (result: ContainerDownResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingContainerStatus: Map<
    string,
    {
      resolve: (result: ContainerStatusResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingDevcontainerGenerate: Map<
    string,
    {
      resolve: () => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingExecutionStart: Map<
    string,
    {
      resolve: (result: ExecutionStartResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingExecutionStop: Map<
    string,
    {
      resolve: (result: ExecutionStopResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingDirList: Map<
    string,
    {
      resolve: (result: DirListResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFileRead: Map<
    string,
    {
      resolve: (result: FileReadResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFileReadImage: Map<
    string,
    {
      resolve: (result: FileReadImageResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGlobFiles: Map<
    string,
    {
      resolve: (result: GlobFilesResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFileWrite: Map<
    string,
    {
      resolve: (result: FileWriteResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingRemoteFilePull: Map<
    string,
    {
      resolve: (result: RemoteFilePullResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingRemoteFilePush: Map<
    string,
    {
      resolve: (result: RemoteFilePushResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingWorktreeMerge: Map<
    string,
    {
      resolve: (result: WorktreeMergeResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingWorktreeAdd: Map<
    string,
    {
      resolve: (result: WorktreeAddResult) => void;
      reject: (reason: Error | WorktreeAddError) => void;
    }
  >;
  pendingWorktreeRemove: Map<
    string,
    {
      resolve: () => void;
      reject: (reason: Error | WorktreeRemoveError) => void;
    }
  >;
  pendingGitWorktreeList: Map<
    string,
    {
      resolve: (result: GitWorktreeListResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingCreateDirs: Map<
    string,
    {
      resolve: (result: CreateDirResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFsDelete: Map<
    string,
    {
      resolve: (result: FsDeleteResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingFsRename: Map<
    string,
    {
      resolve: (result: FsRenameResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGhPrList: Map<
    string,
    {
      resolve: (result: GhPrListResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGhPrFailedLogs: Map<
    string,
    {
      resolve: (result: GhPrFailedLogsResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  pendingGhPrReviewComments: Map<
    string,
    {
      resolve: (result: GhPrReviewCommentsResult) => void;
      reject: (reason: Error) => void;
    }
  >;
  daemonHomeDir: string | null;
  specLastChanged: Map<string, number>;
  specDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Maps sessionId → set of browser WebSockets for multi-attach terminal I/O relay */
  terminalSessions: Map<string, Set<WebSocket>>;
  /** Persists terminal session metadata across browser disconnects for session restoration */
  terminalSessionMeta: Map<string, TerminalSessionMeta>;
  /** Tracks which browser WSes are awaiting a reconnect buffer replay (not broadcast to all) */
  pendingReconnects: Map<string, Set<WebSocket>>;
  /**
   * sessionIds that are mid-spawn — gates concurrent connects to prevent duplicate
   * PTYs when maybeStartContainer is slow. Resolved (and removed) once the spawn
   * attempt finishes, whether it succeeded or failed.
   */
  spawningSessions: Map<string, Promise<void>>;
  /** Dedicated daemon WebSocket for terminal traffic (zero-parse relay) */
  terminalDaemon: WebSocket | null;
  /**
   * Sessions the daemon last reported alive via `{ t: 'sync' }`, plus sync
   * bookkeeping. A restarted server has an empty `terminalSessionMeta`, so this
   * set is what lets it classify a browser reconnect as an existing session
   * (adopt + reconnect) instead of respawning over a live PTY. `syncWaiters`
   * holds browser connections that arrived before the daemon's sync and are
   * waiting for it to classify.
   */
  daemonTerminalSessions: {
    synced: boolean;
    ids: Set<string>;
    syncWaiters: Set<() => void>;
  };
  /**
   * Sessions whose meta was restored from the DB at boot and not yet validated
   * against a daemon sync. Browser connects for these (and for sessions with no
   * meta at all) wait for the sync before classifying; live sessions with
   * in-memory meta skip the wait. Cleared by the first sync, which purges any
   * restored entries the daemon no longer has.
   */
  restoredTerminalSessions: Set<string>;
  /** Browser WebSockets subscribed to file change events */
  fileChangeListeners: Set<WebSocket>;
  /** Callbacks for streaming container build progress to terminals */
  containerProgressListeners: Map<string, (line: string) => void>;
  /** Timer handle for the PR polling self-scheduling chain; null until startPrPoller is called */
  prPollerTimer: ReturnType<typeof setTimeout> | null;
  /** Latest gh error per repo (typed strings like 'gh-not-installed'); cleared on next success */
  prRepoErrors: Map<string, string>;
  /** Maps `repo#prNumber` → GitHub PR updatedAt from the last successful review-comment sync */
  prReviewCommentLastSyncedAt: Map<string, string>;
  /** Terminal sessions connected as dispatch workers (sessionId → description) */
  dispatchWorkers: Map<string, DispatchWorker>;
  /** Cross-terminal dispatches by correlationId (in-memory; lost on restart) */
  dispatches: Map<string, DispatchEntry>;
  /** Callbacks awaiting a dispatch reply, keyed by correlationId */
  dispatchWaiters: Map<string, Array<(entry: DispatchEntry) => void>>;
  /** Queued correlationIds per worker, delivered one at a time on idle */
  dispatchInbox: Map<string, string[]>;
  /** Settled-dispatch notices queued per origin session, flushed when that terminal goes idle */
  dispatchReplyNotices: Map<string, string[]>;
  /** Recent PTY output tail per connected worker (bounded; for terminal_status) */
  terminalOutputTails: Map<string, string>;
}

const GLOBAL_KEY = '__engy_app_state__' as const;

export function createAppState(): AppState {
  return {
    daemon: null,
    fileChanges: new Map(),
    pendingValidations: new Map(),
    pendingFileSearches: new Map(),
    pendingGitStatus: new Map(),
    pendingGitLog: new Map(),
    pendingGitShow: new Map(),
    pendingGitBranchFiles: new Map(),
    pendingContainerUp: new Map(),
    pendingContainerDown: new Map(),
    pendingContainerStatus: new Map(),
    pendingDevcontainerGenerate: new Map(),
    pendingExecutionStart: new Map(),
    pendingExecutionStop: new Map(),
    pendingDirList: new Map(),
    pendingFileRead: new Map(),
    pendingFileReadImage: new Map(),
    pendingGlobFiles: new Map(),
    pendingFileWrite: new Map(),
    pendingRemoteFilePull: new Map(),
    pendingRemoteFilePush: new Map(),
    pendingWorktreeMerge: new Map(),
    pendingWorktreeAdd: new Map(),
    pendingWorktreeRemove: new Map(),
    pendingGitWorktreeList: new Map(),
    pendingCreateDirs: new Map(),
    pendingFsDelete: new Map(),
    pendingFsRename: new Map(),
    pendingGhPrList: new Map(),
    pendingGhPrFailedLogs: new Map(),
    pendingGhPrReviewComments: new Map(),
    daemonHomeDir: null,
    specLastChanged: new Map(),
    specDebounceTimers: new Map(),
    terminalSessions: new Map(),
    terminalSessionMeta: new Map(),
    pendingReconnects: new Map(),
    spawningSessions: new Map(),
    terminalDaemon: null,
    daemonTerminalSessions: { synced: false, ids: new Set(), syncWaiters: new Set() },
    restoredTerminalSessions: new Set(),
    fileChangeListeners: new Set(),
    containerProgressListeners: new Map(),
    prPollerTimer: null,
    prRepoErrors: new Map(),
    prReviewCommentLastSyncedAt: new Map(),
    dispatchWorkers: new Map(),
    dispatches: new Map(),
    dispatchWaiters: new Map(),
    dispatchInbox: new Map(),
    dispatchReplyNotices: new Map(),
    terminalOutputTails: new Map(),
  };
}

export function getAppState(): AppState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createAppState();
  }
  return g[GLOBAL_KEY] as AppState;
}

export function resetAppState(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = undefined;
}
