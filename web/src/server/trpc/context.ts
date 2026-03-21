import type WebSocket from 'ws';
import type { GitFileStatus } from '@engy/common';

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
  groupKey?: string;
  workspaceSlug?: string;
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
  diff: string;
  files: Array<{ path: string; status: GitFileStatus }>;
}

export interface GitBranchFilesResult {
  files: Array<{ path: string; status: GitFileStatus }>;
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
  pendingGitDiff: Map<
    string,
    {
      resolve: (result: string) => void;
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
  specLastChanged: Map<string, number>;
  specDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Maps sessionId → browser WebSocket for terminal I/O relay */
  terminalSessions: Map<string, WebSocket>;
  /** Persists terminal session metadata across browser disconnects for session restoration */
  terminalSessionMeta: Map<string, TerminalSessionMeta>;
  /** Dedicated daemon WebSocket for terminal traffic (zero-parse relay) */
  terminalDaemon: WebSocket | null;
  /** Browser WebSockets subscribed to file change events */
  fileChangeListeners: Set<WebSocket>;
  /** Callbacks for streaming container build progress to terminals */
  containerProgressListeners: Map<string, (line: string) => void>;
}

const GLOBAL_KEY = '__engy_app_state__' as const;

export function getAppState(): AppState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      daemon: null,
      fileChanges: new Map(),
      pendingValidations: new Map(),
      pendingFileSearches: new Map(),
      pendingGitStatus: new Map(),
      pendingGitDiff: new Map(),
      pendingGitLog: new Map(),
      pendingGitShow: new Map(),
      pendingGitBranchFiles: new Map(),
      pendingContainerUp: new Map(),
      pendingContainerDown: new Map(),
      pendingContainerStatus: new Map(),
      specLastChanged: new Map(),
      specDebounceTimers: new Map(),
      terminalSessions: new Map(),
      terminalSessionMeta: new Map(),
      terminalDaemon: null,
      fileChangeListeners: new Set(),
      containerProgressListeners: new Map(),
    };
  }
  return g[GLOBAL_KEY] as AppState;
}

export function resetAppState(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = undefined;
}
