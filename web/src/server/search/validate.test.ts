import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { getDb } from '../db/client';
import { appRouter } from '../trpc/root';
import { permanentMemories, fleetingMemories, workspaces } from '../db/schema';
import { validateWorkspace } from './validate';

type WorkspaceRow = typeof workspaces.$inferSelect;

describe('validateWorkspace', () => {
  let ctx: TestContext;
  let ws: WorkspaceRow;
  let wsDir: string;

  beforeEach(async () => {
    ctx = setupTestDb();
    const caller = appRouter.createCaller({ state: ctx.state });
    const created = await caller.workspace.create({ name: 'Validate Test' });
    const db = getDb();
    ws = db.select().from(workspaces).where(eq(workspaces.slug, created.slug)).get()!;
    wsDir = path.join(ctx.tmpDir, ws.slug);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function writeFile(relPath: string, content: string): void {
    const abs = path.join(wsDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  describe('broken-link detection', () => {
    it('should emit an error finding when linkedMemories points to a missing file', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'decision',
          title: 'Has Broken Link',
          content: 'body',
          filePath: 'memory/decisions/has-link.md',
          linkedMemories: ['memory/decisions/nonexistent.md'],
        })
        .run();
      writeFile('memory/decisions/has-link.md', '---\ntitle: Has Broken Link\nsubtype: decision\n---\n');

      const report = await validateWorkspace(ws);

      const brokenLinks = report.findings.filter((f) => f.check === 'broken-links');
      expect(brokenLinks.length).toBeGreaterThan(0);
      expect(brokenLinks[0].severity).toBe('error');
      expect(brokenLinks[0].message).toContain('nonexistent.md');
    });

    it('should emit a warning when a source reference file is missing', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Sourced',
          content: 'body',
          filePath: 'memory/facts/sourced.md',
          sources: ['memory/sources/missing-source.md'],
        })
        .run();
      writeFile('memory/facts/sourced.md', '---\ntitle: Sourced\nsubtype: fact\n---\n');

      const report = await validateWorkspace(ws);

      const sourceWarnings = report.findings.filter(
        (f) => f.check === 'broken-links' && f.severity === 'warning',
      );
      expect(sourceWarnings.length).toBeGreaterThan(0);
      expect(sourceWarnings[0].message).toContain('missing-source.md');
    });

    it('should produce no broken-link findings when all links are valid', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'pattern',
          title: 'Valid Links',
          content: 'body',
          filePath: 'memory/patterns/valid.md',
          linkedMemories: ['memory/patterns/target.md'],
        })
        .run();
      writeFile('memory/patterns/valid.md', '---\ntitle: Valid Links\nsubtype: pattern\n---\n');
      writeFile('memory/patterns/target.md', '---\ntitle: Target\nsubtype: pattern\n---\n');

      const report = await validateWorkspace(ws);

      const brokenLinks = report.findings.filter((f) => f.check === 'broken-links');
      expect(brokenLinks).toHaveLength(0);
    });
  });

  describe('schema-compliance lint', () => {
    it('should warn when a memory file in a subtype dir is missing the title frontmatter field', async () => {
      writeFile(
        'memory/decisions/202501010001-no-title.md',
        '---\nsubtype: decision\n---\n\nNo title here.\n',
      );

      // Directly insert frontmatter row to simulate the indexer.
      const { frontmatter } = await import('../db/schema');
      const db = getDb();
      db.insert(frontmatter)
        .values({
          workspaceId: ws.id,
          collection: 'memory',
          path: 'memory/decisions/202501010001-no-title.md',
          data: JSON.stringify({ subtype: 'decision' }),
          indexedAt: new Date().toISOString(),
        })
        .run();

      const report = await validateWorkspace(ws);

      const schemaIssues = report.findings.filter((f) => f.check === 'schema-compliance');
      expect(schemaIssues.length).toBeGreaterThan(0);
      expect(schemaIssues.some((f) => f.message.includes('title'))).toBe(true);
    });

    it('should warn when a memory file is missing the subtype frontmatter field', async () => {
      const { frontmatter } = await import('../db/schema');
      const db = getDb();
      writeFile(
        'memory/patterns/202501010002-no-subtype.md',
        '---\ntitle: No Subtype\n---\n\nMissing subtype field.\n',
      );
      db.insert(frontmatter)
        .values({
          workspaceId: ws.id,
          collection: 'memory',
          path: 'memory/patterns/202501010002-no-subtype.md',
          data: JSON.stringify({ title: 'No Subtype' }),
          indexedAt: new Date().toISOString(),
        })
        .run();

      const report = await validateWorkspace(ws);

      const schemaIssues = report.findings.filter((f) => f.check === 'schema-compliance');
      expect(schemaIssues.some((f) => f.message.includes('subtype'))).toBe(true);
    });

    it('should produce no schema-compliance findings for non-subtype paths like sources/', async () => {
      const { frontmatter } = await import('../db/schema');
      const db = getDb();
      writeFile(
        'memory/sources/some-source.md',
        '---\ntitle: Source Doc\n---\n\nContent.\n',
      );
      db.insert(frontmatter)
        .values({
          workspaceId: ws.id,
          collection: 'memory',
          path: 'memory/sources/some-source.md',
          data: JSON.stringify({ title: 'Source Doc' }),
          indexedAt: new Date().toISOString(),
        })
        .run();

      const report = await validateWorkspace(ws);

      const schemaIssues = report.findings.filter((f) => f.check === 'schema-compliance');
      expect(schemaIssues).toHaveLength(0);
    });
  });

  describe('missing-sources lint', () => {
    it('should warn when a subtype memory has an empty sources array', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'decision',
          title: 'No Sources',
          content: 'body',
          filePath: 'memory/decisions/no-sources.md',
          sources: [],
        })
        .run();

      const report = await validateWorkspace(ws);

      const findings = report.findings.filter((f) => f.check === 'missing-sources');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].path).toBe('memory/decisions/no-sources.md');
    });

    it('should not warn when a subtype memory has at least one source', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'decision',
          title: 'Has Source',
          content: 'body',
          filePath: 'memory/decisions/has-source.md',
          sources: ['memory/sources/some-source.md'],
        })
        .run();
      writeFile('memory/decisions/has-source.md', '---\ntitle: Has Source\nsubtype: decision\n---\n');
      writeFile('memory/sources/some-source.md', '---\ntitle: Some Source\n---\n');

      const report = await validateWorkspace(ws);

      const findings = report.findings.filter((f) => f.check === 'missing-sources');
      expect(findings).toHaveLength(0);
    });

    it('should warn when sources field is omitted entirely (defaults to empty array)', async () => {
      // The permanentMemories schema enforces subtype NOT NULL (default 'fact'), so
      // every permanent memory is a Zettelkasten zettel. This test verifies that a
      // memory with no sources specified (relying on the column default []) still triggers
      // the traceability warning.
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'convention',
          title: 'No Sources Omitted',
          content: 'body',
          filePath: 'memory/conventions/omitted-sources.md',
          // sources intentionally omitted — defaults to []
        })
        .run();

      const report = await validateWorkspace(ws);

      const findings = report.findings.filter(
        (f) => f.check === 'missing-sources' && f.path === 'memory/conventions/omitted-sources.md',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
    });
  });

  describe('commit-message lint', () => {
    it('should warn when a memory file was committed with a non-conformant message', async () => {
      // Initialize a git repo in the workspace directory.
      const gitDir = wsDir;
      fs.mkdirSync(path.join(gitDir, 'memory', 'decisions'), { recursive: true });
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });

      const memFile = 'memory/decisions/conformance.md';
      writeFile(memFile, '---\ntitle: Conformance\nsubtype: decision\n---\n');
      execFileSync('git', ['add', memFile], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'chore: foo (non-conformant)'], { cwd: gitDir });

      const report = await validateWorkspace(ws);

      const commitIssues = report.findings.filter(
        (f) => f.check === 'commit-message-conformance' && f.severity === 'warning',
      );
      expect(commitIssues.length).toBeGreaterThan(0);
      expect(commitIssues[0].message).toContain('chore: foo');
    });

    it('should produce no warning for a conformant memory(<op>): commit message', async () => {
      const gitDir = wsDir;
      // workspace.create() calls ensureGitRepo which may have already initialised a git repo
      // with a non-conformant "Initial workspace structure" commit. Remove it so the only
      // commit in the log is the conformant one we create below.
      fs.rmSync(path.join(gitDir, '.git'), { recursive: true, force: true });
      fs.mkdirSync(path.join(gitDir, 'memory', 'patterns'), { recursive: true });
      execFileSync('git', ['init'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });

      const memFile = 'memory/patterns/good-commit.md';
      writeFile(memFile, '---\ntitle: Good Commit\nsubtype: pattern\n---\n');
      execFileSync('git', ['add', memFile], { cwd: gitDir });
      execFileSync('git', ['commit', '-m', 'memory(add): good commit message'], { cwd: gitDir });

      const report = await validateWorkspace(ws);

      const commitWarnings = report.findings.filter(
        (f) => f.check === 'commit-message-conformance' && f.severity === 'warning',
      );
      expect(commitWarnings).toHaveLength(0);
    });

    it('should emit an info finding when workspace dir is not a git repo', async () => {
      // workspace.create() calls ensureGitRepo which may have already initialised a git repo.
      // Remove .git so validate sees a plain directory and emits the info finding.
      fs.rmSync(path.join(wsDir, '.git'), { recursive: true, force: true });
      const report = await validateWorkspace(ws);

      const infoFindings = report.findings.filter(
        (f) => f.check === 'commit-message-conformance' && f.severity === 'info',
      );
      expect(infoFindings.length).toBeGreaterThan(0);
    });
  });

  describe('orphaned content (both directions)', () => {
    it('should emit an error when a DB row has no file on disk (DB→file)', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Orphan DB Row',
          content: 'body',
          filePath: 'memory/facts/missing-on-disk.md',
        })
        .run();

      const report = await validateWorkspace(ws);

      const orphans = report.findings.filter(
        (f) => f.check === 'orphaned-content' && f.severity === 'error',
      );
      expect(orphans.length).toBeGreaterThan(0);
      expect(orphans[0].path).toBe('memory/facts/missing-on-disk.md');
    });

    it('should emit a warning when a file on disk has no DB row (file→DB)', async () => {
      writeFile(
        'memory/decisions/untracked.md',
        '---\ntitle: Untracked\nsubtype: decision\n---\n',
      );

      const report = await validateWorkspace(ws);

      const fileOrphans = report.findings.filter(
        (f) => f.check === 'orphaned-content' && f.severity === 'warning',
      );
      expect(fileOrphans.length).toBeGreaterThan(0);
      // workspace init seeds README.md files so there may be other orphan warnings;
      // verify the test's target file is among them.
      expect(fileOrphans.some((f) => f.message.includes('memory/decisions/untracked.md'))).toBe(true);
    });

    it('should produce no orphaned-content findings when DB and disk are in sync', async () => {
      const db = getDb();
      const relPath = 'memory/insights/synced.md';
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'insight',
          title: 'Synced',
          content: 'body',
          filePath: relPath,
        })
        .run();
      writeFile(relPath, '---\ntitle: Synced\nsubtype: insight\n---\n');

      const report = await validateWorkspace(ws);

      // workspace init seeds README.md files in each subtype dir; exclude them since
      // they are infrastructure files, not user-created memories.
      const orphans = report.findings.filter(
        (f) => f.check === 'orphaned-content' && !f.path?.endsWith('README.md'),
      );
      expect(orphans).toHaveLength(0);
    });
  });

  describe('lifecycle consistency', () => {
    it('should warn when a promoted fleeting memory has no promotedFromId', async () => {
      const db = getDb();
      db.insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'A learning',
          type: 'capture',
          source: 'agent',
          promoted: true,
        })
        .run();

      const report = await validateWorkspace(ws);

      const lcIssues = report.findings.filter((f) => f.check === 'lifecycle-consistency');
      expect(lcIssues.length).toBeGreaterThan(0);
      expect(lcIssues[0].severity).toBe('warning');
      expect(lcIssues[0].message).toContain('promotedFromId');
    });

    it.skip('should error when promotedFromId points to a missing permanentMemory', async () => {
      // This scenario is unreachable under the current schema: the FK constraint on
      // fleetingMemories.promotedFromId → permanentMemories.id (with onDelete: 'set null')
      // prevents inserting a row with a promotedFromId that references a non-existent
      // permanentMemory. SQLite raises "FOREIGN KEY constraint failed" before the row
      // is written, so the validate check for a dangling promotedFromId can never fire
      // in practice. If the schema changes to allow deferred FK checks this test should
      // be re-enabled.
    });

    it('should produce no lifecycle findings when promoted fleeting maps to an existing permanent', async () => {
      const db = getDb();
      const permanent = db
        .insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Real Memory',
          content: 'body',
          filePath: 'memory/facts/real.md',
        })
        .returning()
        .get();
      writeFile('memory/facts/real.md', '---\ntitle: Real Memory\nsubtype: fact\n---\n');

      db.insert(fleetingMemories)
        .values({
          workspaceId: ws.id,
          content: 'Properly promoted',
          type: 'capture',
          source: 'agent',
          promoted: true,
          promotedFromId: permanent.id,
        })
        .run();

      const report = await validateWorkspace(ws);

      const lcIssues = report.findings.filter((f) => f.check === 'lifecycle-consistency');
      expect(lcIssues).toHaveLength(0);
    });
  });

  describe('duplicate IDs', () => {
    it('should emit an error when two permanentMemories share the same filePath', async () => {
      const db = getDb();
      const sharedPath = 'memory/facts/shared.md';
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'First',
          content: 'body',
          filePath: sharedPath,
        })
        .run();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Second',
          content: 'body',
          filePath: sharedPath,
        })
        .run();
      writeFile(sharedPath, '---\ntitle: First\nsubtype: fact\n---\n');

      const report = await validateWorkspace(ws);

      const dupErrors = report.findings.filter((f) => f.check === 'duplicate-ids');
      expect(dupErrors.length).toBeGreaterThan(0);
      expect(dupErrors[0].severity).toBe('error');
    });

    it('should produce no duplicate-ids findings for unique paths', async () => {
      const db = getDb();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Unique A',
          content: 'body',
          filePath: 'memory/facts/unique-a.md',
        })
        .run();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Unique B',
          content: 'body',
          filePath: 'memory/facts/unique-b.md',
        })
        .run();
      writeFile('memory/facts/unique-a.md', '---\ntitle: Unique A\nsubtype: fact\n---\n');
      writeFile('memory/facts/unique-b.md', '---\ntitle: Unique B\nsubtype: fact\n---\n');

      const report = await validateWorkspace(ws);

      const dupErrors = report.findings.filter((f) => f.check === 'duplicate-ids');
      expect(dupErrors).toHaveLength(0);
    });
  });

  describe('stale memory detection', () => {
    it('should warn when a memory has not been updated in more than 180 days', async () => {
      const db = getDb();
      const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Old Memory',
          content: 'body',
          filePath: 'memory/facts/old.md',
          updatedAt: staleDate,
        })
        .run();

      const report = await validateWorkspace(ws);

      const staleWarnings = report.findings.filter((f) => f.check === 'stale-memory');
      expect(staleWarnings.length).toBeGreaterThan(0);
      expect(staleWarnings[0].severity).toBe('warning');
      expect(staleWarnings[0].message).toContain('200');
      expect(staleWarnings[0].path).toBe('memory/facts/old.md');
    });

    it('should produce no stale-memory warning for a recently updated memory', async () => {
      const db = getDb();
      const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Fresh Memory',
          content: 'body',
          filePath: 'memory/facts/fresh.md',
          updatedAt: recentDate,
        })
        .run();

      const report = await validateWorkspace(ws);

      const staleWarnings = report.findings.filter((f) => f.check === 'stale-memory');
      expect(staleWarnings).toHaveLength(0);
    });
  });

  describe('summary counts', () => {
    it('should tally findings into the summary object correctly', async () => {
      const db = getDb();
      // Produce one error: orphaned DB row.
      db.insert(permanentMemories)
        .values({
          workspaceId: ws.id,
          subtype: 'fact',
          title: 'Missing File',
          content: 'body',
          filePath: 'memory/facts/gone.md',
        })
        .run();

      const report = await validateWorkspace(ws);

      expect(report.summary.errors).toBeGreaterThan(0);
      expect(report.summary.total).toBe(report.findings.length);
      expect(report.summary.errors + report.summary.warnings + report.summary.infos).toBe(
        report.summary.total,
      );
    });
  });
});
