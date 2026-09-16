import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar';
import type { WsClient } from '../ws/client.js';

const execFileAsync = promisify(execFile);

// Same default as SpecWatcher: avoids libuv FSEvents interference with
// node-pty master-fd reads on macOS, which silently drops PTY child output.
const DEFAULT_USE_POLLING = true;
const DEFAULT_POLLING_INTERVAL_MS = 1_000;

interface BranchWatcherOptions {
  usePolling?: boolean;
  pollingInterval?: number;
}

interface RepoWatch {
  gitDir: string;
  watcher: FSWatcher;
  workingDirs: Set<string>;
  lastBranch?: string;
  ready: Promise<void>;
}

interface SessionRegistration {
  gitDir: string;
  workingDir: string;
}

/**
 * `git rev-parse --absolute-git-dir` resolves both a plain repo's `.git`
 * directory and a worktree's `.git` file (`gitdir: <path>`) to the directory
 * that actually holds `HEAD` — hand-parsing the file would miss the worktree
 * case, which fires no error and just never watches anything.
 */
async function resolveGitDir(workingDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workingDir,
      'rev-parse',
      '--absolute-git-dir',
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function readHeadBranch(gitDir: string): Promise<string | undefined> {
  try {
    const content = await readFile(path.join(gitDir, 'HEAD'), 'utf-8');
    const match = content.trim().match(/^ref:\s*refs\/heads\/(.+)$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Watches each registered repo's `HEAD` for branch switches and pushes
 * `WORKTREE_BRANCH_CHANGED_EVENT` to the server. Watches are deduped by
 * resolved git dir, not by the caller's `workingDir` string, since several
 * sessions commonly point at the same working directory.
 */
export class BranchWatcher {
  private reposByGitDir = new Map<string, RepoWatch>();
  private sessions = new Map<string, SessionRegistration>();
  private pending = new Map<string, symbol>();
  private readonly wsClient: WsClient;
  private readonly options: BranchWatcherOptions;

  constructor(wsClient: WsClient, options: BranchWatcherOptions = {}) {
    this.wsClient = wsClient;
    this.options = options;
  }

  async watch(sessionId: string, workingDir: string): Promise<void> {
    this.unwatch(sessionId);

    // A kill landing while the git dir resolves would otherwise unwatch nothing
    // and leave this call to register a watch no session owns.
    const token = Symbol(sessionId);
    this.pending.set(sessionId, token);

    const gitDir = await resolveGitDir(workingDir);
    if (this.pending.get(sessionId) !== token) return;
    this.pending.delete(sessionId);
    if (!gitDir) return;

    this.sessions.set(sessionId, { gitDir, workingDir });

    let repo = this.reposByGitDir.get(gitDir);
    if (!repo) {
      repo = this.startWatchingRepo(gitDir);
      this.reposByGitDir.set(gitDir, repo);
    }
    repo.workingDirs.add(workingDir);
    // A checkout right after registering could otherwise land inside chokidar's
    // initial scan and never register as a change.
    await repo.ready;

    // The watcher ignores its initial scan, so without this a session reports
    // no branch at all until someone happens to run a checkout.
    const branch = await readHeadBranch(gitDir);
    if (!branch) return;
    repo.lastBranch = branch;
    this.wsClient.send({
      type: 'WORKTREE_BRANCH_CHANGED_EVENT',
      payload: { workingDir, branch },
    });
  }

  unwatch(sessionId: string): void {
    this.pending.delete(sessionId);

    const registration = this.sessions.get(sessionId);
    if (!registration) return;
    this.sessions.delete(sessionId);

    const repo = this.reposByGitDir.get(registration.gitDir);
    if (!repo) return;

    const stillRegistered = [...this.sessions.values()].some(
      (r) => r.gitDir === registration.gitDir && r.workingDir === registration.workingDir,
    );
    if (!stillRegistered) repo.workingDirs.delete(registration.workingDir);

    if (repo.workingDirs.size === 0) {
      repo.watcher.close();
      this.reposByGitDir.delete(registration.gitDir);
    }
  }

  private startWatchingRepo(gitDir: string): RepoWatch {
    const headPath = path.join(gitDir, 'HEAD');
    const watchOptions: ChokidarOptions = { ignoreInitial: true };
    if (this.options.usePolling ?? DEFAULT_USE_POLLING) {
      watchOptions.usePolling = true;
      watchOptions.interval = this.options.pollingInterval ?? DEFAULT_POLLING_INTERVAL_MS;
    }

    const watcher = watch(headPath, watchOptions);
    const ready = new Promise<void>((resolve) => watcher.once('ready', resolve));
    const repo: RepoWatch = { gitDir, watcher, workingDirs: new Set(), ready };

    watcher.on('all', (eventType: string) => {
      if (eventType !== 'change' && eventType !== 'add') return;
      void this.handleHeadChange(repo);
    });

    return repo;
  }

  private async handleHeadChange(repo: RepoWatch): Promise<void> {
    const branch = await readHeadBranch(repo.gitDir);
    if (!branch || branch === repo.lastBranch) return;
    repo.lastBranch = branch;

    for (const workingDir of repo.workingDirs) {
      this.wsClient.send({
        type: 'WORKTREE_BRANCH_CHANGED_EVENT',
        payload: { workingDir, branch },
      });
    }
  }

  async closeAll(): Promise<void> {
    const closes = [...this.reposByGitDir.values()].map((r) => r.watcher.close());
    await Promise.all(closes);
    this.reposByGitDir.clear();
    this.sessions.clear();
    this.pending.clear();
  }
}
