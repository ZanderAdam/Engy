import { describe, it, expect } from 'vitest';
import { diffLanguage, toPrismLanguage } from './diff-language';
import { isLanguageSupported } from './refractor-highlighter';
import { getLanguageFromPath } from '@/components/editor/language-map';

describe('diff language', () => {
  describe('toPrismLanguage', () => {
    it('should pass through an id both editors spell the same way', () => {
      expect(toPrismLanguage('typescript')).toBe('typescript');
    });

    it('should translate the ids Monaco and Prism spell differently', () => {
      expect(toPrismLanguage('shell')).toBe('bash');
      expect(toPrismLanguage('html')).toBe('markup');
      expect(toPrismLanguage('xml')).toBe('markup');
      expect(toPrismLanguage('objective-c')).toBe('objectivec');
    });

    it('should report no grammar for plaintext', () => {
      expect(toPrismLanguage('plaintext')).toBeNull();
    });
  });

  describe('diffLanguage', () => {
    it('[FR-GIT-400] should resolve a registered grammar from the file extension', () => {
      expect(diffLanguage('src/a.ts')).toBe('typescript');
      expect(diffLanguage('src/style.scss')).toBe('scss');
      expect(diffLanguage('deploy.sh')).toBe('bash');
    });

    it('[FR-GIT-400] should report no grammar for an extension nothing highlights', () => {
      expect(diffLanguage('notes.txt')).toBeNull();
      expect(diffLanguage('LICENSE')).toBeNull();
    });

    it('[FR-GIT-400] should report no grammar rather than one that was never registered', () => {
      // `language-map.ts` knows more languages than the highlighter registers.
      // Every one it can name must resolve to a registered grammar or to null —
      // `refractor.highlight` throws on anything else, taking the pane with it.
      const everyKnownPath = [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.json',
        '.css',
        '.scss',
        '.less',
        '.html',
        '.xml',
        '.md',
        '.yaml',
        '.yml',
        '.py',
        '.rb',
        '.go',
        '.rs',
        '.java',
        '.c',
        '.cpp',
        '.h',
        '.sh',
        '.bash',
        '.zsh',
        '.sql',
        '.graphql',
        '.gql',
        '.dockerfile',
        '.toml',
        '.ini',
        '.php',
        '.kt',
        '.kts',
        '.swift',
        '.scala',
        '.dart',
        '.lua',
        '.r',
        '.pl',
        '.cs',
        '.fs',
        '.ps1',
        '.bat',
        '.clj',
        '.m',
        '.vue',
        '.svelte',
      ].map((ext) => `file${ext}`);

      for (const path of [...everyKnownPath, 'Dockerfile', 'Makefile', 'plain']) {
        const language = diffLanguage(path);
        expect(
          language === null || isLanguageSupported(language),
          `${path} resolved to unregistered grammar "${language}"`,
        ).toBe(true);
      }
    });

    it('[FR-GIT-400] should keep the extension table shared with the Monaco editor', () => {
      // Drift guard: a new extension added for the Code tab reaches the diff
      // viewer for free, rather than needing a second table.
      expect(getLanguageFromPath('a.rs')).toBe('rust');
      expect(diffLanguage('a.rs')).toBe('rust');
    });
  });
});
