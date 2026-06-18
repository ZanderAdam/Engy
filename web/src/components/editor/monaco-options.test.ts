import { describe, it, expect } from 'vitest';
import { buildCodeEditorOptions } from './monaco-options';

describe('buildCodeEditorOptions', () => {
  describe('defaults', () => {
    it('should enable the rich IDE features by default', () => {
      const opts = buildCodeEditorOptions();
      expect(opts.readOnly).toBe(false);
      expect(opts.minimap?.enabled).toBe(true);
      expect(opts.stickyScroll?.enabled).toBe(true);
      expect(opts.bracketPairColorization?.enabled).toBe(true);
      expect(opts.formatOnPaste).toBe(true);
      expect(opts.linkedEditing).toBe(true);
      expect(opts.inlayHints?.enabled).toBe('on');
      expect(opts.wordWrap).toBe('off');
    });
  });

  describe('overrides', () => {
    it('should turn on word wrap when requested', () => {
      expect(buildCodeEditorOptions({ wordWrap: true }).wordWrap).toBe('on');
    });

    it('should disable the minimap when requested', () => {
      expect(buildCodeEditorOptions({ minimap: false }).minimap?.enabled).toBe(false);
    });

    it('should mark the editor read-only when requested', () => {
      expect(buildCodeEditorOptions({ readOnly: true }).readOnly).toBe(true);
    });

    it('should apply a custom font size', () => {
      expect(buildCodeEditorOptions({ fontSize: 16 }).fontSize).toBe(16);
    });
  });
});
