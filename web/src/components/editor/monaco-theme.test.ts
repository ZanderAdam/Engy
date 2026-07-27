import { describe, it, expect } from 'vitest';
import { engyDarkTheme, engyCyberpunkTheme } from './monaco-theme';
import type { editor } from 'monaco-editor';

// Monaco silently discards a malformed token foreground or an unknown colors
// key, so a typo never throws — it just renders the wrong colour. These guard
// the two formats it accepts: bare RGB in `rules`, #-prefixed in `colors`.
const RULE_FOREGROUND = /^[0-9a-fA-F]{6}$/;
const COLOR_VALUE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

const themes: [string, editor.IStandaloneThemeData][] = [
  ['engyDarkTheme', engyDarkTheme],
  ['engyCyberpunkTheme', engyCyberpunkTheme],
];

describe('monaco themes', () => {
  describe.each(themes)('%s', (_name, theme) => {
    it('should use bare 6-digit RGB for every token foreground', () => {
      for (const rule of theme.rules) {
        expect(rule.foreground, `token "${rule.token}"`).toMatch(RULE_FOREGROUND);
      }
    });

    it('should use #-prefixed hex for every colors entry', () => {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value, key).toMatch(COLOR_VALUE);
      }
    });

    it('should not declare a token selector twice', () => {
      const tokens = theme.rules.map((rule) => rule.token);
      expect(tokens).toHaveLength(new Set(tokens).size);
    });
  });
});
