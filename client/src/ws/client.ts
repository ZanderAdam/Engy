import WebSocket from 'ws';
import path from 'node:path';
import { access, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ClientToServerMessage,
  WorkspacesSyncMessage,
  ValidatePathsRequestMessage,
  SearchFilesRequestMessage,
  GitStatusRequestMessage,
  GitDiffRequestMessage,
  GitLogRequestMessage,
  GitShowRequestMessage,
  GitBranchFilesRequestMessage,
  DirListRequestMessage,
  FileReadRequestMessage,
  FileWriteRequestMessage,
  ContainerUpRequestMessage,
  ContainerDownRequestMessage,
  ContainerStatusRequestMessage,
  ExecutionStartRequestMessage,
  ExecutionStopRequestMessage,
  RemoteFilePullRequestMessage,
  RemoteFilePushRequestMessage,
  WorktreeMergeRequestMessage,
  TerminalRelayCommand,
  TerminalSyncEvent,
} from '@engy/common';
import {
  getStatusDetailed,
  getDiff,
  getLog,
  getShow,
  getBranchFiles,
  getFileContent,
  writeFileContent,
} from '../git/index.js';
import { ContainerManager } from '../container/manager.js';
import { CoderManager } from '../container/coder-manager.js';
import { generateDevcontainerConfig } from '../container/config-generator.js';
import type { TerminalManager } from '../terminal/manager.js';
import { Runner } from '../runner/index.js';
import { AgentSpawner } from '../runner/agent-spawner.js';

const execFileAsync = promisify(execFile);

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;
const PING_INTERVAL_MS = 30_000;

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

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__']);
const MAX_READDIR_DEPTH = 10;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

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
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
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
    const timer = setInterval(() => {
      const ws = which === 'main' ? this.ws : this.terminalWs;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.ping();
      }
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
      this.send({ type: 'REGISTER', payload: {} });
      this.startPing('main');
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
      case 'DIR_LIST_REQUEST':
        this.handleDirListRequest(message as DirListRequestMessage);
        break;
      case 'FILE_READ_REQUEST':
        this.handleFileReadRequest(message as FileReadRequestMessage);
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
      case 'REMOTE_FILE_PULL_REQUEST':
        this.handleRemoteFilePullRequest(message as RemoteFilePullRequestMessage);
        break;
      case 'REMOTE_FILE_PUSH_REQUEST':
        this.handleRemoteFilePushRequest(message as RemoteFilePushRequestMessage);
        break;
      case 'WORKTREE_MERGE_REQUEST':
        this.handleWorktreeMergeRequest(message as WorktreeMergeRequestMessage);
        break;
      case 'EXECUTION_START_REQUEST':
        this.handleExecutionStartRequest(message as ExecutionStartRequestMessage);
        break;
      case 'EXECUTION_STOP_REQUEST':
        this.handleExecutionStopRequest(message as ExecutionStopRequestMessage);
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

  private async handleGitStatusRequest(message: GitStatusRequestMessage): Promise<void> {
    const { requestId, repoDir } = message.payload;
    try {
      const result = await getStatusDetailed(repoDir);
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
    const { requestId, repoDir, filePath, base, staged } = message.payload;
    try {
      const diff = await getDiff(repoDir, filePath, base, staged);
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
    const { requestId, repoDir, maxCount } = message.payload;
    try {
      const commits = await getLog(repoDir, maxCount);
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
    const { requestId, repoDir, commitHash } = message.payload;
    try {
      const result = await getShow(repoDir, commitHash);
      this.send({
        type: 'GIT_SHOW_RESPONSE',
        payload: { requestId, diff: result.diff, files: result.files },
      });
    } catch (err) {
      this.send({
        type: 'GIT_SHOW_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleGitBranchFilesRequest(
    message: GitBranchFilesRequestMessage,
  ): Promise<void> {
    const { requestId, repoDir, base } = message.payload;
    try {
      const files = await getBranchFiles(repoDir, base);
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

  private async handleDirListRequest(message: DirListRequestMessage): Promise<void> {
    const { requestId, dirPath } = message.payload;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const dirs: string[] = [];
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__pycache__')
          continue;
        if (entry.isDirectory()) dirs.push(entry.name);
        else if (entry.isFile()) files.push(entry.name);
      }
      this.send({
        type: 'DIR_LIST_RESPONSE',
        payload: { requestId, dirs: dirs.sort(), files: files.sort() },
      });
    } catch (err) {
      this.send({
        type: 'DIR_LIST_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleFileReadRequest(message: FileReadRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, ref } = message.payload;
    try {
      const content = await getFileContent(repoDir, filePath, ref);
      this.send({
        type: 'FILE_READ_RESPONSE',
        payload: { requestId, content },
      });
    } catch (err) {
      this.send({
        type: 'FILE_READ_RESPONSE',
        payload: { requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async handleFileWriteRequest(message: FileWriteRequestMessage): Promise<void> {
    const { requestId, repoDir, filePath, content } = message.payload;
    try {
      await writeFileContent(repoDir, filePath, content);
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

  private async handleRemoteFilePullRequest(
    message: RemoteFilePullRequestMessage,
  ): Promise<void> {
    const { requestId, coderWorkspace, filePath } = message.payload;
    try {
      const { stdout } = await execFileAsync(
        'coder',
        ['ssh', coderWorkspace, '--', 'cat', filePath],
        { maxBuffer: EXEC_MAX_BUFFER },
      );
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

  private async handleRemoteFilePushRequest(
    message: RemoteFilePushRequestMessage,
  ): Promise<void> {
    const { requestId, coderWorkspace, filePath, content } = message.payload;
    try {
      const safeFilePath = filePath.replace(/'/g, "'\\''");
      const child = execFile('coder', [
        'ssh',
        coderWorkspace,
        '--',
        'bash',
        '-c',
        `cat > '${safeFilePath}'`,
      ]);
      child.stdin?.write(content);
      child.stdin?.end();
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code !== 0) reject(new Error(`coder ssh push failed (exit ${code})`));
          else resolve();
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
    const { requestId, worktreePath, repoDir } = message.payload;
    try {
      const { stdout: worktreeList } = await execFileAsync(
        'git',
        ['-C', repoDir, 'worktree', 'list', '--porcelain'],
        { maxBuffer: EXEC_MAX_BUFFER },
      );

      const blocks = worktreeList.split('\n\n');
      let branch: string | null = null;
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
        const branchLine = lines.find((l) => l.startsWith('branch '));
        if (wtPath === worktreePath && branchLine) {
          branch = branchLine.slice('branch '.length).replace('refs/heads/', '');
          break;
        }
      }

      if (!branch) {
        this.send({
          type: 'WORKTREE_MERGE_RESULT',
          payload: { requestId, error: `No branch found for worktree: ${worktreePath}` },
        });
        return;
      }

      await execFileAsync('git', ['-C', repoDir, 'merge', '--no-ff', branch], {
        maxBuffer: EXEC_MAX_BUFFER,
      });

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

  private async handleExecutionStartRequest(
    message: ExecutionStartRequestMessage,
  ): Promise<void> {
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
    const { requestId } = message.payload;
    try {
      this.runner.stop();
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
