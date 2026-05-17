import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  branchToPathSegment,
  getProjectWorktreeDir,
  effectiveDocsDirForBranch,
} from './init';
import type { AppState } from '../trpc/context';

function makeFakeState(repoMap: Map<string, string[]>): AppState {
  // repoMap: repo absolute path → list of "branch:worktreePath" strings ("main:<path>" for main)
  const pending = new Map<
    string,
    {
      resolve: (value: {
        worktrees: { path: string; branch: string | null; isMain: boolean; isLocked: boolean }[];
      }) => void;
      reject: (err: Error) => void;
    }
  >();

  const state = {
    pendingGitWorktreeList: pending,
    daemon: {
      readyState: 1,
      OPEN: 1,
      send(raw: string) {
        const msg = JSON.parse(raw) as { type: string; payload: { requestId: string; repoDir: string } };
        if (msg.type !== 'GIT_WORKTREE_LIST_REQUEST') return;
        const { requestId, repoDir } = msg.payload;
        const entries = repoMap.get(repoDir);
        queueMicrotask(() => {
          const pendingEntry = pending.get(requestId);
          if (!pendingEntry) return;
          pending.delete(requestId);
          if (!entries) {
            pendingEntry.reject(new Error(`No fake worktree list for ${repoDir}`));
            return;
          }
          const worktrees = entries.map((entry) => {
            if (entry.startsWith('main:')) {
              return { path: entry.slice(5), branch: 'main', isMain: true, isLocked: false };
            }
            const [branch, ...rest] = entry.split(':');
            return { path: rest.join(':'), branch, isMain: false, isLocked: false };
          });
          pendingEntry.resolve({ worktrees });
        });
      },
    },
  } as unknown as AppState;
  return state;
}

describe('init helpers', () => {
  describe('branchToPathSegment', () => {
    it('passes through simple branch names unchanged', () => {
      expect(branchToPathSegment('feat-x')).toBe('feat-x');
    });

    it('replaces slashes with dashes', () => {
      expect(branchToPathSegment('feat/x')).toBe('feat-x');
      expect(branchToPathSegment('user/aleks/feat')).toBe('user-aleks-feat');
    });

    it('rejects branches with unsafe characters', () => {
      expect(() => branchToPathSegment('feat$x')).toThrow(/Invalid branch name/);
      expect(() => branchToPathSegment('feat x')).toThrow(/Invalid branch name/);
      expect(() => branchToPathSegment('')).toThrow(/Invalid branch name/);
    });
  });

  describe('getProjectWorktreeDir', () => {
    const workspace = { slug: 'ws', docsDir: '/tmp/engy-ws' };

    it('builds a path under <workspaceDir>/worktrees/<project>/<branch>/<repoBasename>', () => {
      const p = getProjectWorktreeDir(workspace, 'proj', 'feat-x', '/path/to/myrepo');
      expect(p).toBe('/tmp/engy-ws/worktrees/proj/feat-x/myrepo');
    });

    it('normalizes branch slashes', () => {
      const p = getProjectWorktreeDir(workspace, 'proj', 'feat/x', '/path/to/myrepo');
      expect(p).toBe('/tmp/engy-ws/worktrees/proj/feat-x/myrepo');
    });

    it('rejects invalid project slug', () => {
      expect(() => getProjectWorktreeDir(workspace, '../bad', 'feat', '/r')).toThrow();
    });

    it('rejects unsafe branch', () => {
      expect(() => getProjectWorktreeDir(workspace, 'proj', 'bad branch', '/r')).toThrow();
    });
  });

  describe('effectiveDocsDirForBranch', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-effective-docs-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns docsDir unchanged when docsDir is outside all repos', async () => {
      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(repoDir);
      await simpleGit(repoDir).init();
      const docsDir = path.join(tmpDir, 'outside-docs');
      const state = makeFakeState(new Map());
      const result = await effectiveDocsDirForBranch(
        { slug: 'ws', docsDir, repos: [repoDir] },
        'feat-x',
        state,
      );
      expect(result).toBe(docsDir);
    });

    it('re-roots docsDir when it sits inside a worktree-materialized repo', async () => {
      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(repoDir);
      const docsDir = path.join(repoDir, 'docs', 'projects');
      fs.mkdirSync(docsDir, { recursive: true });

      const worktreePath = path.join(tmpDir, 'wt');
      const state = makeFakeState(
        new Map([[repoDir, [`main:${repoDir}`, `feat-x:${worktreePath}`]]]),
      );

      const result = await effectiveDocsDirForBranch(
        { slug: 'ws', docsDir, repos: [repoDir] },
        'feat-x',
        state,
      );
      expect(result).toBe(path.join(worktreePath, 'docs', 'projects'));
    });

    it('falls back to docsDir when docsDir is in a repo without a matching worktree', async () => {
      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(repoDir);
      const docsDir = path.join(repoDir, 'docs');
      fs.mkdirSync(docsDir);

      const state = makeFakeState(new Map([[repoDir, [`main:${repoDir}`]]]));
      const result = await effectiveDocsDirForBranch(
        { slug: 'ws', docsDir, repos: [repoDir] },
        'feat-x',
        state,
      );
      expect(result).toBe(docsDir);
    });

    it('returns docsDir when daemon errors (graceful degradation)', async () => {
      const repoDir = path.join(tmpDir, 'repo');
      fs.mkdirSync(repoDir);
      const docsDir = path.join(repoDir, 'docs');
      fs.mkdirSync(docsDir);

      // Empty repoMap → daemon stub rejects.
      const state = makeFakeState(new Map());
      const result = await effectiveDocsDirForBranch(
        { slug: 'ws', docsDir, repos: [repoDir] },
        'feat-x',
        state,
      );
      expect(result).toBe(docsDir);
    });
  });
});
