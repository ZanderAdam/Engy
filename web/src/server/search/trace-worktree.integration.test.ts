// @rtm-ignore — plants example [FR-WT-001] tags as fixtures in a throwaway repo
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTraceabilityMatrix } from '../lib/requirements';

// ── Git availability check ────────────────────────────────────────────

function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── Disposable repo helpers ───────────────────────────────────────────

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function writeFile(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
}

// ── Test setup ────────────────────────────────────────────────────────

let baseRepoDir: string;
let worktreeDir: string;
let featuresDir: string;

beforeAll(() => {
  if (!isGitAvailable()) return;

  // Create a fresh throwaway repo in a temp dir — never touches the live repo.
  baseRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-trace-wt-base-'));
  worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-trace-wt-'));
  // featuresDir is a separate temp dir (simulates server-owned ENGY_DIR docs)
  featuresDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-trace-wt-features-'));

  // Initialise base repo with a minimal first commit.
  git(['init'], baseRepoDir);
  git(['config', 'user.email', 'test@example.com'], baseRepoDir);
  git(['config', 'user.name', 'Test'], baseRepoDir);
  writeFile(path.join(baseRepoDir, '.gitkeep'), '');
  git(['add', '.gitkeep'], baseRepoDir);
  git(['commit', '-m', 'chore: init'], baseRepoDir);

  // Add a linked worktree on a new branch.
  git(['worktree', 'add', worktreeDir, '-b', 'test/trace-e2e'], baseRepoDir);

  // Plant src/worktree.ts + tagged test file in the worktree.
  writeFile(
    path.join(worktreeDir, 'src', 'worktree.ts'),
    `export function worktreeFeature() { return true; }\n`,
  );
  writeFile(
    path.join(worktreeDir, 'src', 'worktree.test.ts'),
    `it('[FR-WT-001] worktree feature is active', () => { expect(worktreeFeature()).toBe(true); });\n`,
  );

  // Plant an UNSTAGED new test file to prove the local-fs adapter sees untracked files.
  writeFile(
    path.join(worktreeDir, 'src', 'unstaged.test.ts'),
    `it('[FR-WT-001] unstaged new test also tags the FR', () => {});\n`,
  );

  // Feature docs in a separate temp dir (server-owned ENGY_DIR, read sync).
  const areaFeaturesDir = path.join(featuresDir, 'system', 'features');
  writeFile(
    path.join(areaFeaturesDir, 'worktree.md'),
    `---
title: Worktree
---

# Worktree

## Requirements

| ID | Requirement (EARS) |
|----|--------------------|
| FR-WT-001 | The system SHALL activate the worktree feature. |
| FR-WT-002 | The system SHALL deactivate the worktree feature. |
`,
  );
});

afterAll(() => {
  if (!isGitAvailable()) return;

  try {
    if (worktreeDir) {
      git(['worktree', 'remove', '--force', worktreeDir], baseRepoDir);
    }
  } catch {
    // ignore — cleanup best-effort
  }
  try {
    if (baseRepoDir) {
      git(['branch', '-D', 'test/trace-e2e'], baseRepoDir);
    }
  } catch {
    // ignore
  }
  try {
    if (baseRepoDir) fs.rmSync(baseRepoDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    if (featuresDir) fs.rmSync(featuresDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  // worktreeDir is inside baseRepoDir's worktree list; rmSync after worktree remove.
  try {
    if (worktreeDir) fs.rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('buildTraceabilityMatrix with git worktree (local-fs adapter)', () => {
  it('should skip when git is unavailable', () => {
    if (isGitAvailable()) return;
    console.warn('Skipping worktree integration test — git not found in PATH');
    expect(true).toBe(true);
  });

  it('should resolve FR-WT-001 to src/worktree.test.ts without the source-repo root in the path', async () => {
    if (!isGitAvailable()) return;

    const matrix = await buildTraceabilityMatrix({
      featureDirs: [path.join(featuresDir, 'system', 'features')],
      codeRoots: [worktreeDir],
      relativeTo: worktreeDir,
    });

    const covered = matrix.entries.find((e) => e.fr.id === 'FR-WT-001');
    expect(covered).toBeDefined();
    expect(covered!.tests.length).toBeGreaterThanOrEqual(1);

    // Display paths must NOT contain the base repo root — they must be relative to worktreeDir.
    const testFiles = covered!.tests.map((t) => t.testFile);
    for (const p of testFiles) {
      expect(p).not.toContain(baseRepoDir);
    }
    expect(testFiles).toContain('src/worktree.test.ts');
  });

  it('should leave FR-WT-002 uncovered', async () => {
    if (!isGitAvailable()) return;

    const matrix = await buildTraceabilityMatrix({
      featureDirs: [path.join(featuresDir, 'system', 'features')],
      codeRoots: [worktreeDir],
      relativeTo: worktreeDir,
    });

    expect(matrix.uncovered).toContain('FR-WT-002');
  });

  it('should report no orphan tags', async () => {
    if (!isGitAvailable()) return;

    const matrix = await buildTraceabilityMatrix({
      featureDirs: [path.join(featuresDir, 'system', 'features')],
      codeRoots: [worktreeDir],
      relativeTo: worktreeDir,
    });

    expect(matrix.orphanTags).toEqual([]);
  });

  it('should see the unstaged new test file via local-fs adapter', async () => {
    if (!isGitAvailable()) return;

    const matrix = await buildTraceabilityMatrix({
      featureDirs: [path.join(featuresDir, 'system', 'features')],
      codeRoots: [worktreeDir],
      relativeTo: worktreeDir,
    });

    const covered = matrix.entries.find((e) => e.fr.id === 'FR-WT-001');
    expect(covered).toBeDefined();
    // Both src/worktree.test.ts (committed) and src/unstaged.test.ts (untracked) should appear.
    const testFiles = covered!.tests.map((t) => t.testFile);
    expect(testFiles).toContain('src/worktree.test.ts');
    expect(testFiles).toContain('src/unstaged.test.ts');
  });
});
