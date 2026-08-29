// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttentionBadge } from './attention-badge';

describe('AttentionBadge', () => {
  it('[FR-TERMINAL-740] should render the mark when the session needs attention', () => {
    const html = renderToStaticMarkup(createElement(AttentionBadge, { needsAttention: true }));
    expect(html).toContain('Needs attention');
  });

  it('[FR-TERMINAL-740] should render nothing when the session does not need attention', () => {
    expect(renderToStaticMarkup(createElement(AttentionBadge, { needsAttention: false }))).toBe('');
    expect(renderToStaticMarkup(createElement(AttentionBadge, {}))).toBe('');
  });

  // The dock tab and TerminalSessionLabel render the label block independently.
  // The dock tab shipped without the mark once already; this pins both to the
  // shared component so the next divergence fails here instead of in the UI.
  it('[FR-TERMINAL-740] should be the only attention mark either label renders', () => {
    for (const file of ['terminal-dock-tab.tsx', 'terminal-session-label.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).toContain('AttentionBadge');
      expect(src).not.toContain('RiAlertLine');
    }
  });
});
