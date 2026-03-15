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
  ContainerUpRequestMessage,
  ContainerDownRequestMessage,
  ContainerStatusRequestMessage,
  TerminalRelayCommand,
} from '@engy/common';
import { getStatusDetailed, getDiff, getLog, getShow, getBranchFiles } from '../git/index.js';
import { ContainerManager } from '../container/manager.js';
import { generateDevcontainerConfig } from '../container/config-generator.js';
import type { TerminalManager } from '../terminal/manager.js';

const execFileAsync = promisify(execFile);

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FACTOR = 0.2;

interface WsClientOptions {
  serverUrl: string;
  onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  terminalManager?: TerminalManager;
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

async function listFilesForDir(
  dir: string,
): Promise<string[]> {
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
  private attempt = 0;
  private terminalAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private readonly wsUrl: string;
  private readonly terminalRelayUrl: string;
  private readonly onWorkspacesSync?: (message: WorkspacesSyncMessage) => void;
  private readonly terminalManager?: TerminalManager;

  constructor(options: WsClientOptions) {
    this.wsUrl = deriveWsUrl(options.serverUrl);
    this.terminalRelayUrl = deriveTerminalRelayUrl(options.serverUrl);
    this.onWorkspacesSync = options.onWorkspacesSync;
    this.terminalManager = options.terminalManager;
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

  private createConnection(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.attempt = 0;
      this.send({ type: 'REGISTER', payload: {} });
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', () => {
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // close event follows, which triggers reconnect
    });
  }

  private createTerminalConnection(): void {
    if (!this.terminalManager) return;

    this.terminalWs = new WebSocket(this.terminalRelayUrl);

    this.terminalWs.on('open', () => {
      this.terminalAttempt = 0;
      // Wire terminal manager to send via terminal WS
      this.terminalManager!.setSendCallback((msg) => {
        if (this.terminalWs?.readyState === WebSocket.OPEN) {
          this.terminalWs.send(msg);
        }
      });

      // Resync: resume any sessions suspended during disconnect
      for (const session of this.terminalManager!.getAllSessions()) {
        if (session.state === 'suspended') {
          this.terminalManager!.handleReconnect(session.sessionId);
        }
      }
    });

    this.terminalWs.on('message', (data) => {
      this.handleTerminalMessage(data);
    });

    this.terminalWs.on('close', () => {
      // Suspend active sessions so output is buffered, not lost
      for (const session of this.terminalManager!.getAllSessions()) {
        if (session.state === 'active') {
          this.terminalManager!.suspend(session.sessionId);
        }
      }
      this.scheduleTerminalReconnect();
    });

    this.terminalWs.on('error', () => {
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
      case 'CONTAINER_UP_REQUEST':
        this.handleContainerUpRequest(message as ContainerUpRequestMessage);
        break;
      case 'CONTAINER_DOWN_REQUEST':
        this.handleContainerDownRequest(message as ContainerDownRequestMessage);
        break;
      case 'CONTAINER_STATUS_REQUEST':
        this.handleContainerStatusRequest(message as ContainerStatusRequestMessage);
        break;
    }
  }

  private handleTerminalMessage(data: WebSocket.RawData): void {
    let msg: TerminalRelayCommand;
    try {
      msg = JSON.parse(data.toString()) as TerminalRelayCommand;
    } catch {
      return;
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

  private async handleGitBranchFilesRequest(message: GitBranchFilesRequestMessage): Promise<void> {
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

  private async handleContainerUpRequest(message: ContainerUpRequestMessage): Promise<void> {
    const { requestId, workspaceFolder, repos, config } = message.payload;
    try {
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

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.attempt);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, delay);
  }

  private scheduleTerminalReconnect(): void {
    if (this.intentionallyClosed) return;

    const delay = computeBackoff(this.terminalAttempt);
    this.terminalAttempt++;
    this.terminalReconnectTimer = setTimeout(() => {
      this.terminalReconnectTimer = null;
      this.createTerminalConnection();
    }, delay);
  }
}
