import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import { BranchWatcher } from './branch-watch.js';
import type { WsClient } from '../ws/client.js';

const execFileAsync = promisify(execFile);

function createMockWsClient() {
  const sent: unknown[] = [];
  return {
    send: vi.fn((msg: unknown) => sent.push(msg)),
    sent,
  } as unknown as WsClient & { sent: unknown[] };
}

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await git.raw(['commit', '--allow-empty', '-m', 'initial']);
  return dir;
}

// `after` is the message count already sent before the action under test —
// registering a session now reports its branch, so waiting for "any message"
// would return before the change under test lands.
function waitForBranchChange(
  wsClient: WsClient & { sent: unknown[] },
  after = 0,
  timeout = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (wsClient.sent.length > after) return resolve();
      if (Date.now() - start > timeout)
        return reject(new Error('Timeout waiting for branch change'));
      setTimeout(check, 50);
    };
    check();
  });
}

describe('BranchWatcher', { retry: 2 }, () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should push WORKTREE_BRANCH_CHANGED_EVENT with the new branch on git checkout -b', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-test-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);

    // Registering already reported the starting branch; the checkout is the
    // change under test.
    const seeded = wsClient.sent.length;
    await simpleGit(repoDir).checkoutLocalBranch('feature-x');

    await waitForBranchChange(wsClient, seeded);

    expect(wsClient.sent.length).toBe(seeded + 1);
    const msg = wsClient.sent[wsClient.sent.length - 1] as {
      type: string;
      payload: { workingDir: string; branch: string };
    };
    expect(msg.type).toBe('WORKTREE_BRANCH_CHANGED_EVENT');
    expect(msg.payload.workingDir).toBe(repoDir);
    expect(msg.payload.branch).toBe('feature-x');

    await watcher.closeAll();
  }, 15_000);

  it('should resolve a plain-repo .git directory', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-plain-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);

    await simpleGit(repoDir).checkoutLocalBranch('plain-branch');
    await waitForBranchChange(wsClient);

    expect(wsClient.sent.length).toBeGreaterThan(0);
    await watcher.closeAll();
  }, 15_000);

  it('should resolve a worktree .git file (gitdir: <path>) as well as a plain repo', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-main-');
    cleanupDirs.push(repoDir);
    const worktreeDir = join(tmpdir(), `engy-branch-watch-wt-${Date.now()}`);
    cleanupDirs.push(worktreeDir);

    await execFileAsync('git', ['-C', repoDir, 'worktree', 'add', '-b', 'wt-branch', worktreeDir]);

    const wsClient = createMockWsClient();
    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', worktreeDir);

    const seeded = wsClient.sent.length;
    await simpleGit(worktreeDir).checkoutLocalBranch('wt-branch-2');
    await waitForBranchChange(wsClient, seeded);

    expect(wsClient.sent.length).toBe(seeded + 1);
    const msg = wsClient.sent[wsClient.sent.length - 1] as {
      payload: { workingDir: string; branch: string };
    };
    expect(msg.payload.workingDir).toBe(worktreeDir);
    expect(msg.payload.branch).toBe('wt-branch-2');

    await watcher.closeAll();
  }, 15_000);

  it('should NOT fire when a commit does not move the branch', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-commit-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);

    const seeded = wsClient.sent.length;
    await simpleGit(repoDir).raw(['commit', '--allow-empty', '-m', 'second commit']);
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(seeded);

    await watcher.closeAll();
  }, 15_000);

  it('should watch once and fan out to every session sharing a working directory', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-shared-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);
    await watcher.watch('session-2', repoDir);

    const seeded = wsClient.sent.length;
    await simpleGit(repoDir).checkoutLocalBranch('shared-branch');
    await waitForBranchChange(wsClient, seeded);

    // One chokidar watch on the shared repo means one message per distinct
    // workingDir, not one per registered session.
    expect(wsClient.sent.length).toBe(seeded + 1);

    await watcher.closeAll();
  }, 15_000);

  it('should stop watching a repo once every registered session unwatches it', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-unwatch-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);
    watcher.unwatch('session-1');
    const seeded = wsClient.sent.length;

    await simpleGit(repoDir).checkoutLocalBranch('after-unwatch');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(seeded);

    await watcher.closeAll();
  }, 15_000);

  it('should report the current branch as soon as a session registers', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-seed-');
    cleanupDirs.push(repoDir);
    await simpleGit(repoDir).checkoutLocalBranch('already-here');
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    await watcher.watch('session-1', repoDir);

    // No checkout happens after registering — the branch must still be known.
    expect(wsClient.sent).toEqual([
      {
        type: 'WORKTREE_BRANCH_CHANGED_EVENT',
        payload: { workingDir: repoDir, branch: 'already-here' },
      },
    ]);

    await watcher.closeAll();
  }, 15_000);

  it('should not leave a watch behind when unwatch races an in-flight watch', async () => {
    const repoDir = await createTempRepo('engy-branch-watch-race-');
    cleanupDirs.push(repoDir);
    const wsClient = createMockWsClient();

    const watcher = new BranchWatcher(wsClient, { usePolling: true, pollingInterval: 100 });
    const pending = watcher.watch('session-1', repoDir);
    watcher.unwatch('session-1');
    await pending;

    await simpleGit(repoDir).checkoutLocalBranch('after-race');
    await new Promise((r) => setTimeout(r, 500));

    expect(wsClient.sent.length).toBe(0);

    await watcher.closeAll();
  }, 15_000);
});
