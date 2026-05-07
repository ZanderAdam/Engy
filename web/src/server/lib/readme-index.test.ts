import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateReadmeIndex, regenerateReadmeChain } from './readme-index';

const INDEX_START = '<!-- INDEX START -->';
const INDEX_END = '<!-- INDEX END -->';

function extractIndexBlock(content: string): string {
  const start = content.indexOf(INDEX_START);
  const end = content.indexOf(INDEX_END);
  if (start === -1 || end === -1) return '';
  return content.slice(start, end + INDEX_END.length);
}

describe('readme-index', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engy-readme-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('updateReadmeIndex', () => {
    it('should create README.md with empty placeholder for empty dir', () => {
      updateReadmeIndex(tmpDir);
      const readmePath = path.join(tmpDir, 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);
      const content = fs.readFileSync(readmePath, 'utf8');
      expect(content).toContain(INDEX_START);
      expect(content).toContain(INDEX_END);
      expect(content).toContain('(empty)');
    });

    it('should list markdown files alphabetically', () => {
      fs.writeFileSync(path.join(tmpDir, 'zebra.md'), '# Zebra\nA zebra file.');
      fs.writeFileSync(path.join(tmpDir, 'alpha.md'), '# Alpha\nAn alpha file.');
      fs.writeFileSync(path.join(tmpDir, 'beta.md'), '# Beta\nA beta file.');

      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      const block = extractIndexBlock(content);

      const alphaIdx = block.indexOf('alpha.md');
      const betaIdx = block.indexOf('beta.md');
      const zebraIdx = block.indexOf('zebra.md');
      expect(alphaIdx).toBeLessThan(betaIdx);
      expect(betaIdx).toBeLessThan(zebraIdx);
    });

    it('should use frontmatter description for subdir bullets', () => {
      const subdir = path.join(tmpDir, 'decisions');
      fs.mkdirSync(subdir);
      fs.writeFileSync(
        path.join(subdir, 'README.md'),
        '---\ndescription: Choices with rationale\n---\nProse here.',
      );

      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('Choices with rationale');
    });

    it('should fall back to first H1 when no description frontmatter', () => {
      fs.writeFileSync(path.join(tmpDir, 'note.md'), '# The Note Title\nBody text.');
      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('The Note Title');
    });

    it('should fall back to first prose line when no H1', () => {
      fs.writeFileSync(path.join(tmpDir, 'prose.md'), '---\n---\nFirst prose line here.');
      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('First prose line here.');
    });

    it('should fall back to filename stem as last resort', () => {
      // Empty file with only frontmatter, no H1, no prose
      fs.writeFileSync(path.join(tmpDir, 'my-note.md'), '---\ntags: []\n---\n');
      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('my-note');
    });

    it('should show file count in subdir bullets', () => {
      const subdir = path.join(tmpDir, 'patterns');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'README.md'), '---\ndescription: Patterns\n---\n');
      fs.writeFileSync(path.join(subdir, 'note1.md'), '# Note 1');
      fs.writeFileSync(path.join(subdir, 'note2.md'), '# Note 2');

      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('(2 notes)');
    });

    it('should preserve prose outside index markers', () => {
      const readmePath = path.join(tmpDir, 'README.md');
      fs.writeFileSync(
        readmePath,
        `# My Collection\n\nSome prose here.\n\n${INDEX_START}\n- (empty)\n${INDEX_END}\n`,
      );

      fs.writeFileSync(path.join(tmpDir, 'new-note.md'), '# New Note\nContent.');
      updateReadmeIndex(tmpDir);

      const content = fs.readFileSync(readmePath, 'utf8');
      expect(content).toContain('# My Collection');
      expect(content).toContain('Some prose here.');
      expect(content).toContain('new-note.md');
      expect(content).not.toContain('(empty)');
    });

    it('should escape ] and ) in titles to avoid broken link syntax', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'tricky.md'),
        '# Title with ) and ] chars\nBody.',
      );
      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      // The title description in the bullet should have escaped chars
      expect(content).toContain('\\)');
      expect(content).toContain('\\]');
    });

    it('should escape INDEX markers in extracted descriptions', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'sneaky.md'),
        '# <!-- INDEX START --> malicious\nBody.',
      );
      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      // The README must not contain a raw unescaped INDEX START
      const block = extractIndexBlock(content);
      // The block itself starts with INDEX_START — we check that no *second*
      // raw instance appears inside the block body (between start and end)
      const inner = block.slice(INDEX_START.length, block.indexOf(INDEX_END));
      expect(inner).not.toContain('<!-- INDEX START -->');
    });

    it('should use Sections/Notes subheadings for mixed dirs', () => {
      const subdir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'README.md'), '---\ndescription: Sub\n---\n');
      fs.writeFileSync(path.join(tmpDir, 'file.md'), '# File\nContent.');

      updateReadmeIndex(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('**Sections**');
      expect(content).toContain('**Notes**');
    });
  });

  describe('regenerateReadmeChain', () => {
    it('should update README in the file directory', () => {
      const subdir = path.join(tmpDir, 'memory', 'decisions');
      fs.mkdirSync(subdir, { recursive: true });
      const filePath = path.join(subdir, '202601010000-some-decision.md');
      fs.writeFileSync(filePath, '---\ntitle: Some Decision\nsubtype: decision\n---\nBody.');

      regenerateReadmeChain(filePath);

      const readme = path.join(subdir, 'README.md');
      expect(fs.existsSync(readme)).toBe(true);
      const content = fs.readFileSync(readme, 'utf8');
      expect(content).toContain('202601010000-some-decision.md');
    });

    it('should update parent directory README as well', () => {
      const subdir = path.join(tmpDir, 'memory', 'decisions');
      fs.mkdirSync(subdir, { recursive: true });
      const filePath = path.join(subdir, 'note.md');
      fs.writeFileSync(filePath, '# Note\nContent.');

      regenerateReadmeChain(filePath);

      const parentReadme = path.join(tmpDir, 'memory', 'README.md');
      expect(fs.existsSync(parentReadme)).toBe(true);
    });
  });
});
