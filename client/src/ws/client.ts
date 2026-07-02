import WebSocket from 'ws';
import path from 'node:path';
import os from 'node:os';
import { access, mkdir, readdir, rm, rename, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ClientToServerMessage,
  WorkspacesSyncMessage,
  ValidatePathsRequestMessage,
  CreateDirRequestMessage,
  SearchFilesRequestMessage,
  GitStatusRequestMessage,
  GitDiffRequestMessage,
  GitLogRequestMessage,
  GitShowRequestMessage,
  GitBranchFilesRequestMessage,
  GitWorktreeListRequestMessage,
  DirListEntry,
  DirListRequestMessage,
  FileReadRequestMessage,
  FileReadImageRequestMessage,
  FileWriteRequestMessage,
  ContainerUpRequestMessage,
  ContainerDownRequestMessage,
  ContainerStatusRequestMessage,
  DevcontainerConfigGenerateRequestMessage,
  ExecutionStartRequestMessage,
  ExecutionStopRequestMessage,
  RemoteFilePullRequestMessage,
  RemoteFilePushRequestMessage,
  WorktreeMergeRequestMessage,
  WorktreeAddRequestMessage,
  WorktreeAddErrorCode,
  WorktreeRemoveRequestMessage,
  WorktreeRemoveErrorCode,
  GlobFilesRequestMessage,
  FsDeleteRequestMessage,
  FsRenameRequestMessage,
  GhPrListRequestMessage,
  GhAuthStatusRequestMessage,
  TerminalRelayCommand,
  TerminalSyncEvent,
} from '@engy/common';
import { listOpenPrs, checkAuthStatus, localGhRunner } from '../gh/index.js';
import {
  getStatusDetailed,
  getDiff,
  getLog,
  getShow,
  getBranchFiles,
  getFileContent,
  getFileBytes,
  writeFileContent,
  listWorktrees,
  localGitRunner,
  type GitRunner,
  globTestFiles,
} from '../git/index.js';
import { ContainerManager } from '../container/manager.js';
import { CoderManager } from '../container/coder-manager.js';
import { generateDevcontainerConfig } from '../container/config-generator.js';
import type { TerminalManager } from '../terminal/manager.js';
import { Runner } from '../runner/index.js';
import { AgentSpawner } from '../runner/agent-spawner.js';

const execFileAsync = promisify(execFile);

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as unknown as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.length > 0) {
      return `${err.message}\n${stderr}`;
    }
    return err.message;
  }
  return String(err);
}

function classifyWorktreeAddError(msg: string): WorktreeAddErrorCode {
  const lower = msg.toLowerCase();
  if (
    lower.includes('a branch named') ||
    (lower.includes('already exists') && (lower.includes('branch') || lower.includes('refs/heads')))
  ) {
    return 'BRANCH_EXISTS';
  }
  if (
    lower.includes('already checked out') ||
    lower.includes('already used by worktree') ||
    (lower.includes('already exists') && !lower.includes('branch'))
  ) {
    return 'PATH_EXISTS';
  }
  return 'OTHER';
}

function classifyWorktreeRemoveError(msg: string): WorktreeRemoveErrorCode {
  const lower = msg.toLowerCase();
  if (
    lower.includes('is dirty') ||
    lower.includes('contains modified') ||
    lower.includes('contains untracked') ||
    lower.includes('is not empty') ||
    lower.includes('uncommitted')
  ) {
    return 'DIRTY';
  }
  return 'OTHER';
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;
const PING_INTERVAL_MS = 30_000;
// Terminate a half-open socket if two consecutive pings receive no pong.
const PONG_DEADLINE_INTERVALS = 2;

// Message types that must survive a reconnect (execution lifecycle events).
const OUTBOX_TYPES = new Set([
  'EXECUTION_STATUS_EVENT',
  'EXECUTION_COMPLETE_EVENT',
  'CREATE_MEMORIES_EVENT',
]);
const OUTBOX_MAX = 100;

interface WsClientOptions {
  serverUrl: string;
  onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  terminalManager?: TerminalManager;
  runner?: Runner;
}

export function computeBackoff(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (2 * Math.random() - 1);
  return Math.max(0, base + jitter);
}

export function deriveWsUrl(httpUrl: string): string {
  const base = httpUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/ws`;
}

export function deriveTerminalRelayUrl(httpUrl: string): string {
  const base = httpUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/ws/terminal-relay`;
}

async function validatePaths(paths: string[]): Promise<Array<{ path: string; exists: boolean }>> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        await access(p);
        return { path: p, exists: true };
      } catch {
        return { path: p, exists: false };
      }
    }),
  );
}

const MAX_READDIR_DEPTH = 10;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function getGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      maxBuffer: EXEC_MAX_BUFFER,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function listGitFiles(dir: string, gitRoot: string): Promise<string[]> {
  const prefix = path.relative(gitRoot, dir);
  const args = ['-C', gitRoot, 'ls-files'];
  if (prefix) args.push('--', `${prefix}/`);

  const { stdout } = await execFileAsync('git', args, { maxBuffer: EXEC_MAX_BUFFER });
  const lines = stdout.split('\n').filter(Boolean);

  if (!prefix) return lines;
  return lines.map((line) => path.relative(prefix, line));
}

async function listDirFilesRecursive(
  rootDir: string,
  currentDir: string,
  depth: number,
): Promise<string[]> {
  if (depth <= 0) return [];
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath));
    } else if (entry.isDirectory()) {
      files.push(...(await listDirFilesRecursive(rootDir, fullPath, depth - 1)));
    }
  }
  return files;
}

function deduplicateLabels(dirs: string[]): Map<string, string> {
  const basenames = dirs.map((d) => path.basename(d));
  const counts = new Map<string, number>();
  for (const b of basenames) counts.set(b, (counts.get(b) ?? 0) + 1);

  const labels = new Map<string, string>();
  for (const dir of dirs) {
    const base = path.basename(dir);
    if (counts.get(base)! > 1) {
      const parent = path.basename(path.dirname(dir));
      labels.set(dir, `${parent}/${base}`);
    } else {
      labels.set(dir, base);
    }
  }
  return labels;
}

function fuzzyMatch(filePath: string, query: string): boolean {
  if (!query) return true;
  return filePath.toLowerCase().includes(query.toLowerCase());
}

async function listFilesForDir(dir: string): Promise<string[]> {
  const gitRoot = await getGitRoot(dir);
  if (gitRoot) {
    return listGitFiles(dir, gitRoot);
  }
  return listDirFilesRecursive(dir, dir, MAX_READDIR_DEPTH);
}

async function searchFilesInDirs(
  dirs: string[],
  query: string,
  limit: number,
): Promise<Array<{ label: string; path: string }>> {
  const labels = deduplicateLabels(dirs);

  const allFiles = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const files = await listFilesForDir(dir);
        return { label: labels.get(dir)!, files };
      } catch {
        return { label: '', files: [] as string[] };
      }
    }),
  );

  const results: Array<{ label: string; path: string }> = [];
  for (const { label, files } of allFiles) {
    for (const file of files) {
      if (fuzzyMatch(file, query)) {
        results.push({ label, path: file });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

function resolveContainedPath(rootDir: string, relPath: string, label: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error(`${label} must be relative, got: ${relPath}`);
  }
  const resolved = path.resolve(rootDir, relPath);
  const rel = path.relative(path.resolve(rootDir), resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new Error(`Path traversal rejected for ${label}: ${relPath}`);
  }
  return resolved;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private terminalWs: WebSocket | null = null;
  private containerManager = new ContainerManager();
  private coderManager = new CoderManager();
  private attempt = 0;
  private terminalAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private terminalPingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyClosed = false;
  // Outbox for execution-critical messages queued while the socket is not OPEN.
  private outbox: ClientToServerMessage[] = [];
  // Last-pong timestamps for half-open detection.
  private lastPong: Record<'main' | 'terminal', number> = { main: 0, terminal: 0 };
  private readonly wsUrl: string;
  private readonly terminalRelayUrl: string;
  private readonly serverPort: number;
  private readonly onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  private readonly terminalManager?: TerminalManager;
  private readonly runner: Runner;

  constructor(options: WsClientOptions) {
    this.wsUrl = deriveWsUrl(options.serverUrl);
    this.terminalRelayUrl = deriveTerminalRelayUrl(options.serverUrl);
    this.serverPort = new URL(options.serverUrl).port
      ? parseInt(new URL(options.serverUrl).port, 10)
      : 3000;
    this.onWorkspacesSync = options.onWorkspacesSync;
    this.terminalManager = options.terminalManager;
    const spawner = new AgentSpawner(this.containerManager, this.coderManager);
    this.runner = options.runner ?? new Runner(spawner, (msg) => this.send(msg));
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.createConnection();
    this.createTerminalConnection();
  }

  send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }

    if (OUTBOX_TYPES.has(message.type)) {
      // Cap to bound memory; on overflow prefer dropping the oldest status event
      // so complete/memories events are never silently discarded.
      if (this.outbox.length >= OUTBOX_MAX) {
        const statusIdx = this.outbox.findIndex((m) => m.type === 'EXECUTION_STATUS_EVENT');
        if (statusIdx !== -1) {
          this.outbox.splice(statusIdx, 1);
        } else {
          this.outbox.shift();
        }
      }
      this.outbox.push(message);
    }
  }

  private flushOutbox(): void {
    if (this.outbox.length === 0 || this.ws?.readyState !== WebSocket.OPEN) return;
    const pending = this.outbox.splice(0);
    for (const msg of pending) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.intentionallyClosed = true;
    this.stopPing('main');
    this.stopPing('terminal');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.terminalReconnectTimer) {
      clearTimeout(this.terminalReconnectTimer);
      this.terminalReconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.terminalWs?.close();
    this.terminalWs = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startPing(which: 'main' | 'terminal'): void {
    this.stopPing(which);
    // Seed so the first interval doesn't false-positive immediately.
    this.lastPong[which] = Date.now();

    const timer = setInterval(() => {
      const ws = which === 'main' ? this.ws : this.terminalWs;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const elapsed = Date.now() - this.lastPong[which];
      const deadline = PING_INTERVAL_MS * PONG_DEADLINE_INTERVALS;
      if (elapsed > deadline) {
        console.warn(`[ws-${which}] No pong in ${elapsed}ms — terminating half-open connection`);
        ws.terminate();
        return;
      }

      ws.ping();
    }, PING_INTERVAL_MS);

    if (which === 'main') {
      this.pingTimer = timer;
    } else {
      this.terminalPingTimer = timer;
    }
  }

  private stopPing(which: 'main' | 'terminal'): void {
    const timerKey = which === 'main' ? 'pingTimer' : 'terminalPingTimer';
    if (this[timerKey]) {
      clearInterval(this[timerKey]);
      this[timerKey] = null;
    }
  }

  private createConnection(): void {
    // Terminate old connection immediately to prevent ghost handlers
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }

    console.log(`[ws-main] Connecting to ${this.wsUrl}`);
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      console.log('[ws-main] Connected');
      this.attempt = 0;
      this.send({ type: 'REGISTER', payload: { homeDir: os.homedir() } });
      this.startPing('main');
      this.flushOutbox();
    });

    ws.on('pong', () => {
      if (this.ws !== ws) return;
      this.lastPong.main = Date.now();
    });

    ws.on('message', (data) => {
      if (this.ws !== ws) return;
      this.handleMessage(data);
    });

    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      console.log(`[ws-main] Disconnected: code=${code} reason=${reason?.toString() ?? ''}`);
      this.stopPing('main');
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error(`[ws-main] Error: ${err.message}`);
    });
  }

  private createTerminalConnection(): void {
    if (!this.terminalManager) return;

    // Terminate old connection immediately to prevent ghost handlers
    if (this.terminalWs) {
      this.terminalWs.terminate();
      this.terminalWs = null;
    }

    console.log(`[ws-terminal] Connecting to ${this.terminalRelayUrl}`);
    const ws = new WebSocket(this.terminalRelayUrl);
    this.terminalWs = ws;

    ws.on('pong', () => {
      if (this.terminalWs !== ws) return;
      this.lastPong.terminal = Date.now();
    });

    ws.on('open', () => {
      if (this.terminalWs !== ws) return;
      console.log('[ws-terminal] Connected to terminal relay');
      this.terminalAttempt = 0;
      this.startPing('terminal');
      // Wire terminal manager to send via terminal WS
      this.terminalManager!.setSendCallback((msg) => {
        if (this.terminalWs?.readyState === WebSocket.OPEN) {
          this.terminalWs.send(msg);
        }
      });

      // Announce known sessions so server can clean up stale ones
      const allSessions = this.terminalManager!.getAllSessions();
      const sessionIds = allSessions.map((s) => s.sessionId);
      console.log(
        `[ws-terminal] Sending sync with ${sessionIds.length} sessions: [${sessionIds.join(', ')}]`,
      );
      ws.send(JSON.stringify({ t: 'sync', sessionIds } satisfies TerminalSyncEvent));

      // Resync: resume any sessions suspended during disconnect
      const suspended = allSessions.filter((s) => s.state === 'suspended');
      if (suspended.length > 0) {
        console.log(
          `[ws-terminal] Resync: resuming ${suspended.length} suspended sessions: [${suspended.map((s) => s.sessionId).join(', ')}]`,
        );
      }
      for (const session of suspended) {
        this.terminalManager!.handleReconnect(session.sessionId);
      }
    });

    ws.on('message', (data) => {
      if (this.terminalWs !== ws) return;
      this.handleTerminalMessage(data);
    });

    ws.on('close', (code, reason) => {
      // Ignore close events from superseded connections
      if (this.terminalWs !== ws) return;
      this.stopPing('terminal');
      console.log(
        `[ws-terminal] Terminal relay disconnected: code=${code} reason=${reason?.toString() ?? ''}`,
      );
      // Suspend active sessions so output is buffered, not lost
      const allSessions = this.terminalManager!.getAllSessions();
      const active = allSessions.filter((s) => s.state === 'active');
      if (active.length > 0) {
        console.log(
          `[ws-terminal] Suspending ${active.length} active sessions: [${active.map((s) => s.sessionId).join(', ')}]`,
        );
      }
      for (const session of active) {
        this.terminalManager!.suspend(session.sessionId);
      }
      this.scheduleTerminalReconnect();
    });

    ws.on('error', (err) => {
      console.error('[ws-terminal] Terminal relay error:', err.message);
      // close event follows, which triggers reconnect
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (message.type) {
      case 'WORKSPACES_SYNC':
        this.onWorkspacesSync?.(message as WorkspacesSyncMessage);
        break;
      case 'VALIDATE_PATHS_REQUEST':
        this.handleValidatePathsRequest(message as ValidatePathsRequestMessage);
        break;
      case 'SEARCH_FILES_REQUEST':
        this.handleSearchFilesRequest(message as SearchFilesRequestMessage);
        break;
      case 'GIT_STATUS_REQUEST':
        this.handleGitStatusRequest(message as GitStatusRequestMessage);
        break;
      case 'GIT_DIFF_REQUEST':
        this.handleGitDiffRequest(message as GitDiffRequestMessage);
        break;
      case 'GIT_LOG_REQUEST':
        this.handleGitLogRequest(message as GitLogRequestMessage);
        break;
      case 'GIT_SHOW_REQUEST':
        this.handleGitShowRequest(message as GitShowRequestMessage);
        break;
      case 'GIT_BRANCH_FILES_REQUEST':
        this.handleGitBranchFilesRequest(message as GitBranchFilesRequestMessage);
        break;
      case 'GIT_WORKTREE_LIST_REQUEST':
        this.handleGitWorktreeListRequest(message as GitWorktreeListRequestMessage);
        break;
      case 'DIR_LIST_REQUEST':
        this.handleDirListRequest(message as DirListRequestMessage);
        break;
      case 'FILE_READ_REQUEST':
        this.handleFileReadRequest(message as FileReadRequestMessage);
        break;
      case 'FILE_READ_IMAGE_REQUEST':
        this.handleFileReadImageRequest(message as FileReadImageRequestMessage);
        break;
      case 'GLOB_FILES_REQUEST':
        this.handleGlobFilesRequest(message as GlobFilesRequestMessage);
        break;
      case 'FILE_WRITE_REQUEST':
        this.handleFileWriteRequest(message as FileWriteRequestMessage);
        break;
      case 'CONTAINER_UP_REQUEST':
        this.handleContainerUpRequest(message as ContainerUpRequestMessage);
        break;
      case 'CONTAINER_DOWN_REQUEST':
        this.handleContainerDownRequest(message as ContainerDownRequestMessage);
        break;
      case 'CONTAINER_STATUS_REQUEST':
        this.handleContainerStatusRequest(message as ContainerStatusRequestMessage);
        break;
      case 'DEVCONTAINER_CONFIG_GENERATE_REQUEST':
        this.handleDevcontainerConfigGenerate(message as DevcontainerConfigGenerateRequestMessage);
        break;
      case 'REMOTE_FILE_PULL_REQUEST':
        this.handleRemoteFilePullRequest(message as RemoteFilePullRequestMessage);
        break;
      case 'REMOTE_FILE_PUSH_REQUEST':
        this.handleRemoteFilePushRequest(message as RemoteFilePushRequestMessage);
        break;
      case 'WORKTREE_MERGE_REQUEST':
        this.handleWorktreeMergeRequest(message as WorktreeMergeRequestMessage);
        break;
      case 'WORKTREE_ADD_REQUEST':
        this.handleWorktreeAddRequest(message as WorktreeAddRequestMessage);
        break;
      case 'WORKTREE_REMOVE_REQUEST':
        this.handleWorktreeRemoveRequest(message as WorktreeRemoveRequestMessage);
        break;
      case 'EXECUTION_START_REQUEST':
        this.handleExecutionStartRequest(message as ExecutionStartRequestMessage);
        break;
      case 'EXECUTION_STOP_REQUEST':
        this.handleExecutionStopRequest(message as ExecutionStopRequestMessage);
        break;
      case 'CREATE_DIR_REQUEST':
        this.handleCreateDirRequest(message as CreateDirRequestMessage);
        break;
      case 'FS_DELETE_REQUEST':
        this.handleFsDeleteRequest(message as FsDeleteRequestMessage);
        break;
      case 'FS_RENAME_REQUEST':
        this.handleFsRenameRequest(message as FsRenameRequestMessage);
        break;
      case 'GH_PR_LIST_REQUEST':
        this.handleGhPrListRequest(message as GhPrListRequestMessage);
        break;
      case 'GH_AUTH_STATUS_REQUEST':
        this.handleGhAuthStatusRequest(message as GhAuthStatusRequestMessage);
        break;
    }
  }

  private handleTerminalMessage(data: WebSocket.RawData): void {
    let msg: TerminalRelayCommand;
    try {
      msg = JSON.parse(data.toString()) as TerminalRelayCommand;
    } catch {
      console.warn('[ws-terminal] Failed to parse terminal message');
      return;
    }

    // Log non-input messages (input is too noisy)
    if (msg.t !== 'i') {
      console.log(`[ws-terminal] Received: t=${msg.t} sessionId=${msg.sessionId}`);
    }

    switch (msg.t) {
      case 'spawn':
        this.terminalManager?.spawn({
          sessionId: msg.sessionId,
          workingDir: msg.workingDir,
          cols: msg.cols,
          rows: msg.rows,
          command: msg.command,
          containerWorkspaceFolder: msg.containerWorkspaceFolder,
          coderWorkspace: msg.coderWorkspace,
          serverPort: msg.serverPort,
        });
        break;
      case 'i':
        this.terminalManager?.write(msg.sessionId, msg.d);
        break;
      case 'resize':
        this.terminalManager?.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'kill':
        this.terminalManager?.kill(msg.sessionId);
        break;
      case 'reconnect':
        this.terminalManager?.handleReconnect(msg.sessionId);
        break;
    }
  }

  private async handleValidatePathsRequest(message: ValidatePathsRequestMessage): Promise<void> {
    const results = await validatePaths(message.payload.paths);
    this.send({
      type: 'VALIDATE_PATHS_RESPONSE',
      payload: {
        requestId: message.payload.requestId,
        results,
      },
    });
  }

  private async handleSearchFilesRequest(message: SearchFilesRequestMessage): Promise<void> {
    const { requestId, dirs, query, limit } = message.payload;
    const results = await searchFilesInDirs(dirs, query, limit);
    this.send({
      type: 'SEARCH_FILES_RESPONSE',
      payload: { requestId, results },
    });
  }

  private gitRunnerFor(coderWorkspace?: string): GitRunner {
    if (!coderWorkspace) return localGitRunner;
    return (args) => this.coderManager.execCapture(coderWorkspace, 'git', args);
  }

  private async handleGitStatusRequest(message: GitStatusRequestMessage): Promise<void> {
    const { requestId, repoDir, coderWorkspace } = message.payload;
    try {
      const result = await getStatusDetailed(repoDir, this.gitRunnerFor(coderWorkspace));
      this.send({
        type: 'GIT_STATUS_RESPONSE',
        payload: { requestId, files: result.files, branch: result.branch },
      });
    } catch (err) {
      this.send({
        type: 'GIT_STATUS_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitDiffRequest(message: GitDiffRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, base, staged, coderWorkspace } = message.payload;
    try {
      const diff = await getDiff(
        repoDir,
        filePath,
        base,
        staged,
        this.gitRunnerFor(coderWorkspace),
      );
      this.send({
        type: 'GIT_DIFF_RESPONSE',
        payload: { requestId, diff },
      });
    } catch (err) {
      this.send({
        type: 'GIT_DIFF_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitLogRequest(message: GitLogRequestMessage): Promise<void> {
    const { requestId, repoDir, maxCount, coderWorkspace } = message.payload;
    try {
      const commits = await getLog(repoDir, maxCount, this.gitRunnerFor(coderWorkspace));
      this.send({
        type: 'GIT_LOG_RESPONSE',
        payload: { requestId, commits },
      });
    } catch (err) {
      this.send({
        type: 'GIT_LOG_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitShowRequest(message: GitShowRequestMessage): Promise<void> {
    const { requestId, repoDir, commitHash, coderWorkspace } = message.payload;
    try {
      const result = await getShow(repoDir, commitHash, this.gitRunnerFor(coderWorkspace));
      this.send({
        type: 'GIT_SHOW_RESPONSE',
        payload: { requestId, files: result.files },
      });
    } catch (err) {
      this.send({
        type: 'GIT_SHOW_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitBranchFilesRequest(message: GitBranchFilesRequestMessage): Promise<void> {
    const { requestId, repoDir, base, coderWorkspace } = message.payload;
    try {
      const files = await getBranchFiles(repoDir, base, this.gitRunnerFor(coderWorkspace));
      this.send({
        type: 'GIT_BRANCH_FILES_RESPONSE',
        payload: { requestId, files },
      });
    } catch (err) {
      this.send({
        type: 'GIT_BRANCH_FILES_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitWorktreeListRequest(
    message: GitWorktreeListRequestMessage,
  ): Promise<void> {
    const { requestId, repoDir, coderWorkspace } = message.payload;
    try {
      const worktrees = await listWorktrees(repoDir, this.gitRunnerFor(coderWorkspace));
      this.send({
        type: 'GIT_WORKTREE_LIST_RESPONSE',
        payload: { requestId, worktrees },
      });
    } catch (err) {
      this.send({
        type: 'GIT_WORKTREE_LIST_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleDirListRequest(message: DirListRequestMessage): Promise<void> {
    const { requestId, dirPath } = message.payload;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      const statted = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e): Promise<DirListEntry | null> => {
            try {
              const s = await stat(path.join(dirPath, e.name));
              return { name: e.name, mtime: s.mtimeMs };
            } catch {
              return null; // Entry deleted between readdir and stat — skip it
            }
          }),
      );
      const fileEntries = statted.filter((e): e is DirListEntry => e !== null);
      dirs.sort();
      fileEntries.sort((a, b) => a.name.localeCompare(b.name));
      this.send({
        type: 'DIR_LIST_RESPONSE',
        payload: { requestId, dirs, files: fileEntries },
      });
    } catch (err) {
      this.send({
        type: 'DIR_LIST_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleCreateDirRequest(message: CreateDirRequestMessage): Promise<void> {
    const { requestId, paths } = message.payload;
    try {
      const results = await Promise.all(
        paths.map(async (p) => {
          try {
            await mkdir(p, { recursive: true });
            return { path: p, success: true };
          } catch (err) {
            return {
              path: p,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      this.send({
        type: 'CREATE_DIR_RESPONSE',
        payload: { requestId, results },
      });
    } catch (err) {
      this.send({
        type: 'CREATE_DIR_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleFsDeleteRequest(message: FsDeleteRequestMessage): Promise<void> {
    const { requestId, rootDir, relPath } = message.payload;
    try {
      const resolved = resolveContainedPath(rootDir, relPath, 'relPath');
      if (resolved === path.resolve(rootDir)) {
        throw new Error('Cannot delete root directory');
      }
      await rm(resolved, { recursive: true });
      this.send({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'FS_DELETE_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleFsRenameRequest(message: FsRenameRequestMessage): Promise<void> {
    const { requestId, rootDir, oldRelPath, newRelPath } = message.payload;
    try {
      const resolvedOld = resolveContainedPath(rootDir, oldRelPath, 'oldRelPath');
      const resolvedNew = resolveContainedPath(rootDir, newRelPath, 'newRelPath');
      try {
        await stat(resolvedNew);
        throw new Error(`Target already exists: ${newRelPath}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
      await mkdir(path.dirname(resolvedNew), { recursive: true });
      await rename(resolvedOld, resolvedNew);
      this.send({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'FS_RENAME_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleFileReadRequest(message: FileReadRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, ref, coderWorkspace } = message.payload;
    try {
      let content: string;
      if (coderWorkspace) {
        if (ref) {
          content = await getFileContent(repoDir, filePath, ref, this.gitRunnerFor(coderWorkspace));
        } else {
          const posixPath = filePath.startsWith('/') ? filePath : `${repoDir}/${filePath}`;
          const { stdout } = await this.coderManager.execCapture(coderWorkspace, 'cat', [
            posixPath,
          ]);
          content = stdout;
        }
      } else {
        content = await getFileContent(repoDir, filePath, ref);
      }
      this.send({
        type: 'FILE_READ_RESPONSE',
        payload: { requestId, content },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[ws-main] FILE_READ_REQUEST failed repoDir=${repoDir} filePath=${filePath}: ${error}`,
      );
      this.send({
        type: 'FILE_READ_RESPONSE',
        payload: { requestId, error },
      });
    }
  }

  private async handleFileReadImageRequest(message: FileReadImageRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, ref, coderWorkspace } = message.payload;
    try {
      let base64: string;
      if (coderWorkspace) {
        base64 = await this.readCoderImageBase64(coderWorkspace, repoDir, filePath, ref);
        if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
          throw new Error('Image too large to preview (max 10MB)');
        }
      } else {
        // getFileBytes caps the read upfront (stat / maxBuffer) so an oversized
        // file is rejected before it can spike the daemon heap.
        base64 = (await getFileBytes(repoDir, filePath, ref, MAX_IMAGE_BYTES)).toString('base64');
      }
      this.send({
        type: 'FILE_READ_IMAGE_RESPONSE',
        payload: { requestId, base64 },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[ws-main] FILE_READ_IMAGE_REQUEST failed repoDir=${repoDir} filePath=${filePath}: ${error}`,
      );
      this.send({
        type: 'FILE_READ_IMAGE_RESPONSE',
        payload: { requestId, error },
      });
    }
  }

  /**
   * Read image bytes from a Coder workspace as base64. Binary content can't ride
   * stdout as a UTF-8 string, so we pipe through the remote `base64` encoder and
   * receive ASCII (whitespace is stripped before decoding on the server).
   */
  private async readCoderImageBase64(
    workspace: string,
    repoDir: string,
    filePath: string,
    ref?: string,
  ): Promise<string> {
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    let script: string;
    if (ref) {
      let root = repoDir;
      try {
        const { stdout: rootOut } = await this.gitRunnerFor(workspace)([
          '-C',
          repoDir,
          'rev-parse',
          '--show-toplevel',
        ]);
        root = rootOut.trim() || repoDir;
      } catch {
        // Not a git repo / rev-parse failed — fall back to repoDir, mirroring
        // the local getGitRoot behaviour.
      }
      script = `git -C ${quote(root)} show ${quote(`${ref}:${filePath}`)} | base64`;
    } else {
      const posixPath = filePath.startsWith('/') ? filePath : `${repoDir}/${filePath}`;
      script = `base64 ${quote(posixPath)}`;
    }
    const { stdout } = await this.coderManager.execCapture(workspace, 'sh', ['-c', script]);
    return stdout.replace(/\s+/g, '');
  }

  private async handleGlobFilesRequest(message: GlobFilesRequestMessage): Promise<void> {
    const { requestId, repoDir, patterns } = message.payload;
    try {
      const files = await globTestFiles(repoDir, patterns);
      console.log(
        `[ws-main] GLOB_FILES_REQUEST repoDir=${repoDir} patterns=${patterns.join(',')} -> ${files.length} file(s)`,
      );
      this.send({
        type: 'GLOB_FILES_RESPONSE',
        payload: { requestId, files },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[ws-main] GLOB_FILES_REQUEST failed repoDir=${repoDir}: ${error}`);
      this.send({
        type: 'GLOB_FILES_RESPONSE',
        payload: { requestId, error },
      });
    }
  }

  private async handleFileWriteRequest(message: FileWriteRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, content, coderWorkspace } = message.payload;
    try {
      if (coderWorkspace) {
        const posixPath = filePath.startsWith('/') ? filePath : `${repoDir}/${filePath}`;
        const safeFilePath = posixPath.replace(/'/g, "'\\''");
        const remoteCmd = `mkdir -p "$(dirname '${safeFilePath}')" && cat > '${safeFilePath}'`;
        const child = execFile('coder', [
          'ssh',
          '--no-wait',
          coderWorkspace,
          '--',
          'bash',
          '-c',
          remoteCmd,
        ]);
        let stderrBuf = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString('utf8');
        });
        child.stdin?.on('error', () => {});
        child.stdin?.write(content);
        child.stdin?.end();
        await new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code !== 0) {
              const stderr = stderrBuf.trim();
              const suffix = stderr ? `: ${stderr}` : '';
              reject(new Error(`coder ssh write failed (exit ${code})${suffix}`));
            } else {
              resolve();
            }
          });
          child.on('error', reject);
        });
      } else {
        await writeFileContent(repoDir, filePath, content);
      }
      this.send({
        type: 'FILE_WRITE_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'FILE_WRITE_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleRemoteFilePullRequest(message: RemoteFilePullRequestMessage): Promise<void> {
    const { requestId, coderWorkspace, filePath } = message.payload;
    try {
      const { stdout } = await this.coderManager.execCapture(coderWorkspace, 'cat', [filePath]);
      this.send({
        type: 'REMOTE_FILE_PULL_RESPONSE',
        payload: { requestId, content: stdout },
      });
    } catch (err) {
      this.send({
        type: 'REMOTE_FILE_PULL_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleRemoteFilePushRequest(message: RemoteFilePushRequestMessage): Promise<void> {
    const { requestId, coderWorkspace, filePath, content } = message.payload;
    try {
      const safeFilePath = filePath.replace(/'/g, "'\\''");
      const remoteCmd = `mkdir -p "$(dirname '${safeFilePath}')" && cat > '${safeFilePath}'`;
      const child = execFile('coder', [
        'ssh',
        '--no-wait',
        coderWorkspace,
        '--',
        'bash',
        '-c',
        remoteCmd,
      ]);
      let stderrBuf = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
      });
      // If the remote shell exits before stdin drains (e.g. mkdir fails), writes
      // to stdin emit EPIPE. Swallow here — the real failure surfaces via `close`.
      child.stdin?.on('error', () => {});
      child.stdin?.write(content);
      child.stdin?.end();
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code !== 0) {
            const stderr = stderrBuf.trim();
            const suffix = stderr ? `: ${stderr}` : '';
            reject(new Error(`coder ssh push failed (exit ${code})${suffix}`));
          } else {
            resolve();
          }
        });
        child.on('error', reject);
      });
      this.send({
        type: 'REMOTE_FILE_PUSH_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'REMOTE_FILE_PUSH_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleWorktreeMergeRequest(message: WorktreeMergeRequestMessage): Promise<void> {
    const { requestId, worktreePath, repoDir, coderWorkspace } = message.payload;
    const runGit = this.gitRunnerFor(coderWorkspace);

    try {
      // Match by basename: worktree paths are `<repo>/.claude/worktrees/engy-session-<id>`
      // with a unique session id, so the basename uniquely identifies the entry.
      // This sidesteps tilde-vs-absolute differences when the stored path uses `~`
      // but `git worktree list` reports absolute paths.
      const wantBasename = path.basename(worktreePath);
      const worktrees = await listWorktrees(repoDir, runGit);
      const branch = worktrees.find((w) => path.basename(w.path) === wantBasename)?.branch ?? null;

      if (!branch) {
        this.send({
          type: 'WORKTREE_MERGE_RESULT',
          payload: { requestId, error: `No branch found for worktree: ${worktreePath}` },
        });
        return;
      }

      await runGit(['-C', repoDir, 'merge', '--no-ff', branch]);

      this.send({
        type: 'WORKTREE_MERGE_RESULT',
        payload: { requestId, success: true, branch },
      });
    } catch (err) {
      this.send({
        type: 'WORKTREE_MERGE_RESULT',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleWorktreeAddRequest(message: WorktreeAddRequestMessage): Promise<void> {
    const { requestId, repoDir, worktreePath, branch, createBranch, baseRef, coderWorkspace } =
      message.payload;
    const runGit = this.gitRunnerFor(coderWorkspace);

    const args = ['-C', repoDir, 'worktree', 'add'];
    if (createBranch) args.push('-b', branch);
    args.push(worktreePath);
    if (createBranch && baseRef) args.push(baseRef);
    if (!createBranch) args.push(branch);

    try {
      await runGit(args);
      this.send({
        type: 'WORKTREE_ADD_RESULT',
        payload: { requestId, success: true, worktreePath, branch },
      });
    } catch (err) {
      const errorMsg = errorText(err);
      this.send({
        type: 'WORKTREE_ADD_RESULT',
        payload: { requestId, error: errorMsg, code: classifyWorktreeAddError(errorMsg) },
      });
    }
  }

  private async handleWorktreeRemoveRequest(message: WorktreeRemoveRequestMessage): Promise<void> {
    const { requestId, repoDir, worktreePath, force, coderWorkspace } = message.payload;
    const runGit = this.gitRunnerFor(coderWorkspace);

    const args = ['-C', repoDir, 'worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreePath);

    try {
      await runGit(args);
      this.send({
        type: 'WORKTREE_REMOVE_RESULT',
        payload: { requestId, success: true },
      });
    } catch (err) {
      const errorMsg = errorText(err);
      this.send({
        type: 'WORKTREE_REMOVE_RESULT',
        payload: { requestId, error: errorMsg, code: classifyWorktreeRemoveError(errorMsg) },
      });
    }
  }

  private async handleContainerUpRequest(message: ContainerUpRequestMessage): Promise<void> {
    const { requestId, workspaceFolder, repos, config, executionBackend, coderWorkspace } =
      message.payload;
    try {
      if (executionBackend === 'coder' && coderWorkspace) {
        await this.coderManager.up(coderWorkspace, (line) => {
          this.send({
            type: 'CONTAINER_PROGRESS_EVENT',
            payload: { requestId, line },
          });
        });
        this.send({
          type: 'CONTAINER_UP_RESPONSE',
          payload: { requestId, containerId: coderWorkspace },
        });
      } else {
        await generateDevcontainerConfig({
          docsDir: workspaceFolder,
          repos: repos ?? [],
          containerConfig: config,
        });
        const result = await this.containerManager.up(workspaceFolder, (line) => {
          this.send({
            type: 'CONTAINER_PROGRESS_EVENT',
            payload: { requestId, line },
          });
        });
        this.send({
          type: 'CONTAINER_UP_RESPONSE',
          payload: { requestId, containerId: result.containerId },
        });
      }
    } catch (err) {
      this.send({
        type: 'CONTAINER_UP_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleDevcontainerConfigGenerate(
    message: DevcontainerConfigGenerateRequestMessage,
  ): Promise<void> {
    const { requestId, workspaceFolder, repos, config } = message.payload;
    try {
      await generateDevcontainerConfig({
        docsDir: workspaceFolder,
        repos: repos ?? [],
        containerConfig: config,
      });
      this.send({
        type: 'DEVCONTAINER_CONFIG_GENERATE_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'DEVCONTAINER_CONFIG_GENERATE_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleContainerDownRequest(message: ContainerDownRequestMessage): Promise<void> {
    const { requestId, workspaceFolder } = message.payload;
    try {
      await this.containerManager.down(workspaceFolder);
      this.send({
        type: 'CONTAINER_DOWN_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'CONTAINER_DOWN_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleContainerStatusRequest(
    message: ContainerStatusRequestMessage,
  ): Promise<void> {
    const { requestId, workspaceFolder } = message.payload;
    try {
      const result = await this.containerManager.status(workspaceFolder);
      this.send({
        type: 'CONTAINER_STATUS_RESPONSE',
        payload: { requestId, ...result },
      });
    } catch (err) {
      this.send({
        type: 'CONTAINER_STATUS_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleExecutionStartRequest(message: ExecutionStartRequestMessage): Promise<void> {
    const { requestId, sessionId, prompt, flags, config } = message.payload;
    console.log(
      `[ws-main] EXECUTION_START_REQUEST: session=${sessionId} repo=${config?.repoPath} container=${config?.containerMode} flags=${flags?.length ?? 0}`,
    );
    try {
      const runnerConfig = {
        repoPath: config?.repoPath ?? '',
        containerMode: config?.containerMode ?? false,
        containerWorkspaceFolder: config?.containerWorkspaceFolder,
        coderWorkspace: config?.coderWorkspace,
        coderRepoBasePath: config?.coderRepoBasePath,
        remote: config?.remote,
        serverPort: this.serverPort,
        env: config?.env,
        existingWorktreePath: config?.existingWorktreePath,
      };

      await this.runner.start(sessionId, prompt, flags ?? [], runnerConfig);

      console.log(`[ws-main] EXECUTION_START_RESPONSE: session=${sessionId} ok`);
      this.send({
        type: 'EXECUTION_START_RESPONSE',
        payload: { requestId, sessionId },
      });
    } catch (err) {
      console.error(
        `[ws-main] EXECUTION_START_RESPONSE: error=${err instanceof Error ? err.message : String(err)}`,
      );
      this.send({
        type: 'EXECUTION_START_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private handleExecutionStopRequest(message: ExecutionStopRequestMessage): void {
    const { requestId, sessionId } = message.payload;
    try {
      this.runner.stop(sessionId);
      this.send({
        type: 'EXECUTION_STOP_RESPONSE',
        payload: { requestId, success: true },
      });
    } catch (err) {
      this.send({
        type: 'EXECUTION_STOP_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGhPrListRequest(message: GhPrListRequestMessage): Promise<void> {
    const { requestId, repoDir } = message.payload;
    try {
      const prs = await listOpenPrs(repoDir, localGhRunner);
      this.send({
        type: 'GH_PR_LIST_RESPONSE',
        payload: { requestId, prs },
      });
    } catch (err) {
      this.send({
        type: 'GH_PR_LIST_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGhAuthStatusRequest(message: GhAuthStatusRequestMessage): Promise<void> {
    const { requestId } = message.payload;
    try {
      const status = await checkAuthStatus(localGhRunner);
      this.send({
        type: 'GH_AUTH_STATUS_RESPONSE',
        payload: { requestId, status },
      });
    } catch (err) {
      this.send({
        type: 'GH_AUTH_STATUS_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.attempt);
    console.log(
      `[ws-main] Scheduling reconnect attempt=${this.attempt} delay=${Math.round(delay)}ms`,
    );
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, delay);
  }

  private scheduleTerminalReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.terminalAttempt);
    console.log(
      `[ws-terminal] Scheduling reconnect attempt=${this.terminalAttempt} delay=${Math.round(delay)}ms`,
    );
    this.terminalAttempt++;
    this.terminalReconnectTimer = setTimeout(() => {
      this.terminalReconnectTimer = null;
      this.createTerminalConnection();
    }, delay);
  }
}
