import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writePermanentMemory,
  readPermanentMemory,
  writeSourceSnapshot,
  readSourceSnapshot,
  writeReferenceRecord,
  readReferenceRecord,
  validateSourcePath,
  validateLinkedMemoryPath,
  escapeIndexMarkers,
} from './memory-files';

async function initGitRepo(dir: string): Promise<void> {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Test');
  await git.addConfig('user.email', 'test@localhost');
  // Create an initial commit so subsequent commits have a parent
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  await git.add('.');
  await git.commit('init');
}

describe('memory-files', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-mem-test-'));
    await initGitRepo(workspaceDir);
    // Seed subdirs that README chain will walk into
    fs.mkdirSync(path.join(workspaceDir, 'memory', 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'memory', 'sources'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'memory', 'references'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('escapeIndexMarkers', () => {
    it('should escape INDEX START markers', () => {
      const result = escapeIndexMarkers('before <!-- INDEX START --> after');
      expect(result).not.toContain('<!-- INDEX START -->');
      expect(result).toContain('INDEX START');
    });

    it('should escape INDEX END markers', () => {
      const result = escapeIndexMarkers('before <!-- INDEX END --> after');
      expect(result).not.toContain('<!-- INDEX END -->');
      expect(result).toContain('INDEX END');
    });

    it('should leave normal content unchanged', () => {
      const normal = 'Just regular text with no markers';
      expect(escapeIndexMarkers(normal)).toBe(normal);
    });
  });

  describe('validateSourcePath', () => {
    it('should accept paths under memory/sources', () => {
      expect(() =>
        validateSourcePath('memory/sources/foo.md', workspaceDir),
      ).not.toThrow();
    });

    it('should accept paths under memory/references', () => {
      expect(() =>
        validateSourcePath('memory/references/bar.md', workspaceDir),
      ).not.toThrow();
    });

    it('should reject absolute paths', () => {
      expect(() =>
        validateSourcePath('/absolute/path.md', workspaceDir),
      ).toThrow('must be relative');
    });

    it('should reject paths with .. segments', () => {
      expect(() =>
        validateSourcePath('memory/sources/../../../etc/passwd', workspaceDir),
      ).toThrow("must not contain '..'");
    });

    it('should reject paths outside memory/sources and memory/references', () => {
      expect(() =>
        validateSourcePath('memory/decisions/foo.md', workspaceDir),
      ).toThrow('must resolve under');
    });
  });

  describe('validateLinkedMemoryPath', () => {
    it('should accept paths under memory/decisions', () => {
      expect(() =>
        validateLinkedMemoryPath('memory/decisions/202601010000-foo.md', workspaceDir),
      ).not.toThrow();
    });

    it('should reject absolute paths', () => {
      expect(() =>
        validateLinkedMemoryPath('/memory/decisions/foo.md', workspaceDir),
      ).toThrow('must be relative');
    });

    it('should reject .. traversal', () => {
      expect(() =>
        validateLinkedMemoryPath('../other-workspace/memory/decisions/foo.md', workspaceDir),
      ).toThrow("must not contain '..'");
    });

    it('should reject paths not under a known subtype', () => {
      expect(() =>
        validateLinkedMemoryPath('memory/sources/foo.md', workspaceDir),
      ).toThrow('must resolve under');
    });
  });

  describe('writePermanentMemory + readPermanentMemory', () => {
    it('should write and read back a permanent memory with roundtrip fidelity', async () => {
      const fm = {
        title: 'JWT Rotation Pattern',
        subtype: 'pattern' as const,
        repo: 'api-server',
        confidence: 0.9,
        keywords: ['jwt', 'rotation'],
        themes: ['auth'],
        tags: ['security'],
        linkedMemories: [],
        scenarioIds: ['FR-3.4'],
        sources: [],
      };

      const relPath = await writePermanentMemory(workspaceDir, fm, 'Use short-lived tokens.');

      const filePath = path.join(workspaceDir, relPath);
      expect(fs.existsSync(filePath)).toBe(true);

      const result = readPermanentMemory(filePath, workspaceDir);
      expect(result.frontmatter.title).toBe('JWT Rotation Pattern');
      expect(result.frontmatter.subtype).toBe('pattern');
      expect(result.frontmatter.repo).toBe('api-server');
      expect(result.frontmatter.tags).toEqual(['security']);
      expect(result.content.trim()).toBe('Use short-lived tokens.');
    });

    it('should place file in memory/{subtype}/ with timestamp-slug filename', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Some Fact', subtype: 'fact' as const },
        'A fact.',
      );
      expect(relPath).toMatch(/^memory\/facts\//);
      expect(relPath).toMatch(/\.md$/);
    });

    it('should escape INDEX markers in body', async () => {
      const maliciousBody = 'Injecting <!-- INDEX START --> here.';
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Escape Test', subtype: 'fact' as const },
        maliciousBody,
      );
      const raw = fs.readFileSync(path.join(workspaceDir, relPath), 'utf8');
      expect(raw).not.toContain('<!-- INDEX START -->');
    });

    it('should create a git commit after writing', async () => {
      await writePermanentMemory(
        workspaceDir,
        { title: 'Committed Fact', subtype: 'fact' as const },
        'body',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.total).toBeGreaterThan(1);
    });
  });

  describe('readPermanentMemory validation', () => {
    it('should reject file missing frontmatter delimiters', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'bad.md');
      fs.writeFileSync(p, 'no frontmatter here');
      expect(() => readPermanentMemory(p, workspaceDir)).toThrow('Missing frontmatter');
    });

    it('should reject non-array tags field', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'bad-tags.md');
      fs.writeFileSync(p, '---\ntitle: Test\nsubtype: decision\ntags: not-an-array\n---\nbody');
      expect(() => readPermanentMemory(p, workspaceDir)).toThrow("must be an array");
    });

    it('should reject invalid subtype', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'bad-subtype.md');
      fs.writeFileSync(p, '---\ntitle: Test\nsubtype: bogus\n---\nbody');
      expect(() => readPermanentMemory(p, workspaceDir)).toThrow('Invalid subtype');
    });
  });

  describe('writeSourceSnapshot + readSourceSnapshot', () => {
    it('should write and read back a source snapshot', async () => {
      const { filePath, deduplicated } = await writeSourceSnapshot(
        workspaceDir,
        { title: 'Auth Thread', source_type: 'slack', url: 'https://slack.com/x' },
        'Thread content here.',
      );

      expect(deduplicated).toBe(false);
      const fullPath = path.join(workspaceDir, filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const result = readSourceSnapshot(fullPath);
      expect(result.frontmatter.title).toBe('Auth Thread');
      expect(result.frontmatter.source_type).toBe('slack');
      expect(result.body.trim()).toBe('Thread content here.');
    });

    it('should return existing path for duplicate content (dedup by hash)', async () => {
      const body = 'Identical content for dedup test.';
      const first = await writeSourceSnapshot(
        workspaceDir,
        { title: 'First Ingest', source_type: 'article' },
        body,
      );

      const second = await writeSourceSnapshot(
        workspaceDir,
        { title: 'Second Ingest Same Body', source_type: 'article' },
        body,
      );

      expect(second.filePath).toBe(first.filePath);
      expect(second.deduplicated).toBe(true);

      // Only one snapshot file should exist (README.md may also be created)
      const sourcesDir = path.join(workspaceDir, 'memory', 'sources');
      const snapshotFiles = fs
        .readdirSync(sourcesDir)
        .filter((f) => f.endsWith('.md') && f !== 'README.md');
      expect(snapshotFiles).toHaveLength(1);
    });

    it('should escape INDEX markers in snapshot body', async () => {
      const { filePath } = await writeSourceSnapshot(
        workspaceDir,
        { title: 'Marker Inject', source_type: 'text' },
        'Text with <!-- INDEX START --> inside.',
      );
      const raw = fs.readFileSync(path.join(workspaceDir, filePath), 'utf8');
      expect(raw).not.toContain('<!-- INDEX START -->');
    });

    it('should commit the snapshot to git', async () => {
      await writeSourceSnapshot(
        workspaceDir,
        { title: 'Committed Snapshot', source_type: 'text' },
        'content',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.total).toBeGreaterThan(1);
    });
  });

  describe('readSourceSnapshot validation', () => {
    it('should reject file missing frontmatter delimiters', () => {
      const p = path.join(workspaceDir, 'memory', 'sources', 'bad.md');
      fs.writeFileSync(p, 'no frontmatter');
      expect(() => readSourceSnapshot(p)).toThrow('Missing frontmatter');
    });
  });

  describe('writeReferenceRecord + readReferenceRecord', () => {
    it('should write and read back a reference record', async () => {
      const relPath = await writeReferenceRecord(workspaceDir, {
        title: 'RFC 9001',
        url: 'https://rfc-editor.org/rfc/rfc9001',
        type: 'rfc',
        description: 'QUIC TLS spec',
      });

      const fullPath = path.join(workspaceDir, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const result = readReferenceRecord(fullPath);
      expect(result.frontmatter.title).toBe('RFC 9001');
      expect(result.frontmatter.url).toBe('https://rfc-editor.org/rfc/rfc9001');
      expect(result.frontmatter.description).toBe('QUIC TLS spec');
    });

    it('should use slug-based filename (no timestamp)', async () => {
      const relPath = await writeReferenceRecord(workspaceDir, {
        title: 'My Reference',
        url: 'https://example.com',
        type: 'doc',
      });
      expect(relPath).toMatch(/memory\/references\/my-reference\.md/);
    });
  });

  describe('readReferenceRecord validation', () => {
    it('should reject missing url', () => {
      const p = path.join(workspaceDir, 'memory', 'references', 'bad.md');
      fs.writeFileSync(p, '---\ntitle: No URL\ntype: doc\n---\n');
      expect(() => readReferenceRecord(p)).toThrow('non-empty string url');
    });
  });
});
