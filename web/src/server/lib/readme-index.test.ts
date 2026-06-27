import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateReadmeIndex, regenerateReadmeChain, regenerateSystemReadmes } from './readme-index';

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

    it('should sort files by order frontmatter, then alphabetically', () => {
      fs.writeFileSync(path.join(tmpDir, 'third.md'), '---\norder: 3\ndescription: Third\n---\n');
      fs.writeFileSync(path.join(tmpDir, 'first.md'), '---\norder: 1\ndescription: First\n---\n');
      fs.writeFileSync(path.join(tmpDir, 'second.md'), '---\norder: 2\ndescription: Second\n---\n');
      // Unordered files (order = Infinity) fall after ordered ones, alphabetically.
      fs.writeFileSync(path.join(tmpDir, 'zzz.md'), '# Zzz\nNo order.');
      fs.writeFileSync(path.join(tmpDir, 'aaa.md'), '# Aaa\nNo order.');

      updateReadmeIndex(tmpDir);
      const block = extractIndexBlock(fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8'));
      const idx = (name: string) => block.indexOf(name);

      expect(idx('first.md')).toBeLessThan(idx('second.md'));
      expect(idx('second.md')).toBeLessThan(idx('third.md'));
      expect(idx('third.md')).toBeLessThan(idx('aaa.md'));
      expect(idx('aaa.md')).toBeLessThan(idx('zzz.md'));
    });

    it('should label the files section with the provided noun', () => {
      const subdir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'README.md'), '---\ndescription: Sub\n---\n');
      fs.writeFileSync(path.join(subdir, 'd1.md'), '# D1');
      fs.writeFileSync(path.join(subdir, 'd2.md'), '# D2');
      fs.writeFileSync(path.join(tmpDir, 'file.md'), '# File\nContent.');

      updateReadmeIndex(tmpDir, 'doc');
      const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
      expect(content).toContain('**Docs**');
      expect(content).toContain('(2 docs)');
      expect(content).not.toContain('**Notes**');
    });
  });

  describe('[FR-MEMORY-140] regenerateReadmeChain', () => {
    it('should update README in the file directory', () => {
      const subdir = path.join(tmpDir, 'memory', 'decisions');
      fs.mkdirSync(subdir, { recursive: true });
      const filePath = path.join(subdir, '202601010000-some-decision.md');
      fs.writeFileSync(filePath, '---\ntitle: Some Decision\nsubtype: decision\n---\nBody.');

      regenerateReadmeChain(filePath, tmpDir);

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

      regenerateReadmeChain(filePath, tmpDir);

      const parentReadme = path.join(tmpDir, 'memory', 'README.md');
      expect(fs.existsSync(parentReadme)).toBe(true);
    });

    it('should not write a README above the workspace root', () => {
      const workspaceRoot = path.join(tmpDir, 'my-workspace');
      const subdir = path.join(workspaceRoot, 'memory', 'decisions');
      fs.mkdirSync(subdir, { recursive: true });
      const filePath = path.join(subdir, 'note.md');
      fs.writeFileSync(filePath, '# Note\nContent.');

      regenerateReadmeChain(filePath, workspaceRoot);

      // README above the workspace root must not be created.
      expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(false);
      // READMEs within the workspace root are fine.
      expect(fs.existsSync(path.join(workspaceRoot, 'memory', 'decisions', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(workspaceRoot, 'memory', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(workspaceRoot, 'README.md'))).toBe(true);
    });

    it('should include the workspace root README', () => {
      const subdir = path.join(tmpDir, 'memory', 'decisions');
      fs.mkdirSync(subdir, { recursive: true });
      const filePath = path.join(subdir, 'note.md');
      fs.writeFileSync(filePath, '# Note\nContent.');

      regenerateReadmeChain(filePath, tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(true);
    });
  });

  describe('regenerateSystemReadmes', () => {
    function seedSystem(): string {
      const sys = path.join(tmpDir, 'system');
      fs.mkdirSync(path.join(sys, 'features'), { recursive: true });
      fs.mkdirSync(path.join(sys, 'technical'), { recursive: true });
      fs.writeFileSync(path.join(sys, 'overview.md'), '---\ndescription: Overview\n---\n# Overview');
      fs.writeFileSync(
        path.join(sys, 'features', 'b-feature.md'),
        '---\norder: 1\ndescription: First feature\n---\n',
      );
      fs.writeFileSync(
        path.join(sys, 'features', 'a-feature.md'),
        '---\norder: 2\ndescription: Second feature\n---\n',
      );
      return sys;
    }

    it('should build README indexes for system/ and its subdirs, ordered by order field', () => {
      const sys = seedSystem();
      regenerateSystemReadmes(tmpDir);

      const featReadme = fs.readFileSync(path.join(sys, 'features', 'README.md'), 'utf8');
      // order:1 (b-feature) sorts before order:2 (a-feature), despite alphabetical order.
      expect(featReadme.indexOf('b-feature.md')).toBeLessThan(featReadme.indexOf('a-feature.md'));

      const sysReadme = fs.readFileSync(path.join(sys, 'README.md'), 'utf8');
      expect(sysReadme).toContain('**Sections**'); // features/ + technical/
      expect(sysReadme).toContain('**Docs**'); // overview.md, labelled with the 'doc' noun
      expect(sysReadme).toContain('overview.md');
    });

    it('should preserve init-seeded prose above the index markers', () => {
      const sys = seedSystem();
      const featReadme = path.join(sys, 'features', 'README.md');
      fs.writeFileSync(featReadme, 'Intro prose for features.\n\n<!-- INDEX START -->\n<!-- INDEX END -->\n');

      regenerateSystemReadmes(tmpDir);

      const content = fs.readFileSync(featReadme, 'utf8');
      expect(content).toContain('Intro prose for features.');
      expect(content).toContain('b-feature.md');
    });

    it('should no-op when system/ does not exist', () => {
      expect(() => regenerateSystemReadmes(tmpDir)).not.toThrow();
      expect(fs.existsSync(path.join(tmpDir, 'system', 'README.md'))).toBe(false);
    });
  });
});
