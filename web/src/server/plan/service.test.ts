import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  milestoneFilename,
  writePlanFile,
  readPlanFile,
  listPlanFiles,
  deletePlanFile,
  renamePlanFile,
  titleFromFilename,
  readTaskPlan,
  findTaskPlanPath,
  buildMilestoneFrontmatter,
  listMilestones,
  planFileExists,
} from './service';

const VALID_STATUSES = ['planned', 'planning', 'active', 'complete'] as const;

describe('plan service', () => {
  let tmpDir: string;
  let specsDir: string;
  const specSlug = '1_auth';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-plan-test-'));
    specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(path.join(specsDir, specSlug), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('milestoneFilename', () => {
    it('should generate filename from sortOrder and title', () => {
      expect(milestoneFilename(0, 'Setup')).toBe('m1-setup.plan.md');
    });

    it('should slugify title with hyphens', () => {
      expect(milestoneFilename(1, 'Auth & Permissions')).toBe('m2-auth-permissions.plan.md');
    });

    it('should handle sortOrder correctly (sortOrder + 1)', () => {
      expect(milestoneFilename(2, 'Payments')).toBe('m3-payments.plan.md');
    });

    it('should collapse consecutive hyphens', () => {
      expect(milestoneFilename(0, 'Hello---World')).toBe('m1-hello-world.plan.md');
    });

    it('should strip leading and trailing hyphens from slug', () => {
      expect(milestoneFilename(0, '--Leading Trailing--')).toBe('m1-leading-trailing.plan.md');
    });
  });

  describe('writePlanFile', () => {
    it('should write a plan file in the spec directory', () => {
      const filename = 'm1-setup.plan.md';
      writePlanFile(specsDir, specSlug, filename, '# Setup Plan');

      const filePath = path.join(specsDir, specSlug, filename);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Setup Plan');
    });

    it('should overwrite existing file', () => {
      const filename = 'm1-setup.plan.md';
      writePlanFile(specsDir, specSlug, filename, 'V1');
      writePlanFile(specsDir, specSlug, filename, 'V2');

      const filePath = path.join(specsDir, specSlug, filename);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('V2');
    });

    it('[FR-MILESTONE-090] should reject path traversal in specSlug', () => {
      expect(() => writePlanFile(specsDir, '../../../etc', 'm1-x.plan.md', 'x')).toThrow(
        'Path traversal',
      );
    });

    it('[FR-MILESTONE-090] should reject path traversal in filename', () => {
      expect(() => writePlanFile(specsDir, specSlug, '../../outside.md', 'x')).toThrow(
        'Path traversal',
      );
    });
  });

  describe('readPlanFile', () => {
    it('should return file contents', () => {
      const filename = 'm1-setup.plan.md';
      writePlanFile(specsDir, specSlug, filename, '# Plan content');

      expect(readPlanFile(specsDir, specSlug, filename)).toBe('# Plan content');
    });

    it('should return null for non-existent file', () => {
      expect(readPlanFile(specsDir, specSlug, 'm1-missing.plan.md')).toBeNull();
    });

    it('[FR-MILESTONE-090] should reject path traversal in specSlug', () => {
      expect(() => readPlanFile(specsDir, '../../etc', 'm1-x.plan.md')).toThrow(
        'Path traversal',
      );
    });

    it('[FR-MILESTONE-090] should reject path traversal in filename', () => {
      expect(() => readPlanFile(specsDir, specSlug, '../../etc/passwd')).toThrow(
        'Path traversal',
      );
    });
  });

  describe('listPlanFiles', () => {
    it('should return empty array when no plan files exist', () => {
      expect(listPlanFiles(specsDir, specSlug)).toEqual([]);
    });

    it('should return sorted list of .plan.md files', () => {
      writePlanFile(specsDir, specSlug, 'm2-auth.plan.md', 'Auth');
      writePlanFile(specsDir, specSlug, 'm1-setup.plan.md', 'Setup');
      // Write a non-plan file to ensure it's filtered out
      fs.writeFileSync(path.join(specsDir, specSlug, 'spec.md'), 'Spec');

      expect(listPlanFiles(specsDir, specSlug)).toEqual([
        'm1-setup.plan.md',
        'm2-auth.plan.md',
      ]);
    });

    it('should return empty array when spec directory does not exist', () => {
      expect(listPlanFiles(specsDir, 'nonexistent')).toEqual([]);
    });

    it('should ignore subdirectories', () => {
      writePlanFile(specsDir, specSlug, 'm1-setup.plan.md', 'Setup');
      fs.mkdirSync(path.join(specsDir, specSlug, 'context'), { recursive: true });

      expect(listPlanFiles(specsDir, specSlug)).toEqual(['m1-setup.plan.md']);
    });
  });

  describe('deletePlanFile', () => {
    it('should delete an existing plan file', () => {
      const filename = 'm1-setup.plan.md';
      writePlanFile(specsDir, specSlug, filename, 'Content');
      deletePlanFile(specsDir, specSlug, filename);

      expect(fs.existsSync(path.join(specsDir, specSlug, filename))).toBe(false);
    });

    it('should throw for non-existent file', () => {
      expect(() => deletePlanFile(specsDir, specSlug, 'm1-missing.plan.md')).toThrow(
        'not found',
      );
    });

    it('[FR-MILESTONE-090] should reject path traversal in filename', () => {
      expect(() => deletePlanFile(specsDir, specSlug, '../../etc/passwd')).toThrow(
        'Path traversal',
      );
    });
  });

  describe('titleFromFilename', () => {
    it('should extract title from standard milestone filename', () => {
      expect(titleFromFilename('m1-foundation.plan.md')).toBe('Foundation');
    });

    it('should handle multi-word titles', () => {
      expect(titleFromFilename('m2-api-layer.plan.md')).toBe('Api Layer');
    });

    it('should handle decimal milestone numbers', () => {
      expect(titleFromFilename('m1.5-auth-setup.plan.md')).toBe('Auth Setup');
    });
  });

  describe('renamePlanFile', () => {
    it('should rename an existing plan file', () => {
      writePlanFile(specsDir, specSlug, 'm1-setup.plan.md', 'Content');
      renamePlanFile(specsDir, specSlug, 'm1-setup.plan.md', 'm1-foundation.plan.md');

      expect(fs.existsSync(path.join(specsDir, specSlug, 'm1-setup.plan.md'))).toBe(false);
      expect(fs.readFileSync(path.join(specsDir, specSlug, 'm1-foundation.plan.md'), 'utf-8')).toBe(
        'Content',
      );
    });

    it('should be a no-op when old file does not exist', () => {
      // Should not throw
      renamePlanFile(specsDir, specSlug, 'm1-old.plan.md', 'm1-new.plan.md');
    });

    it('[FR-MILESTONE-090] should reject path traversal in old filename', () => {
      expect(() =>
        renamePlanFile(specsDir, specSlug, '../../etc/passwd', 'm1-new.plan.md'),
      ).toThrow('Path traversal');
    });

    it('[FR-MILESTONE-090] should reject path traversal in new filename', () => {
      writePlanFile(specsDir, specSlug, 'm1-setup.plan.md', 'Content');
      expect(() =>
        renamePlanFile(specsDir, specSlug, 'm1-setup.plan.md', '../../etc/evil.md'),
      ).toThrow('Path traversal');
    });
  });

  describe('buildMilestoneFrontmatter', () => {
    it('should produce a round-trippable frontmatter for simple values', () => {
      const fm = buildMilestoneFrontmatter('My Milestone', 'planned', 'Backend only');
      expect(fm).toContain('title: My Milestone');
      expect(fm).toContain('status: planned');
      expect(fm).toContain('scope: Backend only');
    });

    it('should quote title containing a colon', () => {
      const fm = buildMilestoneFrontmatter('Auth: Login & Signup', 'planned');
      expect(fm).toContain('title: "Auth: Login & Signup"');
    });

    it('[FR-MILESTONE-100] should collapse multi-line scope to a single quoted line', () => {
      const fm = buildMilestoneFrontmatter('M1', 'planned', 'Line one\nLine two\nLine three');
      expect(fm).not.toContain('\n\n');
      expect(fm).toContain('scope: "Line one Line two Line three"');
    });

    it('[FR-MILESTONE-100] should round-trip through writePlanFile + listMilestones', () => {
      const filename = 'm1-test.plan.md';
      const scope = 'Multi\nline\nscope content';
      const content = buildMilestoneFrontmatter('Test Milestone', 'active', scope);
      writePlanFile(specsDir, specSlug, filename, content);

      const milestones = listMilestones(specsDir, specSlug);
      expect(milestones).toHaveLength(1);
      expect(milestones[0].title).toBe('Test Milestone');
      expect(milestones[0].status).toBe('active');
      // Newlines are collapsed to spaces on serialization
      expect(milestones[0].scope).toBe('Multi line scope content');
    });
  });

  describe('listMilestones status normalization', () => {
    it('[FR-MILESTONE-100] should normalize unknown status to "planned"', () => {
      const content = '---\ntitle: Test\nstatus: draft\n---\n';
      writePlanFile(specsDir, specSlug, 'm1-test.plan.md', content);
      const milestones = listMilestones(specsDir, specSlug);
      expect(milestones[0].status).toBe('planned');
    });

    it('[FR-MILESTONE-100] should preserve valid statuses', () => {
      for (const status of ['planned', 'planning', 'active', 'complete'] as const) {
        const content = `---\ntitle: Test\nstatus: ${status}\n---\n`;
        const filename = `m${VALID_STATUSES.indexOf(status) + 1}-test.plan.md`;
        writePlanFile(specsDir, specSlug, filename, content);
      }
      const milestones = listMilestones(specsDir, specSlug);
      expect(milestones.map((m) => m.status)).toEqual(['planned', 'planning', 'active', 'complete']);
    });

    it('[FR-MILESTONE-100] should normalize empty status to "planned"', () => {
      const content = '---\ntitle: Test\n---\n';
      writePlanFile(specsDir, specSlug, 'm1-test.plan.md', content);
      const milestones = listMilestones(specsDir, specSlug);
      expect(milestones[0].status).toBe('planned');
    });
  });

  describe('planFileExists', () => {
    it('should return false for a non-existent file', () => {
      expect(planFileExists(specsDir, specSlug, 'm1-missing.plan.md')).toBe(false);
    });

    it('should return true after writing a file', () => {
      writePlanFile(specsDir, specSlug, 'm1-exists.plan.md', 'content');
      expect(planFileExists(specsDir, specSlug, 'm1-exists.plan.md')).toBe(true);
    });
  });

  describe('readTaskPlan', () => {
    it('should return plan content when file exists', () => {
      const projectDir = path.join(tmpDir, 'project');
      const plansDir = path.join(projectDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(path.join(plansDir, 'ws-T5.plan.md'), '# My Plan');

      expect(readTaskPlan(projectDir, 'ws', 5)).toBe('# My Plan');
    });

    it('should return null when plan file does not exist', () => {
      const projectDir = path.join(tmpDir, 'project-empty');
      fs.mkdirSync(projectDir, { recursive: true });

      expect(readTaskPlan(projectDir, 'ws', 99)).toBeNull();
    });

    it('[FR-PROJECT-180] should read a plan whose filename carries a description', () => {
      const projectDir = path.join(tmpDir, 'project-described');
      const plansDir = path.join(projectDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(path.join(plansDir, 'ws-T5-add-api-routing.plan.md'), '# Routing');

      expect(readTaskPlan(projectDir, 'ws', 5)).toBe('# Routing');
      expect(findTaskPlanPath(projectDir, 'ws', 5)).toBe('plans/ws-T5-add-api-routing.plan.md');
    });

    it('[FR-PROJECT-180] should not confuse a task id with a longer id sharing its prefix', () => {
      const projectDir = path.join(tmpDir, 'project-prefix');
      const plansDir = path.join(projectDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(path.join(plansDir, 'ws-T50-other-task.plan.md'), '# Other');

      expect(findTaskPlanPath(projectDir, 'ws', 5)).toBeNull();
    });

    it('[FR-PROJECT-180] should pick the most recently written plan when several match', () => {
      const projectDir = path.join(tmpDir, 'project-dupes');
      const plansDir = path.join(projectDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      const stale = path.join(plansDir, 'ws-T5-old-name.plan.md');
      fs.writeFileSync(stale, '# Stale');
      fs.utimesSync(stale, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
      fs.writeFileSync(path.join(plansDir, 'ws-T5-new-name.plan.md'), '# Fresh');

      expect(readTaskPlan(projectDir, 'ws', 5)).toBe('# Fresh');
    });

    it('should return null when plans directory does not exist', () => {
      const projectDir = path.join(tmpDir, 'no-plans-dir');

      expect(readTaskPlan(projectDir, 'ws', 1)).toBeNull();
    });
  });
});
