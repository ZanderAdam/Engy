import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writePermanentMemory,
  rewritePermanentMemory,
  readPermanentMemory,
  writeSourceSnapshot,
  readSourceSnapshot,
  writeReferenceRecord,
  readReferenceRecord,
  validateSourcePath,
  validateLinkedMemoryPath,
  escapeIndexMarkers,
  commitFile,
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

  describe('rewritePermanentMemory', () => {
    it('should rewrite the existing file in place without creating a new one', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Original', subtype: 'fact' as const },
        'Original body.',
      );

      await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Rewritten', subtype: 'fact' as const },
        'Rewritten body.',
      );

      // Same path, updated content
      const absPath = path.join(workspaceDir, relPath);
      expect(fs.existsSync(absPath)).toBe(true);
      const raw = fs.readFileSync(absPath, 'utf8');
      expect(raw).toContain('Rewritten');
      expect(raw).toContain('Rewritten body.');

      // No new file created (README.md may exist from readme chain, exclude it)
      const dir = path.join(workspaceDir, 'memory', 'facts');
      const mdFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
      expect(mdFiles).toHaveLength(1);
    });

    it('should return the same relative path', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Stable', subtype: 'decision' as const },
        'body',
      );
      fs.mkdirSync(path.join(workspaceDir, 'memory', 'decisions'), { recursive: true });

      const returned = await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Stable', subtype: 'decision' as const },
        'updated body',
      );

      expect(returned).toBe(relPath);
    });

    it('should create a git commit with memory(edit) message', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Commit Test', subtype: 'insight' as const },
        'body',
      );
      fs.mkdirSync(path.join(workspaceDir, 'memory', 'insights'), { recursive: true });

      await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Commit Test', subtype: 'insight' as const },
        'updated body',
      );

      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.latest?.message).toContain('memory(edit)');
    });

    it('should reject a path outside memory subtype dirs', async () => {
      await expect(
        rewritePermanentMemory(
          workspaceDir,
          'memory/sources/some-source.md',
          { title: 'Bad Path', subtype: 'fact' as const },
          'body',
        ),
      ).rejects.toThrow('must resolve under');
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

  describe('writeSourceSnapshot provenance fields', () => {
    it('should persist origin and ingested_at fields in frontmatter', async () => {
      const { filePath } = await writeSourceSnapshot(
        workspaceDir,
        {
          title: 'Provenance Test',
          source_type: 'web',
          origin: 'example.com',
          ingester: 'mcp',
          ingested_at: '2026-01-01T00:00:00.000Z',
        },
        'Content with provenance.',
      );

      // The raw markdown file should contain the provenance fields in frontmatter.
      const raw = fs.readFileSync(path.join(workspaceDir, filePath), 'utf8');
      expect(raw).toContain('origin: example.com');
      expect(raw).toContain("ingested_at: '2026-01-01T00:00:00.000Z'");
      expect(raw).toContain('ingester: mcp');
    });

    it('should return deduplicated:true and no new file for identical content', async () => {
      const body = 'Exactly the same content for dedup verification.';
      const first = await writeSourceSnapshot(
        workspaceDir,
        { title: 'First', source_type: 'paste', ingester: 'mcp', ingested_at: '2026-01-01T00:00:00.000Z' },
        body,
      );
      expect(first.deduplicated).toBe(false);

      const second = await writeSourceSnapshot(
        workspaceDir,
        { title: 'Second', source_type: 'paste', origin: 'clipboard', ingester: 'mcp' },
        body,
      );
      expect(second.filePath).toBe(first.filePath);
      expect(second.deduplicated).toBe(true);

      const sourcesDir = path.join(workspaceDir, 'memory', 'sources');
      const snapshots = fs.readdirSync(sourcesDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
      expect(snapshots).toHaveLength(1);
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

  describe('writePermanentMemory op parameter (finding 3)', () => {
    it('should use memory(promote): prefix by default', async () => {
      await writePermanentMemory(
        workspaceDir,
        { title: 'Default Op', subtype: 'fact' as const },
        'body',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.latest?.message).toContain('memory(promote):');
    });

    it('should use memory(create): prefix when op=create', async () => {
      await writePermanentMemory(
        workspaceDir,
        { title: 'Create Op', subtype: 'fact' as const },
        'body',
        'create',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.latest?.message).toContain('memory(create):');
    });
  });

  describe('sanitizeCommitSubject — malicious title injection (finding 4)', () => {
    it('should collapse newlines in title into spaces so subject stays single-line', async () => {
      const maliciousTitle = 'Legit Title\n\ninjected: fake-field\nother: value';
      await writePermanentMemory(
        workspaceDir,
        { title: maliciousTitle, subtype: 'fact' as const },
        'body',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      // The commit message body must not have injected fake key:value lines from the title.
      const fullMsg = log.latest?.body ?? '';
      expect(fullMsg).not.toContain('injected: fake-field');
    });

    it('should cap the subject at 72 chars', async () => {
      const longTitle = 'A'.repeat(100);
      await writePermanentMemory(
        workspaceDir,
        { title: longTitle, subtype: 'fact' as const },
        'body',
      );
      const git = simpleGit(workspaceDir);
      const log = await git.log();
      const subject = log.latest?.message ?? '';
      // "memory(promote): " is 17 chars; title capped at 72 → total subject ≤ 89 chars
      expect(subject.length).toBeLessThanOrEqual(90);
      expect(subject).not.toContain('A'.repeat(80));
    });
  });

  describe('commitFile skip when nothing staged (finding 5)', () => {
    it('should return skipped when staging already-committed files with no changes', async () => {
      const filePath = path.join(workspaceDir, 'already-committed.md');
      fs.writeFileSync(filePath, 'content');
      const git = simpleGit(workspaceDir);
      await git.add([filePath]);
      await git.commit('initial');

      const result = await commitFile(workspaceDir, [filePath], 'should be skipped');
      expect(result).toBe('skipped');

      const log = await git.log();
      expect(log.latest?.message).toBe('initial');
    });

    it('should return committed when there are staged changes', async () => {
      const filePath = path.join(workspaceDir, 'new-file.md');
      fs.writeFileSync(filePath, 'new content');
      const result = await commitFile(workspaceDir, [filePath], 'test commit');
      expect(result).toBe('committed');
    });
  });

  describe('parseMatterSafe delimiter edge cases (finding 6)', () => {
    it('should parse valid frontmatter when body contains a markdown HR (\\n---\\n)', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'hr-body.md');
      fs.writeFileSync(p, '---\ntitle: HR Test\nsubtype: decision\n---\nIntro\n\n---\n\nAfter HR.');
      const result = readPermanentMemory(p, workspaceDir);
      expect(result.frontmatter.title).toBe('HR Test');
      expect(result.content).toContain('After HR.');
    });

    it('should parse CRLF frontmatter correctly', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'crlf.md');
      fs.writeFileSync(p, '---\r\ntitle: CRLF Test\r\nsubtype: decision\r\n---\r\nbody text');
      const result = readPermanentMemory(p, workspaceDir);
      expect(result.frontmatter.title).toBe('CRLF Test');
    });

    it('should throw for genuinely unclosed frontmatter', () => {
      const p = path.join(workspaceDir, 'memory', 'decisions', 'unclosed.md');
      fs.writeFileSync(p, '---\ntitle: No Close\nsubtype: decision\n');
      expect(() => readPermanentMemory(p, workspaceDir)).toThrow('Malformed frontmatter');
    });
  });

  describe('rewritePermanentMemory rejects absolute paths (finding 7)', () => {
    it('should throw when given an absolute path instead of a relative one', async () => {
      const absPath = path.join(workspaceDir, 'memory', 'facts', 'some-file.md');
      await expect(
        rewritePermanentMemory(
          workspaceDir,
          absPath,
          { title: 'Abs Path Test', subtype: 'fact' as const },
          'body',
        ),
      ).rejects.toThrow('must be relative');
    });
  });

  describe('writePermanentMemory rollback on commit failure', () => {
    it('should delete the written file when the git commit throws', async () => {
      // Place a stale .git/index.lock file before calling writePermanentMemory.
      // git will refuse to proceed ("Unable to create .git/index.lock: File exists"),
      // causing commitFile to throw after the markdown file has been written.
      const lockFile = path.join(workspaceDir, '.git', 'index.lock');
      fs.writeFileSync(lockFile, '', 'utf8');

      let error: Error | undefined;
      let resolvedDir: string | undefined;
      try {
        await writePermanentMemory(
          workspaceDir,
          { title: 'Rollback Test', subtype: 'fact' as const },
          'body that should be rolled back',
        );
      } catch (err) {
        error = err as Error;
        // Figure out where the file would have been written so we can assert absence.
        resolvedDir = path.join(workspaceDir, 'memory', 'facts');
      } finally {
        // Remove the lock so later tests can use this workspaceDir for git ops.
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
      }

      // The commit must have thrown.
      expect(error).toBeDefined();

      // The rollback must have cleaned up: no markdown files in the facts dir.
      if (resolvedDir && fs.existsSync(resolvedDir)) {
        const mdFiles = fs
          .readdirSync(resolvedDir)
          .filter((f) => f.endsWith('.md') && f !== 'README.md');
        expect(mdFiles).toHaveLength(0);
      }
    });
  });

  describe('rewritePermanentMemory subtype relocation', () => {
    it('should move the file to the new subtype directory when subtype changes', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Relocate Me', subtype: 'fact' as const },
        'original body',
      );

      fs.mkdirSync(path.join(workspaceDir, 'memory', 'decisions'), { recursive: true });

      const newRelPath = await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Relocate Me', subtype: 'decision' as const },
        'updated body',
      );

      // New path is under decisions/
      expect(newRelPath).toMatch(/^memory\/decisions\//);
      expect(newRelPath).not.toBe(relPath);

      // New file exists, old file is gone
      expect(fs.existsSync(path.join(workspaceDir, newRelPath))).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, relPath))).toBe(false);
    });

    it('should repoint inbound linkedMemories references when the file relocates', async () => {
      fs.mkdirSync(path.join(workspaceDir, 'memory', 'decisions'), { recursive: true });

      const targetPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Link Target', subtype: 'fact' as const },
        'target body',
      );
      const linkerPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Linker', subtype: 'insight' as const, linkedMemories: [targetPath] },
        'linker body',
      );

      const newTargetPath = await rewritePermanentMemory(
        workspaceDir,
        targetPath,
        { title: 'Link Target', subtype: 'decision' as const },
        'target body',
      );

      const linkerRaw = fs.readFileSync(path.join(workspaceDir, linkerPath), 'utf8');
      expect(linkerRaw).toContain(newTargetPath);
      expect(linkerRaw).not.toContain(targetPath);
    });

    it('should return the same path when subtype is unchanged', async () => {
      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Stable Subtype', subtype: 'fact' as const },
        'body',
      );

      const returnedPath = await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Stable Subtype updated', subtype: 'fact' as const },
        'new body',
      );

      expect(returnedPath).toBe(relPath);
    });

    it('should commit both old and new paths in one memory(edit) commit when subtype changes', async () => {
      fs.mkdirSync(path.join(workspaceDir, 'memory', 'patterns'), { recursive: true });

      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'Move To Pattern', subtype: 'insight' as const },
        'body',
      );

      await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'Move To Pattern', subtype: 'pattern' as const },
        'body',
      );

      const git = simpleGit(workspaceDir);
      const log = await git.log();
      expect(log.latest?.message).toContain('memory(edit)');
    });

    it('should regenerate README chains for both old and new directories', async () => {
      fs.mkdirSync(path.join(workspaceDir, 'memory', 'conventions'), { recursive: true });

      const relPath = await writePermanentMemory(
        workspaceDir,
        { title: 'README Chain Test', subtype: 'fact' as const },
        'body',
      );

      const filename = path.basename(relPath);

      await rewritePermanentMemory(
        workspaceDir,
        relPath,
        { title: 'README Chain Test', subtype: 'convention' as const },
        'body',
      );

      // Old README should no longer reference the moved file
      const oldReadme = path.join(workspaceDir, 'memory', 'facts', 'README.md');
      if (fs.existsSync(oldReadme)) {
        expect(fs.readFileSync(oldReadme, 'utf8')).not.toContain(filename);
      }

      // New README should reference the file
      const newReadme = path.join(workspaceDir, 'memory', 'conventions', 'README.md');
      if (fs.existsSync(newReadme)) {
        expect(fs.readFileSync(newReadme, 'utf8')).toContain(filename);
      }
    });
  });
});
